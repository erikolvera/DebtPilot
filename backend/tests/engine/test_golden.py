"""Golden fixtures, computed independently of the implementation.

Invariants prove internal consistency; these prove external correctness. An
engine that divided APR by 24 instead of 12 would satisfy every invariant
perfectly while being uniformly wrong — only a hand-computed expected value
catches that.
"""

from decimal import Decimal

from app.engine.minimums import fixed_minimum
from app.engine.models import Debt, Outcome, Strategy
from app.engine.ordering import avalanche_order, snowball_order
from app.engine.plans import compute_plans, summarize
from app.engine.simulator import ZERO, simulate


def debt(id_, balance, apr, minimum) -> Debt:
    return Debt(
        id=id_,
        name=f"Card {id_}",
        balance=Decimal(balance),
        apr=Decimal(apr),
        minimum_payment=Decimal(minimum),
    )


def rows_by_id(month):
    return {row.debt_id: row for row in month.debts}


def test_golden_single_debt_with_interest():
    # $100.00 at 12.00% APR -> 1.00% per month. Minimum $50.00, no extra.
    #
    # month | start  | interest | payment | end
    #   1   | 100.00 |   1.00   |  50.00  | 51.00
    #   2   |  51.00 |   0.51   |  50.00  |  1.51
    #   3   |   1.51 |   0.02   |   1.53  |  0.00
    #
    # interest: 1.00 + 0.51 + 0.02 = 1.53
    # payments: 50.00 + 50.00 + 1.53 = 101.53 = 100.00 + 1.53
    schedule = simulate(
        [debt("a", "100.00", "12.00", "50.00")], ZERO, snowball_order, fixed_minimum
    )
    expected = [
        (Decimal("100.00"), Decimal("1.00"), Decimal("50.00"), Decimal("51.00")),
        (Decimal("51.00"), Decimal("0.51"), Decimal("50.00"), Decimal("1.51")),
        (Decimal("1.51"), Decimal("0.02"), Decimal("1.53"), Decimal("0.00")),
    ]
    assert len(schedule.months) == len(expected)
    for month, (start, interest, payment, end) in zip(schedule.months, expected):
        row = month.debts[0]
        assert (row.starting_balance, row.interest_charged) == (start, interest)
        assert (row.payment_applied, row.ending_balance) == (payment, end)


def test_golden_two_debts_with_rollover():
    # a: $100.00 @ 0%, min $50.00     b: $200.00 @ 0%, min $50.00
    # Constant outlay: 50 + 50 = $100.00 every month.
    #
    # month | a start | a pay | a end | b start | b pay | b end
    #   1   | 100.00  | 50.00 | 50.00 | 200.00  | 50.00 | 150.00
    #   2   |  50.00  | 50.00 |  0.00 | 150.00  | 50.00 | 100.00
    #   3   |    --   |   --  |   --  | 100.00  |100.00 |   0.00
    #
    # In month 3, a is gone and its freed $50 minimum joins b's own $50.
    debts = [debt("a", "100.00", "0.00", "50.00"), debt("b", "200.00", "0.00", "50.00")]
    schedule = simulate(debts, ZERO, snowball_order, fixed_minimum)

    assert len(schedule.months) == 3
    for month in schedule.months:
        assert month.total_payment == Decimal("100.00")
        assert month.total_interest == ZERO

    m1, m2, m3 = schedule.months
    assert rows_by_id(m1)["a"].ending_balance == Decimal("50.00")
    assert rows_by_id(m1)["b"].ending_balance == Decimal("150.00")
    assert rows_by_id(m2)["a"].ending_balance == ZERO
    assert rows_by_id(m2)["b"].ending_balance == Decimal("100.00")
    assert "a" not in rows_by_id(m3)
    assert rows_by_id(m3)["b"].payment_applied == Decimal("100.00")
    assert rows_by_id(m3)["b"].ending_balance == ZERO


def test_golden_negative_amortization():
    # $1,000.00 at 24.00% APR accrues $20.00/month against a $10.00 minimum.
    # Month 1 ends at 1000.00 + 20.00 - 10.00 = 1010.00, above where it began,
    # so no later month can do better.
    schedule = simulate(
        [debt("a", "1000.00", "24.00", "10.00")], ZERO, snowball_order, fixed_minimum
    )
    assert schedule.outcome is Outcome.NEVER_PAYS_OFF
    assert schedule.underwater_debt_ids == ("a",)
    assert len(schedule.months) == 1
    row = schedule.months[0].debts[0]
    assert row.interest_charged == Decimal("20.00")
    assert row.payment_applied == Decimal("10.00")
    assert row.ending_balance == Decimal("1010.00")


def test_golden_strategies_diverge_in_payoff_order():
    # a: small balance, cheap.  b: large balance, expensive.
    # Snowball must clear a first; avalanche must clear b first; and avalanche
    # must not cost more interest.
    debts = [debt("a", "500.00", "5.00", "25.00"), debt("b", "2000.00", "25.00", "50.00")]
    plans = compute_plans(debts, Decimal("200.00"))

    assert [p.debt_id for p in plans.snowball.debt_payoffs] == ["a", "b"]
    assert [p.debt_id for p in plans.avalanche.debt_payoffs] == ["b", "a"]
    assert plans.avalanche.total_interest_paid <= plans.snowball.total_interest_paid
    assert plans.interest_saved_avalanche_vs_snowball >= ZERO


def test_golden_divergent_run_conserves_money():
    debts = [debt("a", "500.00", "5.00", "25.00"), debt("b", "2000.00", "25.00", "50.00")]
    for order_fn, strategy in (
        (snowball_order, Strategy.SNOWBALL),
        (avalanche_order, Strategy.AVALANCHE),
    ):
        schedule = simulate(debts, Decimal("200.00"), order_fn, fixed_minimum)
        summary = summarize(schedule, debts, strategy)
        assert summary.total_paid == Decimal("2500.00") + summary.total_interest_paid
