import { describe, expect, test } from "vitest";
import type { MonthlyTotalOut, ScenarioOut } from "./api";
import {
  FALLBACK_DOMAIN_MONTHS,
  clipsAtEdge,
  wedgePath,
  xDomainMonths,
  yMaxBalance,
  yearTicks,
} from "./chart";

function totals(values: [number, string][]): MonthlyTotalOut[] {
  return values.map(([month_number, remaining_balance]) => ({
    month_number,
    month: "2026-09",
    remaining_balance,
    cumulative_interest: "0.00",
  })) as MonthlyTotalOut[];
}

function scenario(overrides: Partial<ScenarioOut>): ScenarioOut {
  return {
    strategy: "avalanche",
    outcome: "paid_off",
    months_to_payoff: 35,
    payoff_month: "2029-07",
    underwater_debt_ids: [],
    total_interest_paid: "0.00",
    total_paid: "0.00",
    debt_payoffs: [],
    monthly_totals: [],
    schedule: null,
    schedule_truncated: false,
    ...overrides,
  } as ScenarioOut;
}

describe("xDomainMonths", () => {
  test("is 1.15x the furthest finite payoff, rounded up to a whole year", () => {
    // The seeded portfolio: baseline null, snowball 37, avalanche 35.
    // 37 * 1.15 = 42.55 -> ceil to 4 years -> 48 months.
    const domain = xDomainMonths([
      scenario({ months_to_payoff: null, outcome: "never_pays_off" }),
      scenario({ months_to_payoff: 37 }),
      scenario({ months_to_payoff: 35 }),
    ]);
    expect(domain).toBe(48);
  });

  test("ignores never-paying-off scenarios when choosing the anchor", () => {
    expect(xDomainMonths([scenario({ months_to_payoff: null }), scenario({ months_to_payoff: 12 })]))
      .toBe(24);
  });

  test("falls back when nothing pays off", () => {
    // No finite anchor exists. All three tracks then clip, which is the
    // correct and complete answer.
    const domain = xDomainMonths([
      scenario({ months_to_payoff: null, outcome: "never_pays_off" }),
      scenario({ months_to_payoff: null, outcome: "never_pays_off" }),
    ]);
    expect(domain).toBe(FALLBACK_DOMAIN_MONTHS);
  });

  test("ignores a zero-month payoff from an empty portfolio", () => {
    expect(xDomainMonths([scenario({ months_to_payoff: 0 })])).toBe(FALLBACK_DOMAIN_MONTHS);
  });
});

describe("yMaxBalance", () => {
  test("scales to the starting balance, not the largest balance ever reached", () => {
    // The baseline GROWS under negative amortization. Scaling to its true
    // maximum would squash the two scenarios that matter into invisibility.
    const growing = scenario({
      monthly_totals: totals([[1, "6200.00"], [2, "6300.00"], [3, "80000.00"]]),
    });
    const shrinking = scenario({
      monthly_totals: totals([[1, "6000.00"], [2, "5800.00"], [3, "5600.00"]]),
    });
    expect(yMaxBalance([growing, shrinking])).toBe(6200);
  });

  test("never returns zero, so a division by it is always safe", () => {
    expect(yMaxBalance([scenario({ monthly_totals: [] })])).toBe(1);
    expect(yMaxBalance([scenario({ monthly_totals: totals([[1, "0.00"]]) })])).toBe(1);
  });
});

describe("wedgePath", () => {
  const lane = { width: 700, height: 40 };

  test("opens at full lane height and closes as a filled area", () => {
    const path = wedgePath(totals([[1, "5000.00"], [2, "2500.00"], [3, "0.00"]]), 48, 10000, lane);
    expect(path.startsWith("M 0.0 0.0")).toBe(true);
    expect(path.endsWith("Z")).toBe(true);
  });

  test("returns an empty path for an empty series", () => {
    expect(wedgePath([], 48, 10000, lane)).toBe("");
  });

  test("clamps a balance above the y-scale to the top of the lane", () => {
    // A baseline that grows past the starting balance fills its lane and
    // never rises out of it.
    const path = wedgePath(totals([[1, "999999.00"]]), 48, 6200, lane);
    expect(path).toContain(" 0.0");
    expect(path).not.toMatch(/-\d/);
  });

  test("down-samples to at most one point per rendered pixel column", () => {
    // A minimums-only baseline can carry 1200 rows. A path with 1200 points
    // in a 700px lane is bytes nobody can see.
    const long = totals(Array.from({ length: 1200 }, (_, i) => [i + 1, "1000.00"] as [number, string]));
    const path = wedgePath(long, 1200, 5000, lane);
    const lineCommands = (path.match(/L /g) ?? []).length;
    expect(lineCommands).toBeLessThanOrEqual(lane.width + 5);
  });

  test("carries a still-owing balance out to the axis edge", () => {
    // The engine exits as soon as it has proved a portfolio hopeless -- for an
    // all-underwater portfolio, after ONE month. Drawing only that window on a
    // 120-month axis renders a debt that never clears as a stub that clears
    // immediately, which is the opposite of the truth.
    const path = wedgePath(totals([[1, "11222.24"]]), 120, 11222.24, lane);
    expect(path).toContain(`L ${lane.width.toFixed(1)}`);
  });

  test("does not extend a series that reached zero", () => {
    // A paid-off scenario ends at exactly 0 -- balances are quantized to cents
    // with no epsilon -- and must stop at its payoff month, not run to the edge.
    const path = wedgePath(totals([[1, "5000.00"], [2, "0.00"]]), 48, 10000, lane);
    const endX = (2 / 48) * lane.width;
    expect(path).toContain(`L ${endX.toFixed(1)} ${lane.height.toFixed(1)}`);
    expect(path).not.toContain(`L ${lane.width.toFixed(1)} ${lane.height.toFixed(1)}`);
  });

  test("never emits a coordinate beyond the lane width", () => {
    const past = totals([[1, "1000.00"], [200, "1000.00"]]);
    const path = wedgePath(past, 48, 5000, lane);
    for (const [, x] of path.matchAll(/[ML] (\d+\.\d) /g)) {
      expect(Number(x)).toBeLessThanOrEqual(lane.width);
    }
  });
});

describe("yearTicks", () => {
  test("marks each January inside the domain", () => {
    expect(yearTicks("2026-09", 48)).toEqual([
      { month: 5, label: "2027" },
      { month: 17, label: "2028" },
      { month: 29, label: "2029" },
      { month: 41, label: "2030" },
    ]);
  });

  test("marks month 1 when the plan starts in January", () => {
    expect(yearTicks("2027-01", 13)[0]).toEqual({ month: 1, label: "2027" });
  });
});

describe("clipsAtEdge", () => {
  test("is true for a scenario that never pays off", () => {
    expect(clipsAtEdge(scenario({ outcome: "never_pays_off", months_to_payoff: null }), 48)).toBe(true);
  });

  test("is true for a scenario that pays off past the domain", () => {
    expect(clipsAtEdge(scenario({ months_to_payoff: 60 }), 48)).toBe(true);
  });

  test("is false for a scenario that terminates inside the domain", () => {
    expect(clipsAtEdge(scenario({ months_to_payoff: 35 }), 48)).toBe(false);
  });
});
