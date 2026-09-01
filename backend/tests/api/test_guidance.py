from decimal import Decimal

from app.api.guidance import _recommended_strategy
from app.engine import Outcome, PlanComparison, PlanSummary, Strategy


def summary(
    strategy: Strategy, outcome: Outcome, interest: str
) -> PlanSummary:
    return PlanSummary(
        strategy=strategy,
        outcome=outcome,
        months_to_payoff=3 if outcome is Outcome.PAID_OFF else None,
        underwater_debt_ids=(),
        total_interest_paid=Decimal(interest),
        total_paid=Decimal("100.00"),
        debt_payoffs=(),
        monthly_totals=(),
    )


def comparison(snowball: PlanSummary, avalanche: PlanSummary) -> PlanComparison:
    return PlanComparison(
        snowball=snowball,
        avalanche=avalanche,
        baseline=snowball,
        interest_saved_snowball_vs_baseline=None,
        interest_saved_avalanche_vs_baseline=None,
        interest_saved_avalanche_vs_snowball=None,
        months_saved_snowball_vs_baseline=None,
        months_saved_avalanche_vs_baseline=None,
        months_saved_avalanche_vs_snowball=None,
    )


def test_recommends_the_only_strategy_that_pays_off():
    paid = summary(Strategy.SNOWBALL, Outcome.PAID_OFF, "10.00")
    never = summary(Strategy.AVALANCHE, Outcome.NEVER_PAYS_OFF, "5.00")
    assert _recommended_strategy(comparison(paid, never)) == "snowball"
    assert _recommended_strategy(comparison(never, paid)) == "avalanche"


def test_recommends_lower_interest_and_returns_null_on_a_tie_or_no_payoff():
    snowball = summary(Strategy.SNOWBALL, Outcome.PAID_OFF, "9.99")
    avalanche = summary(Strategy.AVALANCHE, Outcome.PAID_OFF, "10.00")
    assert _recommended_strategy(comparison(snowball, avalanche)) == "snowball"
    assert _recommended_strategy(comparison(avalanche, snowball)) == "avalanche"
    assert _recommended_strategy(comparison(snowball, snowball)) is None

    never = summary(Strategy.SNOWBALL, Outcome.NEVER_PAYS_OFF, "10.00")
    assert _recommended_strategy(comparison(never, never)) is None
