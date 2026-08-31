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
