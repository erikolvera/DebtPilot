from decimal import Decimal

from app.api.dates import month_label
from app.api.mappers import to_response
from app.engine import Debt, Strategy, compute_plans, compute_schedules, summarize_schedules


def debt(id_, balance, apr, minimum) -> Debt:
    return Debt(
        id=id_,
        name=f"Card {id_}",
        balance=Decimal(balance),
        apr=Decimal(apr),
        minimum_payment=Decimal(minimum),
    )


PORTFOLIO = [debt("a", "500.00", "5.00", "25.00"), debt("b", "2000.00", "25.00", "50.00")]
EXTRA = Decimal("200.00")


def test_start_month_is_echoed_back():
    response = to_response(compute_plans(PORTFOLIO, EXTRA), "2026-09")
    assert response.start_month == "2026-09"


def test_all_three_scenarios_are_present_and_labelled():
    response = to_response(compute_plans(PORTFOLIO, EXTRA), "2026-09")
    assert response.scenarios.snowball.strategy == "snowball"
    assert response.scenarios.avalanche.strategy == "avalanche"
    assert response.scenarios.baseline.strategy == "minimum_only"


def test_totals_are_copied_verbatim_from_the_engine():
    comparison = compute_plans(PORTFOLIO, EXTRA)
    response = to_response(comparison, "2026-09")
    assert response.scenarios.avalanche.total_interest_paid == comparison.avalanche.total_interest_paid
    assert response.scenarios.avalanche.total_paid == comparison.avalanche.total_paid
    assert response.scenarios.avalanche.months_to_payoff == comparison.avalanche.months_to_payoff


def test_payoff_month_is_the_start_month_shifted_by_the_term():
    comparison = compute_plans(PORTFOLIO, EXTRA)
    response = to_response(comparison, "2026-09")
    months = comparison.avalanche.months_to_payoff
    assert response.scenarios.avalanche.payoff_month == month_label("2026-09", months)


def test_debt_payoffs_carry_both_the_count_and_the_calendar_month():
    response = to_response(compute_plans(PORTFOLIO, EXTRA), "2026-09")
    payoff = response.scenarios.snowball.debt_payoffs[0]
    assert payoff.debt_id == "a"
    assert payoff.name == "Card a"
    assert payoff.months_to_payoff >= 1
    assert payoff.payoff_month == month_label("2026-09", payoff.months_to_payoff)


def test_monthly_totals_get_calendar_months_alongside_numbers():
    response = to_response(compute_plans(PORTFOLIO, EXTRA), "2026-09")
    first = response.scenarios.avalanche.monthly_totals[0]
    assert first.month_number == 1
    assert first.month == "2026-09"


def test_comparison_deltas_are_copied_verbatim():
    comparison = compute_plans(PORTFOLIO, EXTRA)
    response = to_response(comparison, "2026-09")
    assert (
        response.comparison.interest_saved_avalanche_vs_snowball
        == comparison.interest_saved_avalanche_vs_snowball
    )
    assert (
        response.comparison.months_saved_avalanche_vs_baseline
        == comparison.months_saved_avalanche_vs_baseline
    )


def test_never_pays_off_scenario_has_null_month_and_underwater_ids():
    comparison = compute_plans([debt("a", "10000.00", "24.00", "100.00")], Decimal("3000.00"))
    response = to_response(comparison, "2026-09")
    baseline = response.scenarios.baseline
    assert baseline.outcome == "never_pays_off"
    assert baseline.months_to_payoff is None
    assert baseline.payoff_month is None
    assert baseline.underwater_debt_ids == ["a"]
    assert response.comparison.interest_saved_avalanche_vs_baseline is None


def test_zero_month_scenario_has_a_null_payoff_month():
    # An empty portfolio pays off in zero months. month_label(start, 0) would
    # name the month BEFORE the start month, so the mapper must emit null.
    response = to_response(compute_plans([], Decimal("100.00")), "2026-09")
    assert response.scenarios.avalanche.months_to_payoff == 0
    assert response.scenarios.avalanche.payoff_month is None
    assert response.scenarios.avalanche.monthly_totals == []


def test_schedule_is_null_when_no_schedules_are_supplied():
    response = to_response(compute_plans(PORTFOLIO, EXTRA), "2026-09")
    assert response.scenarios.avalanche.schedule is None


def test_schedules_populate_the_per_debt_grid():
    schedules = compute_schedules(PORTFOLIO, EXTRA)
    comparison = summarize_schedules(schedules, PORTFOLIO)
    response = to_response(comparison, "2026-09", schedules)

    schedule = response.scenarios.avalanche.schedule
    assert schedule is not None
    assert len(schedule) == comparison.avalanche.months_to_payoff

    first = schedule[0]
    assert first.month_number == 1
    assert first.month == "2026-09"
    assert {row.debt_id for row in first.debts} == {"a", "b"}


def test_schedule_rows_copy_engine_values_verbatim():
    schedules = compute_schedules(PORTFOLIO, EXTRA)
    comparison = summarize_schedules(schedules, PORTFOLIO)
    response = to_response(comparison, "2026-09", schedules)

    engine_row = schedules[Strategy.AVALANCHE].months[0].debts[0]
    wire_row = next(
        row
        for row in response.scenarios.avalanche.schedule[0].debts
        if row.debt_id == engine_row.debt_id
    )
    assert wire_row.starting_balance == engine_row.starting_balance
    assert wire_row.interest_charged == engine_row.interest_charged
    assert wire_row.payment_applied == engine_row.payment_applied
    assert wire_row.ending_balance == engine_row.ending_balance


def test_every_scenario_gets_its_own_schedule():
    schedules = compute_schedules(PORTFOLIO, EXTRA)
    comparison = summarize_schedules(schedules, PORTFOLIO)
    response = to_response(comparison, "2026-09", schedules)
    for scenario in (
        response.scenarios.snowball,
        response.scenarios.avalanche,
        response.scenarios.baseline,
    ):
        assert scenario.schedule is not None
        assert len(scenario.schedule) >= 1


def test_schedule_months_run_consecutively_from_the_start_month():
    schedules = compute_schedules(PORTFOLIO, EXTRA)
    comparison = summarize_schedules(schedules, PORTFOLIO)
    response = to_response(comparison, "2026-12", schedules)
    schedule = response.scenarios.avalanche.schedule
    assert schedule[0].month == "2026-12"
    assert schedule[1].month == "2027-01"


def test_empty_portfolio_with_schedules_has_empty_schedule_lists():
    schedules = compute_schedules([], Decimal("100.00"))
    comparison = summarize_schedules(schedules, [])
    response = to_response(comparison, "2026-09", schedules)
    assert response.scenarios.avalanche.schedule == []
