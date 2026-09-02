import { describe, expect, test } from "vitest";
import type { CheckInProgress } from "./api";
import {
  CHECK_IN_KEY,
  checkInDue,
  clearCheckInState,
  dismissCheckInPrompt,
  emptyCheckInState,
  loadCheckInState,
  progressContextFor,
  recordCheckIn,
  saveCheckInState,
  type CheckInSnapshot,
  type CheckInStorageLike,
} from "./checkInStorage";

function stub(entries: Record<string, string> = {}): CheckInStorageLike & {
  store: Map<string, string>;
} {
  const store = new Map(Object.entries(entries));
  return {
    store,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
  };
}

const progress: CheckInProgress = {
  previous_month: "2026-08",
  since_previous: { status: "decreased", amount: "100.00" },
  since_baseline: { status: "decreased", amount: "250.00" },
  newly_paid_off_debt_ids: ["card"],
  milestones_reached: ["10_percent", "25_percent"],
};

function snapshot(month: string, balance = "1000.00"): Omit<
  CheckInSnapshot,
  "newMilestones" | "newlyCelebratedDebtIds"
> {
  return {
    month,
    debts: [{ id: "card", balance }],
    totalDebt: balance,
    cashFlowStatus: "surplus",
    plannedExtra: "100.00",
    selectedStrategy: "avalanche",
    payoffMonth: "2027-09",
    progress: month === "2026-08" ? null : progress,
  };
}

test("a complete check-in state round-trips without emotional fields", () => {
  const storage = stub();
  const state = recordCheckIn(emptyCheckInState(), snapshot("2026-08"), null);
  expect(saveCheckInState(storage, state)).toBe(true);
  expect(loadCheckInState(storage)).toEqual(state);
  expect(storage.store.get(CHECK_IN_KEY)).not.toMatch(/overwhelmed|manageable|reflection/i);
});

test("malformed or unavailable storage falls back without throwing", () => {
  expect(loadCheckInState(stub({ [CHECK_IN_KEY]: "not json" }))).toEqual(
    emptyCheckInState(),
  );
  expect(loadCheckInState(null)).toEqual(emptyCheckInState());
  expect(saveCheckInState(null, emptyCheckInState())).toBe(false);
  expect(clearCheckInState(null)).toBe(false);
});

test("valid-looking duplicate or unsorted months are rejected", () => {
  const first = recordCheckIn(emptyCheckInState(), snapshot("2026-08"), null);
  const second = recordCheckIn(first, snapshot("2026-09", "900.00"), null);
  const reversed = { ...second, snapshots: [...second.snapshots].reverse() };
  expect(
    loadCheckInState(stub({ [CHECK_IN_KEY]: JSON.stringify(reversed) })),
  ).toEqual(emptyCheckInState());
  const duplicated = { ...second, snapshots: [second.snapshots[0], second.snapshots[0]] };
  expect(
    loadCheckInState(stub({ [CHECK_IN_KEY]: JSON.stringify(duplicated) })),
  ).toEqual(emptyCheckInState());
});

test("same-month saves replace the snapshot and correct the only baseline", () => {
  const first = recordCheckIn(emptyCheckInState(), snapshot("2026-08"), null);
  const corrected = recordCheckIn(first, snapshot("2026-08", "900.00"), null);
  expect(corrected.snapshots).toHaveLength(1);
  expect(corrected.snapshots[0].totalDebt).toBe("900.00");
  expect(corrected.baseline?.debts[0].balance).toBe("900.00");
});

test("history retains the baseline separately and caps recent snapshots at 24", () => {
  let state = emptyCheckInState();
  for (let index = 0; index < 30; index += 1) {
    const year = 2024 + Math.floor(index / 12);
    const month = String((index % 12) + 1).padStart(2, "0");
    state = recordCheckIn(state, snapshot(`${year}-${month}`, `${1000 - index}.00`), null);
  }
  expect(state.snapshots).toHaveLength(24);
  expect(state.baseline?.month).toBe("2024-01");
  expect(state.snapshots[0].month).toBe("2024-07");
});

test("new celebrations are recorded once", () => {
  const baseline = recordCheckIn(emptyCheckInState(), snapshot("2026-08"), null);
  const next = recordCheckIn(baseline, snapshot("2026-09", "750.00"), null);
  expect(next.snapshots.at(-1)?.newMilestones).toEqual(["10_percent", "25_percent"]);
  expect(next.snapshots.at(-1)?.newlyCelebratedDebtIds).toEqual(["card"]);
  const repeat = recordCheckIn(next, snapshot("2026-10", "700.00"), null);
  expect(repeat.snapshots.at(-1)?.newMilestones).toEqual([]);
  expect(repeat.snapshots.at(-1)?.newlyCelebratedDebtIds).toEqual([]);
});

describe("monthly reminders", () => {
  test("is due only in a later, undismissed month", () => {
    const state = recordCheckIn(emptyCheckInState(), snapshot("2026-08"), null);
    expect(checkInDue(state, "2026-08")).toBe(false);
    expect(checkInDue(state, "2026-07")).toBe(false);
    expect(checkInDue(state, "2026-09")).toBe(true);
    expect(checkInDue(dismissCheckInPrompt(state, "2026-09"), "2026-09")).toBe(false);
  });
});

test("progress context uses the baseline and latest earlier month", () => {
  let state = recordCheckIn(emptyCheckInState(), snapshot("2026-07"), null);
  state = recordCheckIn(state, snapshot("2026-08", "900.00"), null);
  expect(progressContextFor(state, "2026-09")).toEqual({
    baseline: { month: "2026-07", debts: [{ id: "card", balance: "1000.00" }] },
    previous: { month: "2026-08", debts: [{ id: "card", balance: "900.00" }] },
  });
  expect(progressContextFor(state, "2026-07")).toBeUndefined();
});

test("an empty later portfolio remains valid without replacing the nonempty baseline", () => {
  const first = recordCheckIn(emptyCheckInState(), snapshot("2026-08"), null);
  const empty = recordCheckIn(
    first,
    { ...snapshot("2026-09", "0.00"), debts: [] },
    null,
  );
  const storage = stub();
  expect(saveCheckInState(storage, empty)).toBe(true);
  expect(loadCheckInState(storage)).toEqual(empty);
  expect(empty.baseline?.debts).toHaveLength(1);
  expect(progressContextFor(empty, "2026-10")?.previous.debts).toEqual([]);
});

test("clearing check-ins leaves unrelated profile storage untouched", () => {
  const storage = stub({
    [CHECK_IN_KEY]: JSON.stringify(emptyCheckInState()),
    "debtpilot.financial-profile.v4": "profile",
  });
  expect(clearCheckInState(storage)).toBe(true);
  expect(storage.store.has(CHECK_IN_KEY)).toBe(false);
  expect(storage.store.get("debtpilot.financial-profile.v4")).toBe("profile");
});
