import { describe, expect, test, vi } from "vitest";
import {
  apiBase,
  buildFinancialReportRequest,
  currentStartMonth,
  DEFAULT_API_BASE,
  type ExpenseDraft,
  type FinancialDebtDraft,
  type IncomeDraft,
} from "./api";

const INCOMES: IncomeDraft[] = [
  { id: "pay", name: "  Take-home pay  ", amount: "2307.69", frequency: "biweekly" },
];
const EXPENSES: ExpenseDraft[] = [
  { id: "rent", name: "  Rent  ", category: "housing", monthly_amount: "1500.00" },
];
const DEBTS: FinancialDebtDraft[] = [
  {
    id: "visa",
    name: "  Visa  ",
    type: "credit_card",
    balance: "6120.00",
    apr: "24.99",
    minimum_payment: "122.40",
  },
];

test("currentStartMonth produces the API's YYYY-MM value", () => {
  expect(currentStartMonth(new Date(2026, 8, 15))).toBe("2026-09");
  expect(currentStartMonth(new Date(2027, 0, 1))).toBe("2027-01");
});

test("the financial report request keeps every money value as a string", () => {
  const body = buildFinancialReportRequest(
    INCOMES,
    EXPENSES,
    DEBTS,
    "600.00",
    new Date(2026, 8, 1),
  );
  const wire = JSON.parse(JSON.stringify(body));

  expect(wire.incomes[0].amount).toBe("2307.69");
  expect(wire.incomes[0].frequency).toBe("biweekly");
  expect(wire.expenses[0].monthly_amount).toBe("1500.00");
  expect(wire.debts[0].balance).toBe("6120.00");
  expect(wire.requested_extra_monthly_payment).toBe("600.00");
  expect(wire.incomes[0].name).toBe("Take-home pay");
  expect(wire.expenses[0].name).toBe("Rent");
  expect(wire.debts[0].name).toBe("Visa");
  expect(wire.start_month).toBe("2026-09");
});

test("a check-in request includes only explicit Decimal-string snapshots", () => {
  const request = buildFinancialReportRequest(
    [],
    [],
    [
      {
        id: "card",
        name: "Card",
        type: "credit_card",
        balance: "90.00",
        apr: "10.00",
        minimum_payment: "10.00",
      },
    ],
    "0.00",
    new Date(2026, 8, 1),
    {
      baseline: { month: "2026-07", debts: [{ id: "card", balance: "100.00" }] },
      previous: { month: "2026-08", debts: [{ id: "card", balance: "95.00" }] },
    },
  );
  expect(request.check_in_context?.previous.debts[0].balance).toBe("95.00");
  expect(JSON.stringify(request)).not.toContain('"balance":95');
});

describe("apiBase", () => {
  test("normalizes a supplied origin", () => {
    expect(apiBase("https://api.example.com///")).toBe("https://api.example.com");
    expect(apiBase("/")).toBe(DEFAULT_API_BASE);
  });

  test("uses the environment and local fallback", () => {
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "https://from-env.example.com/");
    expect(apiBase()).toBe("https://from-env.example.com");
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", undefined);
    expect(apiBase()).toBe(DEFAULT_API_BASE);
    vi.unstubAllEnvs();
  });

  test("rejects a blank production API origin", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => apiBase("")).toThrow(/NEXT_PUBLIC_API_BASE_URL/);
    vi.unstubAllEnvs();
  });
});
