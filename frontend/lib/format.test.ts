import { describe, expect, test } from "vitest";
import type { ScenarioOut } from "./api";
import { calendarMonth, delta, money, moneyWhole, monthCount, scenarioFigures } from "./format";

/** A minimal ScenarioOut. Fields not under test carry harmless values. */
function scenario(overrides: Partial<ScenarioOut>): ScenarioOut {
  return {
    strategy: "avalanche",
    outcome: "paid_off",
    months_to_payoff: 35,
    payoff_month: "2029-07",
    underwater_debt_ids: [],
    total_interest_paid: "3859.60",
    total_paid: "15069.60",
    debt_payoffs: [],
    monthly_totals: [],
    schedule: null,
    schedule_truncated: false,
    ...overrides,
  } as ScenarioOut;
}

describe("money", () => {
  test("formats a decimal string without constructing a float", () => {
    expect(money("6120.00")).toBe("$6,120.00");
    expect(money("91219.95")).toBe("$91,219.95");
    expect(money("0.00")).toBe("$0.00");
  });

  test("formats the contract's maximum exactly", () => {
    // MONEY_MAX on the server. Worth pinning: this is where a float would
    // first visibly lose a cent.
    expect(money("99999999.99")).toBe("$99,999,999.99");
  });

  test("moneyWhole drops the cents", () => {
    expect(moneyWhole("3859.60")).toBe("$3,860");
    expect(moneyWhole("4394.32")).toBe("$4,394");
  });
});

describe("calendarMonth", () => {
  test("renders YYYY-MM as an abbreviated month and year", () => {
    expect(calendarMonth("2029-07")).toBe("Jul 2029");
    expect(calendarMonth("2026-01")).toBe("Jan 2026");
    expect(calendarMonth("2026-12")).toBe("Dec 2026");
  });
});

describe("monthCount", () => {
  test("renders months as years and months", () => {
    expect(monthCount(35)).toBe("2 yr 11 mo");
    expect(monthCount(37)).toBe("3 yr 1 mo");
    expect(monthCount(24)).toBe("2 yr");
    expect(monthCount(7)).toBe("7 mo");
    expect(monthCount(1)).toBe("1 mo");
  });
});

describe("delta", () => {
  test("renders a null delta as an em dash rather than computing one", () => {
    expect(delta(null)).toBe("—");
  });

  test("formats a present delta as money", () => {
    expect(delta("534.72")).toBe("$534.72");
  });
});

describe("scenarioFigures", () => {
  test("passes through every figure for a scenario that pays off", () => {
    const figures = scenarioFigures(scenario({}));
    expect(figures.outcome).toBe("paid_off");
    expect(figures.payoffMonth).toBe("Jul 2029");
    expect(figures.months).toBe(35);
    expect(figures.totalInterest).toBe("$3,859.60");
    expect(figures.totalInterestWhole).toBe("$3,860");
    expect(figures.totalPaid).toBe("$15,069.60");
  });

  test("suppresses the totals for a scenario that never pays off", () => {
    // Spec §3.4. The API populates these fields, but they cover the simulated
    // window rather than a lifetime. Rendering "$91,219.95" beside "never pays
    // off" states a bounded price for something that does not end, and
    // contradicts the narrative printed next to it, which omits it by design.
    const figures = scenarioFigures(
      scenario({
        strategy: "minimum_only",
        outcome: "never_pays_off",
        months_to_payoff: null,
        payoff_month: null,
        total_interest_paid: "91219.95",
        total_paid: "93377.74",
        underwater_debt_ids: ["visa"],
      }),
    );
    expect(figures.outcome).toBe("never_pays_off");
    expect(figures.totalInterest).toBeNull();
    expect(figures.totalInterestWhole).toBeNull();
    expect(figures.totalPaid).toBeNull();
    expect(figures.months).toBeNull();
    expect(figures.payoffMonth).toBeNull();
    expect(figures.underwaterIds).toEqual(["visa"]);
  });

  test("suppresses totals even when the API populates a payoff month", () => {
    // Defence in depth: the guard keys on `outcome`, never on whether the
    // other fields happen to be null.
    const figures = scenarioFigures(
      scenario({ outcome: "never_pays_off", payoff_month: "2099-01", months_to_payoff: 876 }),
    );
    expect(figures.totalInterest).toBeNull();
    expect(figures.payoffMonth).toBeNull();
    expect(figures.months).toBeNull();
  });
});
