import { describe, expect, test } from "vitest";
import { seedPortfolio } from "./seed";
import { loadPortfolio, savePortfolio, type StorageLike } from "./storage";

function stub(initial?: string): StorageLike & { store: Map<string, string> } {
  const store = new Map<string, string>();
  if (initial !== undefined) store.set("debtpilot.portfolio.v1", initial);
  return {
    store,
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  };
}

const FALLBACK = seedPortfolio();

describe("loadPortfolio", () => {
  test("round-trips a saved portfolio", () => {
    const storage = stub();
    const saved = { debts: [{ id: "a", name: "A", balance: "10.00", apr: "1.00", minimum_payment: "2.00" }], extra: "50.00" };
    savePortfolio(storage, saved);
    expect(loadPortfolio(storage, FALLBACK)).toEqual(saved);
  });

  test("returns the fallback when nothing is stored", () => {
    expect(loadPortfolio(stub(), FALLBACK)).toEqual(FALLBACK);
  });

  test("returns the fallback for a corrupt blob rather than throwing", () => {
    // A half-written entry must not take the page down on load.
    expect(loadPortfolio(stub("{not json"), FALLBACK)).toEqual(FALLBACK);
  });

  test("returns the fallback when a money field is a number", () => {
    // An older build, or a hand-edited entry. A number here would reach the
    // request body and earn a 422 that looks like a server fault.
    const bad = JSON.stringify({ debts: [{ id: "a", name: "A", balance: 10, apr: "1.00", minimum_payment: "2.00" }], extra: "50.00" });
    expect(loadPortfolio(stub(bad), FALLBACK)).toEqual(FALLBACK);
  });

  test("returns the fallback for a shape that is not a portfolio", () => {
    expect(loadPortfolio(stub(JSON.stringify([1, 2, 3])), FALLBACK)).toEqual(FALLBACK);
    expect(loadPortfolio(stub(JSON.stringify({ debts: "no" })), FALLBACK)).toEqual(FALLBACK);
  });

  test("rejects a stored portfolio over the server's 20-debt cap", () => {
    const many = Array.from({ length: 21 }, (_, i) => ({
      id: String(i), name: "A", balance: "10.00", apr: "1.00", minimum_payment: "2.00",
    }));
    expect(loadPortfolio(stub(JSON.stringify({ debts: many, extra: "0.00" })), FALLBACK)).toEqual(FALLBACK);
  });

  test("accepts a stored portfolio at exactly the 20-debt cap", () => {
    // Pins the boundary direction: `>=` instead of `>` would discard the
    // user's saved portfolio on every reload, with this suite still green.
    const twenty = Array.from({ length: 20 }, (_, i) => ({
      id: String(i), name: "A", balance: "10.00", apr: "1.00", minimum_payment: "2.00",
    }));
    const saved = { debts: twenty, extra: "0.00" };
    expect(loadPortfolio(stub(JSON.stringify(saved)), FALLBACK)).toEqual(saved);
  });

  test("returns the fallback when storage itself throws", () => {
    // Safari in private mode throws on access rather than returning null.
    const hostile: StorageLike = {
      getItem: () => { throw new DOMException("denied"); },
      setItem: () => { throw new DOMException("denied"); },
    };
    expect(loadPortfolio(hostile, FALLBACK)).toEqual(FALLBACK);
  });

  test("returns the fallback when there is no storage at all", () => {
    expect(loadPortfolio(null, FALLBACK)).toEqual(FALLBACK);
  });
});

describe("savePortfolio", () => {
  test("swallows a quota error rather than breaking the keystroke that caused it", () => {
    const hostile: StorageLike = {
      getItem: () => null,
      setItem: () => { throw new DOMException("QuotaExceededError"); },
    };
    expect(() => savePortfolio(hostile, FALLBACK)).not.toThrow();
    expect(() => savePortfolio(null, FALLBACK)).not.toThrow();
  });
});
