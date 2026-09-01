import { describe, expect, test } from "vitest";
import {
  createsEstimatedPayoff,
  effectiveStrategy,
  impactFor,
  optionFigures,
  type CompactOptionImpact,
  type PaymentOption,
} from "./payoffGuidance";

function impact(
  overrides: Partial<CompactOptionImpact> = {},
): CompactOptionImpact {
  return {
    outcome: "paid_off",
    months_to_payoff: 24,
    payoff_month: "2028-09",
    total_interest_paid: "1200.00",
    months_saved_vs_current: 6,
    interest_saved_vs_current: "350.00",
    ...overrides,
  };
}

function option(): PaymentOption {
  return {
    kind: "split_difference",
    extra_monthly_payment: "250.00",
    additional_monthly_payment: "100.00",
    monthly_cushion_remaining: "100.00",
    snowball: impact({ payoff_month: "2029-01" }),
    avalanche: impact({ payoff_month: "2028-09" }),
  };
}

describe("effectiveStrategy", () => {
  test("uses a saved preference before the recommendation", () => {
    expect(effectiveStrategy("snowball", "avalanche")).toBe("snowball");
  });

  test("uses the recommendation when there is no preference", () => {
    expect(effectiveStrategy(null, "snowball")).toBe("snowball");
  });

  test("falls back to Avalanche when neither is available", () => {
    expect(effectiveStrategy(null, null)).toBe("avalanche");
  });
});

test("impactFor reads the selected strategy only", () => {
  expect(impactFor(option(), "snowball").payoff_month).toBe("2029-01");
  expect(impactFor(option(), "avalanche").payoff_month).toBe("2028-09");
});

test("createsEstimatedPayoff identifies a payoff without inventing a delta", () => {
  const current = option();
  current.kind = "current";
  current.snowball = impact({
    outcome: "never_pays_off",
    months_to_payoff: null,
    payoff_month: null,
    months_saved_vs_current: null,
    interest_saved_vs_current: null,
  });
  const faster = option();
  faster.snowball.months_saved_vs_current = null;
  faster.snowball.interest_saved_vs_current = null;

  expect(createsEstimatedPayoff(current, faster, "snowball")).toBe(true);
  expect(createsEstimatedPayoff(current, faster, "avalanche")).toBe(false);
  expect(createsEstimatedPayoff(undefined, faster, "snowball")).toBe(false);
});

describe("optionFigures", () => {
  test("formats a paid-off result while preserving nullable comparisons", () => {
    const value = option();
    value.avalanche.months_saved_vs_current = null;
    value.avalanche.interest_saved_vs_current = null;

    expect(optionFigures(value, "avalanche")).toEqual({
      paidOff: true,
      payoffMonth: "Sep 2028",
      duration: "2 yr",
      totalInterest: "$1,200.00",
      monthsSaved: null,
      interestSaved: null,
    });
  });

  test("suppresses bounded totals and deltas when the option never pays off", () => {
    const value = option();
    value.snowball = impact({
      outcome: "never_pays_off",
      months_to_payoff: 1200,
      payoff_month: "2126-09",
      total_interest_paid: "99999.00",
      months_saved_vs_current: 12,
      interest_saved_vs_current: "500.00",
    });

    expect(optionFigures(value, "snowball")).toEqual({
      paidOff: false,
      payoffMonth: null,
      duration: null,
      totalInterest: null,
      monthsSaved: null,
      interestSaved: null,
    });
  });
});
