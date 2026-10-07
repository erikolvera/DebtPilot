import { describe, expect, test } from "vitest";
import type { DebtDraft } from "./api";
import {
  debtErrors,
  isFinancialReportSendable,
  reportExtraError,
} from "./validate";

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

describe("reportExtraError", () => {
  test("accepts zero and a plain decimal", () => {
    expect(reportExtraError("0.00")).toBeNull();
    expect(reportExtraError("200")).toBeNull();
  });

  test("rejects an empty or malformed amount", () => {
    expect(reportExtraError("")).not.toBeNull();
    expect(reportExtraError("-1")).not.toBeNull();
  });

  test("accepts the report-wide ceiling without widening individual fields", () => {
    expect(reportExtraError("21666666664.50")).toBeNull();
    expect(reportExtraError("21666666664.51")).not.toBeNull();
    expect(debtErrors({ ...OK, balance: "100000000.00" }).balance).toBeDefined();
  });

  test("is used by financial-report sendability", () => {
    expect(isFinancialReportSendable([], [], [], "21666666664.50")).toBe(true);
    expect(isFinancialReportSendable([], [], [], "21666666664.51")).toBe(false);
  });
});
