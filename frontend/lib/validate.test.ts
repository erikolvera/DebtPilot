import { describe, expect, test } from "vitest";
import type { DebtDraft } from "./api";
import { debtErrors, extraError, isSendable } from "./validate";

const OK: DebtDraft = {
  id: "a", name: "Visa", balance: "6120.00", apr: "24.99", minimum_payment: "122.40",
};

describe("debtErrors", () => {
  test("accepts a well-formed row", () => {
    expect(debtErrors(OK)).toEqual({});
  });

  test("accepts money with no decimal part or a single decimal place", () => {
    expect(debtErrors({ ...OK, balance: "6120" })).toEqual({});
    expect(debtErrors({ ...OK, balance: "6120.5" })).toEqual({});
  });

  test("rejects an empty or whitespace-only name, matching the server", () => {
    expect(debtErrors({ ...OK, name: "" }).name).toBeDefined();
    expect(debtErrors({ ...OK, name: "   " }).name).toBeDefined();
  });

  test("rejects a name over 120 characters", () => {
    expect(debtErrors({ ...OK, name: "x".repeat(121) }).name).toBeDefined();
    expect(debtErrors({ ...OK, name: "x".repeat(120) }).name).toBeUndefined();
  });

  test("rejects money that is not a plain decimal", () => {
    for (const bad of ["", "  ", "abc", "-5.00", "1,200.00", "1e5", "5.123", "$5"]) {
      expect(debtErrors({ ...OK, balance: bad }).balance).toBeDefined();
    }
  });

  test("bounds money at the server's MONEY_MAX", () => {
    expect(debtErrors({ ...OK, balance: "99999999.99" }).balance).toBeUndefined();
    expect(debtErrors({ ...OK, balance: "100000000.00" }).balance).toBeDefined();
  });

  test("bounds APR at 999.99 with at most two decimals", () => {
    expect(debtErrors({ ...OK, apr: "0" }).apr).toBeUndefined();
    expect(debtErrors({ ...OK, apr: "999.99" }).apr).toBeUndefined();
    expect(debtErrors({ ...OK, apr: "1000.00" }).apr).toBeDefined();
  });

  test("accepts a zero minimum payment on a live balance", () => {
    // The engine accepts this deliberately; its no-progress check catches it.
    // Rejecting it here would refuse a question the engine can answer.
    expect(debtErrors({ ...OK, minimum_payment: "0.00" })).toEqual({});
  });
});

describe("extraError", () => {
  test("accepts zero and a plain decimal", () => {
    expect(extraError("0.00")).toBeNull();
    expect(extraError("200")).toBeNull();
  });

  test("rejects an empty or malformed amount", () => {
    expect(extraError("")).not.toBeNull();
    expect(extraError("-1")).not.toBeNull();
  });
});

describe("isSendable", () => {
  test("is false while any row is mid-edit", () => {
    expect(isSendable([{ ...OK, balance: "" }], "200.00")).toBe(false);
  });

  test("is false for an empty portfolio", () => {
    // Nothing to plan. The page shows its empty state instead of a request.
    expect(isSendable([], "200.00")).toBe(false);
  });

  test("is false above the server's 20-debt cap", () => {
    const many = Array.from({ length: 21 }, (_, i) => ({ ...OK, id: String(i) }));
    expect(isSendable(many, "200.00")).toBe(false);
  });

  test("is true for a valid portfolio", () => {
    expect(isSendable([OK], "200.00")).toBe(true);
  });
});
