import { describe, expect, test } from "vitest";
import type { FinancialReportResponse } from "./api";
import {
  commitmentSentence,
  commitmentSuggestions,
  nextCalendarMonth,
  progressCopy,
} from "./checkIn";

function report(
  status: "deficit" | "break_even" | "surplus",
  plannedExtra: string,
): FinancialReportResponse {
  return {
    start_month: "2026-09",
    total_debt: "1000.00",
    cash_flow: {
      total_monthly_income: "3000.00",
      total_monthly_expenses: "2000.00",
      total_minimum_debt_payments: "200.00",
      available_monthly_cash_flow: status === "deficit" ? "-100.00" : "800.00",
      shortfall: status === "deficit" ? "100.00" : "0.00",
      maximum_affordable_extra_payment: status === "deficit" ? "0.00" : "800.00",
      status,
    },
    debt_payment_budget: {
      requested_extra_monthly_payment: plannedExtra,
      planned_extra_monthly_payment: plannedExtra,
      unallocated_cash_flow: "0.00",
      extra_payment_gap: "0.00",
      is_affordable: true,
    },
    payoff_plan: null,
    payoff_guidance: null,
    check_in_progress: null,
    recommendations: [],
    estimate_disclosure: "Estimate",
  };
}

test("calendar month arithmetic crosses a year boundary", () => {
  expect(nextCalendarMonth("2026-09")).toBe("2026-10");
  expect(nextCalendarMonth("2026-12")).toBe("2027-01");
});

describe("commitment suggestions", () => {
  test("offers an affordable extra, minimum protection, and a return check-in", () => {
    const suggestions = commitmentSuggestions(report("surplus", "125.00"), "2026-09", true);
    expect(suggestions.map((item) => item.kind)).toEqual([
      "planned_extra",
      "protect_minimums",
      "review_balances",
    ]);
    expect(suggestions[0].sentence).toContain("$125.00");
    expect(suggestions[2].sentence).toContain("Oct 2026");
  });

  test("zero-extra and break-even plans do not promise an extra payment", () => {
    expect(
      commitmentSuggestions(report("break_even", "0.00"), "2026-09", true).map(
        (item) => item.kind,
      ),
    ).toEqual(["protect_minimums", "review_balances"]);
  });

  test("a deficit gets recovery commitments instead of acceleration", () => {
    const suggestions = commitmentSuggestions(report("deficit", "0.00"), "2026-09", true);
    expect(suggestions.map((item) => item.kind)).toEqual([
      "review_shortfall",
      "contact_creditor",
      "review_balances",
    ]);
    expect(suggestions[0].sentence).toContain("$100.00");
  });

  test("a completed debt plan offers only the next review", () => {
    expect(
      commitmentSuggestions(report("break_even", "0.00"), "2026-09", false).map(
        (item) => item.kind,
      ),
    ).toEqual(["review_balances"]);
  });

  test("commitment copy is deterministic for every kind", () => {
    const base = { createdMonth: "2026-09", targetMonth: "2026-10", amount: null };
    expect(commitmentSentence({ ...base, kind: "protect_minimums" })).toContain("minimum");
    expect(commitmentSentence({ ...base, kind: "contact_creditor" })).toContain("contact");
  });
});

describe("progress presentation", () => {
  test("renders exact decreases and compassionate increases", () => {
    expect(
      progressCopy({ status: "decreased", amount: "10.10" }, "2026-08").title,
    ).toBe("Your tracked debt is down $10.10.");
    const increase = progressCopy(
      { status: "increased", amount: "5.00" },
      "2026-08",
    );
    expect(increase.title).toBe("Your tracked debt is up $5.00.");
    expect(increase.detail).toContain("information, not failure");
  });

  test("does not invent figures for unchanged or changed portfolios", () => {
    expect(progressCopy({ status: "unchanged", amount: "0.00" }, "2026-08").title).toBe(
      "Your balance is unchanged.",
    );
    expect(
      progressCopy({ status: "portfolio_changed", amount: null }, "2026-08").detail,
    ).toContain("misleading");
  });
});
