import { describe, expect, test } from "vitest";
import { seedFinancialProfile } from "./seed";
import {
  loadFinancialProfile,
  saveFinancialProfile,
  type FinancialProfile,
  type StorageLike,
} from "./profileStorage";

function stub(entries: Record<string, string> = {}): StorageLike {
  const store = new Map(Object.entries(entries));
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
  };
}

const FALLBACK = seedFinancialProfile();

test("a complete financial profile round-trips", () => {
  const storage = stub();
  const saved: FinancialProfile = {
    incomes: [{ id: "pay", name: "Pay", amount: "461.54", frequency: "biweekly" }],
    expenses: [
      { id: "rent", name: "Rent", category: "housing", monthly_amount: "500.00" },
    ],
    debts: [
      {
        id: "card",
        name: "Card",
        type: "credit_card",
        balance: "100.00",
        apr: "10.00",
        minimum_payment: "20.00",
      },
    ],
    extra: "50.00",
    preferredStrategy: "snowball",
  };
  saveFinancialProfile(storage, saved);
  expect(loadFinancialProfile(storage, FALLBACK)).toEqual(saved);
});

test("a v3 profile migrates without changing financial entries", () => {
  const previous = {
    incomes: [{ id: "pay", name: "Pay", amount: "461.54", frequency: "biweekly" }],
    expenses: [
      { id: "rent", name: "Rent", category: "housing", monthly_amount: "500.00" },
    ],
    debts: [
      {
        id: "card",
        name: "Card",
        type: "credit_card",
        balance: "100.00",
        apr: "10.00",
        minimum_payment: "20.00",
      },
    ],
    extra: "50.00",
  };
  const loaded = loadFinancialProfile(
    stub({ "debtpilot.financial-profile.v3": JSON.stringify(previous) }),
    FALLBACK,
  );
  expect(loaded).toEqual({ ...previous, preferredStrategy: null });
});

test("a v2 monthly profile migrates to an explicit monthly frequency", () => {
  const previous = {
    incomes: [{ id: "pay", name: "Pay", monthly_amount: "1000.00" }],
    expenses: [],
    debts: [],
    extra: "0.00",
  };
  const loaded = loadFinancialProfile(
    stub({ "debtpilot.financial-profile.v2": JSON.stringify(previous) }),
    FALLBACK,
  );
  expect(loaded.incomes).toEqual([
    { id: "pay", name: "Pay", amount: "1000.00", frequency: "monthly" },
  ]);
  expect(loaded.preferredStrategy).toBeNull();
});

test("a legacy debt portfolio migrates without inventing income or expenses", () => {
  const legacy = {
    debts: [
      { id: "a", name: "Visa", balance: "10.00", apr: "1.00", minimum_payment: "2.00" },
    ],
    extra: "5.00",
  };
  const loaded = loadFinancialProfile(
    stub({ "debtpilot.portfolio.v1": JSON.stringify(legacy) }),
    FALLBACK,
  );
  expect(loaded.incomes).toEqual([]);
  expect(loaded.expenses).toEqual([]);
  expect(loaded.debts[0].type).toBe("credit_card");
  expect(loaded.preferredStrategy).toBeNull();
});

describe("invalid or unavailable storage", () => {
  test("falls back for malformed and unknown shapes", () => {
    expect(
      loadFinancialProfile(
        stub({ "debtpilot.financial-profile.v4": "not json" }),
        FALLBACK,
      ),
    ).toEqual(FALLBACK);
    expect(
      loadFinancialProfile(
        stub({ "debtpilot.financial-profile.v4": JSON.stringify({ extra: "0.00" }) }),
        FALLBACK,
      ),
    ).toEqual(FALLBACK);
  });

  test("falls back when a v4 strategy preference is unknown", () => {
    expect(
      loadFinancialProfile(
        stub({
          "debtpilot.financial-profile.v4": JSON.stringify({
            ...FALLBACK,
            preferredStrategy: "minimums_only",
          }),
        }),
        FALLBACK,
      ),
    ).toEqual(FALLBACK);
  });

  test("falls back when storage is absent or throws", () => {
    const hostile: StorageLike = {
      getItem: () => { throw new DOMException("denied"); },
      setItem: () => { throw new DOMException("denied"); },
    };
    expect(loadFinancialProfile(null, FALLBACK)).toEqual(FALLBACK);
    expect(loadFinancialProfile(hostile, FALLBACK)).toEqual(FALLBACK);
    expect(() => saveFinancialProfile(null, FALLBACK)).not.toThrow();
    expect(() => saveFinancialProfile(hostile, FALLBACK)).not.toThrow();
  });
});
