import { describe, expect, test, vi } from "vitest";
import { CHECK_IN_KEY, emptyCheckInState, recordCheckIn } from "./checkInStorage";
import { createBackup, DATA_KEY, parseBackup, readLocalData, writeLocalData, type LocalData } from "./localData";

const PROFILE_KEY = "debtpilot.financial-profile.v4";

function fixture(): LocalData {
  const checkIns = recordCheckIn(emptyCheckInState(), {
    month: "2026-08",
    debts: [{ id: "card", balance: "1000.01" }],
    totalDebt: "1000.01",
    cashFlowStatus: "surplus",
    plannedExtra: "100.00",
    selectedStrategy: "avalanche",
    payoffMonth: "2027-09",
    progress: null,
  }, { kind: "planned_extra", amount: "100.00", createdMonth: "2026-08", targetMonth: "2026-09" });
  checkIns.celebratedMilestones = ["10_percent"];
  checkIns.celebratedPaidOffDebtIds = ["older-card"];
  return {
    version: 1,
    profile: {
      incomes: [{ id: "pay", name: "Pay", amount: "461.54", frequency: "biweekly" }],
      expenses: [{ id: "rent", name: "Rent", category: "housing", monthly_amount: "500.00" }],
      debts: [{ id: "card", name: "Card", type: "credit_card", balance: "1000.01", apr: "10.00", minimum_payment: "20.00" }],
      extra: "50.00",
      preferredStrategy: "avalanche",
    },
    checkIns,
  };
}

function stub(entries: Record<string, string> = {}) {
  const store = new Map(Object.entries(entries));
  return {
    store,
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { store.set(key, value); }),
    removeItem: vi.fn((key: string) => { store.delete(key); }),
  };
}

describe("portable backups", () => {
  test("round-trips exact decimal strings, debt IDs, strategy, and full history", () => {
    const data = fixture();
    const backup = createBackup(data, new Date("2026-09-17T12:00:00.000Z"));
    expect(JSON.parse(backup)).toMatchObject({ format: "debtpilot-backup", version: 1, exportedAt: "2026-09-17T12:00:00.000Z" });
    expect(parseBackup(backup)).toEqual(data);
  });

  test("preserves incomplete editable drafts without requiring a report", () => {
    const data = fixture();
    data.profile.debts[0].balance = "";
    data.profile.incomes[0].amount = "unfinished";
    data.profile.extra = "";
    expect(parseBackup(createBackup(data))).toEqual(data);
  });

  test.each(["not JSON", "null", "[]", "{}"])("rejects malformed backup %s", (text) => {
    expect(() => parseBackup(text)).toThrow();
  });

  test("rejects unknown formats and versions", () => {
    const backup = JSON.parse(createBackup(fixture()));
    expect(() => parseBackup(JSON.stringify({ ...backup, format: "other" }))).toThrow();
    expect(() => parseBackup(JSON.stringify({ ...backup, version: 2 }))).toThrow();
  });

  test("rejects files over 5 MiB, counting UTF-8 bytes", () => {
    const data = fixture();
    data.profile.incomes[0].name = "é".repeat(3 * 1024 * 1024);
    expect(() => parseBackup(createBackup(data))).toThrow();
  });

  test("rejects invalid money types and collection-limit violations", () => {
    const backup = JSON.parse(createBackup(fixture()));
    backup.profile.debts[0].balance = 1000.01;
    expect(() => parseBackup(JSON.stringify(backup))).toThrow();
    const data = fixture();
    data.profile.debts = Array.from({ length: 21 }, (_, index) => ({ ...data.profile.debts[0], id: String(index) }));
    expect(() => parseBackup(createBackup(data))).toThrow();
    const history = fixture();
    history.checkIns.snapshots = Array.from({ length: 25 }, () => history.checkIns.snapshots[0]);
    expect(() => parseBackup(createBackup(history))).toThrow();
  });
});

