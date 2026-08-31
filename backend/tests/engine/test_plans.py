from decimal import Decimal

from app.engine.minimums import fixed_minimum
from app.engine.models import Debt, Outcome, Strategy
from app.engine.ordering import snowball_order
from app.engine.plans import summarize
from app.engine.simulator import ZERO, simulate


def debt(id_, balance, apr, minimum) -> Debt:
    return Debt(
        id=id_,
        name=f"Card {id_}",
        balance=Decimal(balance),
        apr=Decimal(apr),
        minimum_payment=Decimal(minimum),
    )


def summarize_run(debts, extra="0.00", strategy=Strategy.SNOWBALL):
    schedule = simulate(debts, Decimal(extra), snowball_order, fixed_minimum)
    return summarize(schedule, debts, strategy)


def test_summary_reports_months_and_totals():
    # The hand-computed 3-month run from Task 7:
    #   interest 1.00 + 0.51 + 0.02 = 1.53
    #   paid     50.00 + 50.00 + 1.53 = 101.53
    summary = summarize_run([debt("a", "100.00", "12.00", "50.00")])
    assert summary.months_to_payoff == 3
    assert summary.total_interest_paid == Decimal("1.53")
    assert summary.total_paid == Decimal("101.53")
    assert summary.outcome is Outcome.PAID_OFF


def test_total_paid_equals_principal_plus_interest():
    summary = summarize_run([debt("a", "100.00", "12.00", "50.00")])
    assert summary.total_paid == Decimal("100.00") + summary.total_interest_paid


def test_summary_records_the_strategy():
    summary = summarize_run([debt("a", "100.00", "0.00", "50.00")], strategy=Strategy.AVALANCHE)
    assert summary.strategy is Strategy.AVALANCHE


def test_debt_payoffs_carry_name_month_and_interest():
    summary = summarize_run([debt("a", "100.00", "12.00", "50.00")])
    assert len(summary.debt_payoffs) == 1
    payoff = summary.debt_payoffs[0]
    assert payoff.debt_id == "a"
    assert payoff.name == "Card a"
    assert payoff.payoff_month == 3
    assert payoff.total_interest_paid == Decimal("1.53")


def test_debt_payoffs_are_in_the_order_debts_clear():
    debts = [debt("a", "100.00", "0.00", "50.00"), debt("b", "200.00", "0.00", "50.00")]
    summary = summarize_run(debts)
    assert [p.debt_id for p in summary.debt_payoffs] == ["a", "b"]
    assert [p.payoff_month for p in summary.debt_payoffs] == [2, 3]


def test_monthly_totals_accumulate_interest():
    summary = summarize_run([debt("a", "100.00", "12.00", "50.00")])
    assert [t.index for t in summary.monthly_totals] == [1, 2, 3]
    assert [t.cumulative_interest for t in summary.monthly_totals] == [
        Decimal("1.00"),
        Decimal("1.51"),
        Decimal("1.53"),
    ]
    assert [t.remaining_balance for t in summary.monthly_totals] == [
        Decimal("51.00"),
        Decimal("1.51"),
        ZERO,
    ]


def test_empty_portfolio_summarizes_to_zero_months():
    summary = summarize_run([])
    assert summary.months_to_payoff == 0
    assert summary.total_interest_paid == ZERO
    assert summary.debt_payoffs == ()


def test_never_pays_off_reports_null_months_and_underwater_ids():
    summary = summarize_run([debt("a", "1000.00", "24.00", "10.00")])
    assert summary.outcome is Outcome.NEVER_PAYS_OFF
    assert summary.months_to_payoff is None
    assert summary.underwater_debt_ids == ("a",)
    assert summary.debt_payoffs == ()


from app.engine.plans import compute_plans


def test_compute_plans_labels_each_scenario():
    debts = [debt("a", "500.00", "5.00", "25.00"), debt("b", "2000.00", "25.00", "50.00")]
    plans = compute_plans(debts, Decimal("200.00"))
    assert plans.snowball.strategy is Strategy.SNOWBALL
    assert plans.avalanche.strategy is Strategy.AVALANCHE
    assert plans.baseline.strategy is Strategy.MINIMUM_ONLY


def test_avalanche_never_costs_more_interest_than_snowball():
    debts = [debt("a", "500.00", "5.00", "25.00"), debt("b", "2000.00", "25.00", "50.00")]
    plans = compute_plans(debts, Decimal("200.00"))
    assert plans.avalanche.total_interest_paid <= plans.snowball.total_interest_paid


