import type { FinancialReportResponse } from "./api";
import { calendarMonth, money, monthCount } from "./format";

export type PayoffGuidance = NonNullable<FinancialReportResponse["payoff_guidance"]>;
export type PayoffStrategy = NonNullable<PayoffGuidance["recommended_strategy"]>;
export type PaymentOption = PayoffGuidance["payment_options"][number];
export type PaymentOptionKind = PaymentOption["kind"];
export type CompactOptionImpact = PaymentOption["snowball"];

export type OptionFigures = {
  paidOff: boolean;
  payoffMonth: string | null;
  duration: string | null;
  totalInterest: string | null;
  monthsSaved: number | null;
  interestSaved: string | null;
};

export function effectiveStrategy(
  preferred: PayoffStrategy | null,
  recommended: PayoffStrategy | null,
): PayoffStrategy {
  return preferred ?? recommended ?? "avalanche";
}

export function impactFor(
  option: PaymentOption,
  strategy: PayoffStrategy,
): CompactOptionImpact {
  return option[strategy];
}

export function createsEstimatedPayoff(
  current: PaymentOption | undefined,
  option: PaymentOption,
  strategy: PayoffStrategy,
): boolean {
  return (
    current?.[strategy].outcome === "never_pays_off" &&
    option[strategy].outcome === "paid_off"
  );
}

export function optionFigures(
  option: PaymentOption,
  strategy: PayoffStrategy,
): OptionFigures {
  const impact = impactFor(option, strategy);
  if (impact.outcome !== "paid_off") {
    return {
      paidOff: false,
      payoffMonth: null,
      duration: null,
      totalInterest: null,
      monthsSaved: null,
      interestSaved: null,
    };
  }

  return {
    paidOff: true,
    payoffMonth:
      impact.payoff_month === null ? null : calendarMonth(impact.payoff_month),
    duration:
      impact.months_to_payoff === null ? null : monthCount(impact.months_to_payoff),
    totalInterest: money(impact.total_interest_paid),
    monthsSaved: impact.months_saved_vs_current,
    interestSaved:
      impact.interest_saved_vs_current === null
        ? null
        : money(impact.interest_saved_vs_current),
  };
}