describe("combined local storage", () => {
  test("saves profile and history with a single atomic key write", () => {
    const storage = stub();
    const data = fixture();
    expect(writeLocalData(storage, data)).toBe(true);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(storage.setItem).toHaveBeenCalledWith(DATA_KEY, JSON.stringify(data));
    expect(readLocalData(storage).data).toEqual(data);
  });

  test("failed replacement preserves the original stored data and supports retry", () => {
    const original = fixture();
    const storage = stub({ [DATA_KEY]: JSON.stringify(original) });
    const replacement = fixture();
    replacement.profile.extra = "99.99";
    storage.setItem.mockImplementationOnce(() => { throw new DOMException("Quota exceeded"); });
    expect(writeLocalData(storage, replacement)).toBe(false);
    expect(readLocalData(storage).data).toEqual(original);
    expect(writeLocalData(storage, replacement)).toBe(true);
    expect(readLocalData(storage).data).toEqual(replacement);
  });

  test("migrates the current profile and history and removes legacy keys after saving", () => {
    const data = fixture();
    const storage = stub({ [PROFILE_KEY]: JSON.stringify(data.profile), [CHECK_IN_KEY]: JSON.stringify(data.checkIns) });
    const result = readLocalData(storage);
    expect(result.data).toEqual(data);
    expect(result.error).toBeNull();
    expect(JSON.parse(storage.store.get(DATA_KEY)!)).toEqual(data);
    expect(storage.store.has(PROFILE_KEY)).toBe(false);
    expect(storage.store.has(CHECK_IN_KEY)).toBe(false);
  });

  test("migrates a v2 monthly profile with absent history", () => {
    const storage = stub({ "debtpilot.financial-profile.v2": JSON.stringify({ incomes: [{ id: "pay", name: "Pay", monthly_amount: "1000.00" }], expenses: [], debts: [], extra: "0.00" }) });
    const result = readLocalData(storage);
    expect(result.error).toBeNull();
    expect(result.data.profile.incomes[0]).toEqual({ id: "pay", name: "Pay", amount: "1000.00", frequency: "monthly" });
    expect(result.data.profile.preferredStrategy).toBeNull();
    expect(result.data.checkIns).toEqual(emptyCheckInState());
  });

  test("failed migration preserves the source and exposes its unsaved in-memory data", () => {
    const data = fixture();
    const raw = JSON.stringify(data.profile);
    const storage = stub({ [PROFILE_KEY]: raw });
    storage.setItem.mockImplementation(() => { throw new DOMException("denied"); });
    const result = readLocalData(storage);
    expect(result.data.profile).toEqual(data.profile);
    expect(result.error).toBeTruthy();
    expect(storage.store.get(PROFILE_KEY)).toBe(raw);
    expect(storage.store.has(DATA_KEY)).toBe(false);
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  test("corrupt authoritative data is preserved without reviving a legacy profile", () => {
    const storage = stub({ [DATA_KEY]: "broken", [PROFILE_KEY]: JSON.stringify(fixture().profile) });
    const result = readLocalData(storage);
    expect(result.error).toBeTruthy();
    expect(result.recovery?.[DATA_KEY]).toBe("broken");
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(storage.store.get(DATA_KEY)).toBe("broken");
  });

  test("corrupt legacy history is not silently replaced by empty history", () => {
    const storage = stub({ [PROFILE_KEY]: JSON.stringify(fixture().profile), [CHECK_IN_KEY]: "broken" });
    const result = readLocalData(storage);
    expect(result.error).toBeTruthy();
    expect(result.recovery?.[CHECK_IN_KEY]).toBe("broken");
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  test("unavailable storage is reported without throwing", () => {
    expect(readLocalData(null).error).toBeTruthy();
    expect(writeLocalData(null, fixture())).toBe(false);
    const storage = stub();
    storage.getItem.mockImplementation(() => { throw new DOMException("denied"); });
    expect(readLocalData(storage).error).toBeTruthy();
  });
});