def test_snowball_clears_the_small_debt_first():
    debts = [debt("a", "500.00", "5.00", "25.00"), debt("b", "2000.00", "25.00", "50.00")]
    plans = compute_plans(debts, Decimal("200.00"))
    assert plans.snowball.debt_payoffs[0].debt_id == "a"
    assert plans.avalanche.debt_payoffs[0].debt_id == "b"


def test_baseline_is_slower_and_costlier_than_both_strategies():
    debts = [debt("a", "500.00", "5.00", "25.00"), debt("b", "2000.00", "25.00", "50.00")]
    plans = compute_plans(debts, Decimal("200.00"))
    assert plans.baseline.months_to_payoff > plans.avalanche.months_to_payoff
    assert plans.baseline.total_interest_paid > plans.avalanche.total_interest_paid


def test_deltas_are_the_arithmetic_the_ai_layer_must_not_do():
    debts = [debt("a", "500.00", "5.00", "25.00"), debt("b", "2000.00", "25.00", "50.00")]
    plans = compute_plans(debts, Decimal("200.00"))
    assert plans.interest_saved_avalanche_vs_snowball == (
        plans.snowball.total_interest_paid - plans.avalanche.total_interest_paid
    )
    assert plans.interest_saved_avalanche_vs_baseline == (
        plans.baseline.total_interest_paid - plans.avalanche.total_interest_paid
    )
    assert plans.months_saved_avalanche_vs_baseline == (
        plans.baseline.months_to_payoff - plans.avalanche.months_to_payoff
    )


def test_deltas_are_none_when_the_baseline_never_pays_off():
    # 1% implied minimum against a 2% monthly rate: the baseline is underwater,
    # but a large extra payment still clears both strategies.
    debts = [debt("a", "10000.00", "24.00", "100.00")]
    plans = compute_plans(debts, Decimal("3000.00"))
    assert plans.baseline.outcome is Outcome.NEVER_PAYS_OFF
    assert plans.avalanche.outcome is Outcome.PAID_OFF
    assert plans.interest_saved_avalanche_vs_baseline is None
    assert plans.months_saved_avalanche_vs_baseline is None
    # The strategy-vs-strategy delta is still a real number.
    assert plans.interest_saved_avalanche_vs_snowball is not None


def test_baseline_ignores_the_extra_payment():
    debts = [debt("a", "1000.00", "12.00", "100.00")]
    small = compute_plans(debts, Decimal("0.00"))
    large = compute_plans(debts, Decimal("900.00"))
    assert small.baseline.months_to_payoff == large.baseline.months_to_payoff
    assert small.baseline.total_interest_paid == large.baseline.total_interest_paid


def test_empty_portfolio_produces_three_zero_plans():
    plans = compute_plans([], Decimal("100.00"))
    for summary in (plans.snowball, plans.avalanche, plans.baseline):
        assert summary.months_to_payoff == 0
        assert summary.total_interest_paid == ZERO
    assert plans.interest_saved_avalanche_vs_snowball == ZERO


from app.engine.models import Schedule
from app.engine.plans import compute_schedules, summarize_schedules


def test_compute_schedules_returns_one_schedule_per_strategy():
    debts = [debt("a", "500.00", "5.00", "25.00"), debt("b", "2000.00", "25.00", "50.00")]
    schedules = compute_schedules(debts, Decimal("200.00"))
    assert set(schedules) == {Strategy.SNOWBALL, Strategy.AVALANCHE, Strategy.MINIMUM_ONLY}
    for schedule in schedules.values():
        assert isinstance(schedule, Schedule)


def test_schedules_carry_the_per_debt_grid_that_summaries_drop():
    # This is the whole point: PlanSummary has monthly_totals but no per-debt
    # rows, so ?detail=full cannot be served from compute_plans alone.
    debts = [debt("a", "100.00", "12.00", "50.00")]
    schedules = compute_schedules(debts, ZERO)
    first_month = schedules[Strategy.AVALANCHE].months[0]
    assert first_month.debts[0].debt_id == "a"
    assert first_month.debts[0].interest_charged == Decimal("1.00")


def test_summarize_schedules_reproduces_compute_plans_exactly():
    debts = [debt("a", "500.00", "5.00", "25.00"), debt("b", "2000.00", "25.00", "50.00")]
    extra = Decimal("200.00")
    assert summarize_schedules(compute_schedules(debts, extra), debts) == compute_plans(debts, extra)


def test_baseline_schedule_ignores_the_extra_payment():
    debts = [debt("a", "1000.00", "12.00", "100.00")]
    with_extra = compute_schedules(debts, Decimal("900.00"))[Strategy.MINIMUM_ONLY]
    without = compute_schedules(debts, ZERO)[Strategy.MINIMUM_ONLY]
    assert len(with_extra.months) == len(without.months)
