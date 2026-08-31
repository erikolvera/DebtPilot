from decimal import Decimal

import pytest

from app.engine.errors import InvalidDebt
from app.engine.models import Debt, validate_portfolio


def make_debt(**overrides) -> Debt:
    kwargs = {
        "id": "d1",
        "name": "Visa",
        "balance": Decimal("1000.00"),
        "apr": Decimal("24.00"),
        "minimum_payment": Decimal("50.00"),
    }
    kwargs.update(overrides)
    return Debt(**kwargs)


def test_debt_is_frozen():
    debt = make_debt()
    with pytest.raises(Exception):
        debt.balance = Decimal("5.00")


def test_debt_quantizes_balance_on_ingest():
    assert make_debt(balance=Decimal("100.005")).balance == Decimal("100.01")


def test_debt_quantizes_minimum_on_ingest():
    assert make_debt(minimum_payment=Decimal("49.999")).minimum_payment == Decimal("50.00")


def test_debt_quantizes_apr_on_ingest():
    assert make_debt(apr=Decimal("24.9949")).apr == Decimal("24.99")


def test_negative_balance_is_rejected():
    with pytest.raises(InvalidDebt, match="balance"):
        make_debt(balance=Decimal("-1.00"))


def test_negative_apr_is_rejected():
    with pytest.raises(InvalidDebt, match="apr"):
        make_debt(apr=Decimal("-0.01"))


def test_negative_minimum_is_rejected():
    with pytest.raises(InvalidDebt, match="minimum_payment"):
        make_debt(minimum_payment=Decimal("-5.00"))


def test_zero_balance_is_accepted():
    assert make_debt(balance=Decimal("0.00")).balance == Decimal("0.00")


def test_zero_minimum_is_accepted():
    assert make_debt(minimum_payment=Decimal("0.00")).minimum_payment == Decimal("0.00")


def test_minimum_larger_than_balance_is_accepted():
    debt = make_debt(balance=Decimal("10.00"), minimum_payment=Decimal("50.00"))
    assert debt.minimum_payment == Decimal("50.00")


def test_duplicate_ids_are_rejected():
    debts = [make_debt(id="a"), make_debt(id="a")]
    with pytest.raises(InvalidDebt, match="duplicate"):
        validate_portfolio(debts, Decimal("0.00"))


def test_negative_extra_payment_is_rejected():
    with pytest.raises(InvalidDebt, match="extra_payment"):
        validate_portfolio([make_debt()], Decimal("-1.00"))


def test_valid_portfolio_passes():
    validate_portfolio([make_debt(id="a"), make_debt(id="b")], Decimal("100.00"))


def test_empty_portfolio_passes():
    validate_portfolio([], Decimal("0.00"))


from app.engine.models import (
    DebtMonth,
    DebtPayoff,
    Month,
    MonthlyTotal,
    Outcome,
    PlanComparison,
    PlanSummary,
    Schedule,
    Strategy,
)


def test_strategy_values():
    assert Strategy.SNOWBALL.value == "snowball"
    assert Strategy.AVALANCHE.value == "avalanche"
    assert Strategy.MINIMUM_ONLY.value == "minimum_only"


def test_outcome_values():
    assert Outcome.PAID_OFF.value == "paid_off"
    assert Outcome.NEVER_PAYS_OFF.value == "never_pays_off"


def make_month(index=1) -> Month:
    row = DebtMonth(
        debt_id="d1",
        starting_balance=Decimal("100.00"),
        interest_charged=Decimal("1.00"),
        payment_applied=Decimal("50.00"),
        ending_balance=Decimal("51.00"),
    )
    return Month(
        index=index,
        debts=(row,),
        total_payment=Decimal("50.00"),
        total_interest=Decimal("1.00"),
        remaining_balance=Decimal("51.00"),
    )


def test_schedule_defaults_to_no_underwater_debts():
    schedule = Schedule(months=(make_month(),), outcome=Outcome.PAID_OFF)
    assert schedule.underwater_debt_ids == ()


def test_schedule_carries_the_outcome():
    # simulate() returns a Schedule, so the Schedule must record how the run
    # ended — the outcome cannot live only on PlanSummary.
    schedule = Schedule(
        months=(), outcome=Outcome.NEVER_PAYS_OFF, underwater_debt_ids=("d1",)
    )
    assert schedule.outcome is Outcome.NEVER_PAYS_OFF
    assert schedule.underwater_debt_ids == ("d1",)


def test_result_types_are_frozen():
    month = make_month()
    with pytest.raises(Exception):
        month.index = 2


def test_plan_summary_allows_null_months_when_never_pays_off():
    summary = PlanSummary(
        strategy=Strategy.MINIMUM_ONLY,
        outcome=Outcome.NEVER_PAYS_OFF,
        months_to_payoff=None,
        underwater_debt_ids=("d1",),
        total_interest_paid=Decimal("500.00"),
        total_paid=Decimal("500.00"),
        debt_payoffs=(),
        monthly_totals=(MonthlyTotal(1, Decimal("10.00"), Decimal("1.00")),),
    )
    assert summary.months_to_payoff is None


def test_plan_comparison_allows_null_deltas():
    summary = PlanSummary(
        strategy=Strategy.SNOWBALL,
        outcome=Outcome.PAID_OFF,
        months_to_payoff=3,
        underwater_debt_ids=(),
        total_interest_paid=Decimal("1.53"),
        total_paid=Decimal("101.53"),
        debt_payoffs=(DebtPayoff("d1", "Visa", 3, Decimal("1.53")),),
        monthly_totals=(),
    )
    comparison = PlanComparison(
        snowball=summary,
        avalanche=summary,
        baseline=summary,
        interest_saved_snowball_vs_baseline=None,
        interest_saved_avalanche_vs_baseline=None,
        interest_saved_avalanche_vs_snowball=Decimal("0.00"),
        months_saved_snowball_vs_baseline=None,
        months_saved_avalanche_vs_baseline=None,
        months_saved_avalanche_vs_snowball=0,
    )
    assert comparison.interest_saved_snowball_vs_baseline is None
