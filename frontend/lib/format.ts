import type { ScenarioOut } from "./api";

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const USD_WHOLE = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/**
 * Format an API money string.
 *
 * `Intl.NumberFormat.prototype.format` accepts a decimal string (ES2023) and
 * formats it exactly. Writing `format(Number(value))` instead would construct
 * the IEEE-754 double that the backend's `_reject_json_numbers` validator
 * exists to keep out of this system — at the last possible moment, in the one
 * place nobody thinks to look.
 */
export function money(value: string): string {
  return USD.format(value);
}

export function moneyWhole(value: string): string {
  return USD_WHOLE.format(value);
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "2029-07" -> "Jul 2029". */
export function calendarMonth(value: string): string {
  const [year, month] = value.split("-");
  return `${MONTHS[Number(month) - 1]} ${year}`;
}

/** 37 -> "3 yr 1 mo". Duration, not money: integer arithmetic is fine here. */
export function monthCount(months: number): string {
  const years = Math.floor(months / 12);
  const rest = months % 12;
  if (years === 0) return `${rest} mo`;
  if (rest === 0) return `${years} yr`;
  return `${years} yr ${rest} mo`;
}

/**
 * A comparison delta, or an em dash.
 *
 * Every delta on `ComparisonOut` is nullable because you cannot subtract from
 * a plan that never pays off. This function is the whole handling: it never
 * reconstructs a missing delta from the two totals sitting beside it.
 */
export function delta(value: string | null): string {
  return value === null ? "—" : money(value);
}

export type ScenarioFigures = {
  strategy: ScenarioOut["strategy"];
  outcome: ScenarioOut["outcome"];
  paidOff: boolean;
  months: number | null;
  payoffMonth: string | null;
  duration: string | null;
  totalInterest: string | null;
  /** Whole dollars, for the chart's compact marker labels. */
  totalInterestWhole: string | null;
  totalPaid: string | null;
  underwaterIds: string[];
};

/**
 * Everything a scenario is allowed to display.
 *
 * The suppression of spec §3.4 lives here and only here. `total_interest_paid`
 * and `total_paid` are populated for a never-paying-off run, but they cover the
 * simulated window — up to the MAX_MONTHS backstop — not a lifetime.
 * `guidance/presentation.py` withholds them from the AI layer for exactly this
 * reason; a table that stated them would contradict the prose beside it.
 */
export function scenarioFigures(scenario: ScenarioOut): ScenarioFigures {
  const base = {
    strategy: scenario.strategy,
    outcome: scenario.outcome,
    underwaterIds: [...scenario.underwater_debt_ids],
  };

  if (scenario.outcome !== "paid_off") {
    return {
      ...base,
      paidOff: false,
      months: null,
      payoffMonth: null,
      duration: null,
      totalInterest: null,
      totalInterestWhole: null,
      totalPaid: null,
    };
  }

  return {
    ...base,
    paidOff: true,
    months: scenario.months_to_payoff,
    payoffMonth: scenario.payoff_month === null ? null : calendarMonth(scenario.payoff_month),
    duration: scenario.months_to_payoff === null ? null : monthCount(scenario.months_to_payoff),
    totalInterest: money(scenario.total_interest_paid),
    totalInterestWhole: moneyWhole(scenario.total_interest_paid),
    totalPaid: money(scenario.total_paid),
  };
}
