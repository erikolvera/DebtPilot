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
 * Format a decimal string exactly, without ever constructing a float.
 *
 * `Intl.NumberFormat.prototype.format` accepts a decimal string at runtime
 * (ES2023) and formats it exactly. TypeScript, however, types the parameter as
 * `StringNumericLiteral` — literally `` `${number}` | "Infinity" | ... `` — and a
 * plain `string` is not assignable to that template-literal type. The cast is
 * therefore unavoidable, and confining it to this one helper is the whole
 * point: every money value in the app funnels through here, so there is exactly
 * one place to audit.
 *
 * The alternative, `format(Number(value))`, type-checks without complaint and
 * constructs the IEEE-754 double the backend's `_reject_json_numbers` validator
 * exists to keep out of this system — at the last possible moment, in the one
 * place nobody thinks to look. Do not "simplify" this helper into that.
 *
 * A non-numeric string renders as "$NaN" rather than throwing. That is a
 * visible bug rather than a silently wrong figure, and every value reaching
 * here originates as the engine's quantized Decimal output.
 */
function formatDecimal(formatter: Intl.NumberFormat, value: string): string {
  return formatter.format(value as `${number}`);
}

export function money(value: string): string {
  return formatDecimal(USD, value);
}

export function moneyWhole(value: string): string {
  return formatDecimal(USD_WHOLE, value);
}

// Keyed by the raw two-digit string rather than indexed by number, so this
// needs no float conversion -- see the no-restricted-syntax override for this
// file in eslint.config.mjs.
const MONTHS: Record<string, string> = {
  "01": "Jan", "02": "Feb", "03": "Mar", "04": "Apr", "05": "May", "06": "Jun",
  "07": "Jul", "08": "Aug", "09": "Sep", "10": "Oct", "11": "Nov", "12": "Dec",
};

/** "2029-07" -> "Jul 2029". */
export function calendarMonth(value: string): string {
  const [year, month] = value.split("-");
  return `${MONTHS[month]} ${year}`;
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
