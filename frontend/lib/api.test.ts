import { describe, expect, test } from "vitest";
import {
  apiBase,
  buildRequest,
  currentStartMonth,
  DEFAULT_API_BASE,
  type DebtDraft,
} from "./api";

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

describe("apiBase", () => {
  test("uses the supplied origin", () => {
    expect(apiBase("https://api.example.com")).toBe("https://api.example.com");
  });

  test("falls back when the variable is unset", () => {
    expect(apiBase(undefined)).toBe(DEFAULT_API_BASE);
  });

  test("falls back when the variable is an empty or blank string", () => {
    // `??` would let these through, and every request would then resolve as a
    // relative path -- silently wrong anywhere the page is not served from the
    // API's own origin, and failing as a confusing 404 rather than as missing
    // configuration. An empty value in a deploy dashboard is trivially easy.
    expect(apiBase("")).toBe(DEFAULT_API_BASE);
    expect(apiBase("   ")).toBe(DEFAULT_API_BASE);
  });

  test("strips trailing slashes so paths do not double up", () => {
    // Paths are concatenated as `${BASE}${path}` where path starts with "/".
    expect(apiBase("https://api.example.com/")).toBe("https://api.example.com");
    expect(apiBase("https://api.example.com///")).toBe("https://api.example.com");
  });

  test("leaves an internal path segment alone", () => {
    expect(apiBase("https://example.com/api/")).toBe("https://example.com/api");
  });
});
