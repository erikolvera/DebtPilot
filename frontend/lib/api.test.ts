import { describe, expect, test } from "vitest";
import { buildRequest, currentStartMonth, type DebtDraft } from "./api";

const DRAFTS: DebtDraft[] = [
  { id: "visa", name: "Visa Signature", balance: "6120.00", apr: "24.99", minimum_payment: "122.40" },
  { id: "store", name: "  Store card  ", balance: "1840.00", apr: "27.99", minimum_payment: "46.00" },
];

describe("currentStartMonth", () => {
  test("formats as YYYY-MM with a zero-padded month", () => {
    expect(currentStartMonth(new Date(2026, 8, 15))).toBe("2026-09");
    expect(currentStartMonth(new Date(2027, 0, 1))).toBe("2027-01");
    expect(currentStartMonth(new Date(2027, 11, 31))).toBe("2027-12");
  });

  test("matches the pattern the API requires", () => {
    expect(currentStartMonth(new Date(2026, 8, 15))).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/);
  });
});

describe("buildRequest", () => {
  test("every money field leaves as a string, never a number", () => {
    const body = buildRequest(DRAFTS, "200.00", new Date(2026, 8, 1));
    expect(typeof body.extra_monthly_payment).toBe("string");
    for (const debt of body.debts) {
      expect(typeof debt.balance).toBe("string");
      expect(typeof debt.apr).toBe("string");
      expect(typeof debt.minimum_payment).toBe("string");
    }
  });

  test("survives a JSON round trip without any value becoming a number", () => {
    // The API returns 422 for a bare JSON number. This asserts the property
    // on the actual serialized bytes rather than on the object.
    const wire = JSON.parse(JSON.stringify(buildRequest(DRAFTS, "200.00", new Date(2026, 8, 1))));
    expect(wire.debts[0].balance).toBe("6120.00");
    expect(wire.extra_monthly_payment).toBe("200.00");
  });

  test("preserves trailing-zero precision exactly", () => {
    const drafts: DebtDraft[] = [
      { id: "a", name: "A", balance: "1000.10", apr: "0.00", minimum_payment: "25.00" },
    ];
    const body = buildRequest(drafts, "0.00", new Date(2026, 8, 1));
    // A parseFloat/toFixed round trip would render these "1000.1" and "0".
    expect(body.debts[0].balance).toBe("1000.10");
    expect(body.debts[0].apr).toBe("0.00");
    expect(body.extra_monthly_payment).toBe("0.00");
  });

  test("trims debt names, matching the server's NonBlankName validator", () => {
    const body = buildRequest(DRAFTS, "200.00", new Date(2026, 8, 1));
    expect(body.debts[1].name).toBe("Store card");
  });

  test("emits no keys beyond the contract, which forbids extras", () => {
    const body = buildRequest(DRAFTS, "200.00", new Date(2026, 8, 1));
    expect(Object.keys(body).sort()).toEqual(["debts", "extra_monthly_payment", "start_month"]);
    expect(Object.keys(body.debts[0]).sort()).toEqual(["apr", "balance", "id", "minimum_payment", "name"]);
  });
});
