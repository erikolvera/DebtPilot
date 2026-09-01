from decimal import Decimal

from app.api.dates import month_label
from app.api.mappers import to_response
from app.engine import Debt, compute_plans


def debt(id_: str, balance: str, apr: str, minimum: str) -> Debt:
    return Debt(
        id=id_,
        name=f"Debt {id_}",
        balance=Decimal(balance),
        apr=Decimal(apr),
        minimum_payment=Decimal(minimum),
    )


PORTFOLIO = [
    debt("a", "500.00", "5.00", "25.00"),
    debt("b", "2000.00", "25.00", "50.00"),
]


def test_mapper_preserves_scenarios_totals_dates_and_deltas():
    comparison = compute_plans(PORTFOLIO, Decimal("200.00"))
    response = to_response(comparison, "2026-09")

    assert response.start_month == "2026-09"
    assert response.scenarios.snowball.strategy == "snowball"
    assert response.scenarios.avalanche.total_paid == comparison.avalanche.total_paid
    assert response.scenarios.avalanche.payoff_month == month_label(
        "2026-09", comparison.avalanche.months_to_payoff
    )
    first = response.scenarios.avalanche.monthly_totals[0]
    assert first.month_number == 1
    assert first.month == "2026-09"
    assert (
        response.comparison.interest_saved_avalanche_vs_snowball
        == comparison.interest_saved_avalanche_vs_snowball
    )


def test_debt_payoff_rows_keep_the_engine_values():
    comparison = compute_plans(PORTFOLIO, Decimal("200.00"))
    response = to_response(comparison, "2026-09")
    wire = response.scenarios.snowball.debt_payoffs[0]
    source = comparison.snowball.debt_payoffs[0]

    assert wire.debt_id == source.debt_id
    assert wire.name == source.name
    assert wire.months_to_payoff == source.payoff_month
    assert wire.payoff_month == month_label("2026-09", source.payoff_month)
    assert wire.total_interest_paid == source.total_interest_paid


def test_never_pays_off_has_no_payoff_month():
    response = to_response(
        compute_plans(
            [debt("a", "10000.00", "24.00", "100.00")], Decimal("3000.00")
        ),
        "2026-09",
    )
    baseline = response.scenarios.baseline
    assert baseline.outcome == "never_pays_off"
    assert baseline.months_to_payoff is None
    assert baseline.payoff_month is None
    assert baseline.underwater_debt_ids == ["a"]


def test_empty_portfolio_has_no_calendar_payoff_month():
    response = to_response(compute_plans([], Decimal("100.00")), "2026-09")
    assert response.scenarios.avalanche.months_to_payoff == 0
    assert response.scenarios.avalanche.payoff_month is None
    assert response.scenarios.avalanche.monthly_totals == []
