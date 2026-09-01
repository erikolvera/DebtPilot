import type { MonthlyTotalOut, ScenarioOut } from "./api";

/**
 * Geometry only.
 *
 * `Number()` is used freely here because these values become SVG pixel
 * coordinates. That is one of four sanctioned non-money uses in the app — the
 * others are a bounds comparison in `validate.ts`, a month-array index in
 * `format.ts`, and the range-slider round-trip in `ExtraPayment.tsx`. What the
 * rule actually forbids is converting a MONEY value anywhere, because the
 * backend's contract is a decimal string end to end.
 *
 * `yearTicks` is the one function here that produces text rather than
 * geometry; a four-digit year is exact in a double, so it is safe.
 */

/** Used when no scenario pays off, so there is no finite anchor for the axis. */
export const FALLBACK_DOMAIN_MONTHS = 120;

const HEADROOM = 1.15;

/** The x-axis span: 1.15x the furthest finite payoff, rounded up to a whole year. */
export function xDomainMonths(scenarios: ScenarioOut[]): number {
  const finite = scenarios
    .map((s) => s.months_to_payoff)
    .filter((m): m is number => m !== null && m > 0);
  if (finite.length === 0) return FALLBACK_DOMAIN_MONTHS;
  return Math.ceil((Math.max(...finite) * HEADROOM) / 12) * 12;
}

/**
 * The shared y-scale: the largest starting balance across scenarios.
 *
 * Deliberately not the largest balance ever reached. Under negative
 * amortization the minimums-only baseline grows without bound, and scaling to
 * that maximum would squash snowball and avalanche into invisibility. Clamping
 * instead makes the baseline a full-height band that never tapers — a truthful
 * reading of a balance that never falls.
 */
export function yMaxBalance(scenarios: ScenarioOut[]): number {
  let max = 0;
  for (const scenario of scenarios) {
    const first = scenario.monthly_totals[0];
    if (first) max = Math.max(max, Number(first.remaining_balance));
  }
  return max > 0 ? max : 1;
}

export type Lane = { width: number; height: number };

/** An SVG path for one scenario's wedge: the balance curve, filled to the lane floor. */
export function wedgePath(
  totals: MonthlyTotalOut[],
  domainMonths: number,
  yMax: number,
  lane: Lane,
): string {
  if (totals.length === 0 || domainMonths <= 0) return "";

  const x = (month: number) => Math.min(month / domainMonths, 1) * lane.width;
  const y = (balance: number) => lane.height - Math.min(balance / yMax, 1) * lane.height;

  // At most one sample per rendered pixel column.
  const step = Math.max(1, Math.ceil(totals.length / lane.width));

  const parts: string[] = [`M ${x(0).toFixed(1)} ${y(yMax).toFixed(1)}`];
  for (let i = 0; i < totals.length; i += step) {
    const point = totals[i];
    parts.push(`L ${x(point.month_number).toFixed(1)} ${y(Number(point.remaining_balance)).toFixed(1)}`);
  }
  const last = totals[totals.length - 1];
  parts.push(`L ${x(last.month_number).toFixed(1)} ${y(Number(last.remaining_balance)).toFixed(1)}`);
  parts.push(`L ${x(last.month_number).toFixed(1)} ${lane.height.toFixed(1)}`);
  parts.push(`L ${x(0).toFixed(1)} ${lane.height.toFixed(1)}`);
  parts.push("Z");
  return parts.join(" ");
}

/** One tick per calendar January inside the domain. */
export function yearTicks(
  startMonth: string,
  domainMonths: number,
): { month: number; label: string }[] {
  const [startYear, startMonthNumber] = startMonth.split("-").map(Number);
  const ticks: { month: number; label: string }[] = [];
  for (let i = 0; i < domainMonths; i++) {
    const absolute = startMonthNumber - 1 + i;
    if (absolute % 12 === 0) {
      ticks.push({ month: i + 1, label: String(startYear + Math.floor(absolute / 12)) });
    }
  }
  return ticks;
}

/** Whether this scenario's wedge runs past the axis and must fade out at the edge. */
export function clipsAtEdge(scenario: ScenarioOut, domainMonths: number): boolean {
  if (scenario.outcome !== "paid_off") return true;
  return scenario.months_to_payoff === null || scenario.months_to_payoff > domainMonths;
}
