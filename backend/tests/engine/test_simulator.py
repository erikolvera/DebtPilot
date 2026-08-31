from decimal import Decimal

from app.engine.minimums import fixed_minimum
from app.engine.models import Debt, Outcome
from app.engine.ordering import snowball_order
from app.engine.simulator import ZERO, simulate


def debt(id_, balance, apr, minimum) -> Debt:
    return Debt(
        id=id_,
        name=f"Card {id_}",
        balance=Decimal(balance),
        apr=Decimal(apr),
        minimum_payment=Decimal(minimum),
    )


def run(debts, extra="0.00", rule=fixed_minimum, rollover=True):
    return simulate(debts, Decimal(extra), snowball_order, rule, rollover)


def test_empty_portfolio_returns_an_empty_schedule():
    schedule = run([])
    assert schedule.months == ()
    assert schedule.outcome is Outcome.PAID_OFF


def test_zero_balance_debts_are_excluded():
    schedule = run([debt("a", "0.00", "20.00", "50.00")])
    assert schedule.months == ()
    assert schedule.outcome is Outcome.PAID_OFF


def test_single_debt_no_interest():
    # $100 at 0% APR, $50/month -> exactly 2 months
    schedule = run([debt("a", "100.00", "0.00", "50.00")])
    assert len(schedule.months) == 2
    assert schedule.outcome is Outcome.PAID_OFF
    assert schedule.months[0].index == 1
    assert schedule.months[-1].remaining_balance == ZERO


def test_single_debt_with_interest_hand_computed():
    # $100 at 12% APR (1%/month), $50/month:
    #   M1: +1.00 -> 101.00, pay 50.00 -> 51.00
    #   M2: +0.51 ->  51.51, pay 50.00 ->  1.51
    #   M3: +0.02 ->   1.53, pay  1.53 ->  0.00   (truncated final payment)
    schedule = run([debt("a", "100.00", "12.00", "50.00")])
    assert len(schedule.months) == 3

    m1, m2, m3 = schedule.months
    assert m1.total_interest == Decimal("1.00")
    assert m1.total_payment == Decimal("50.00")
    assert m1.remaining_balance == Decimal("51.00")

    assert m2.total_interest == Decimal("0.51")
    assert m2.remaining_balance == Decimal("1.51")

    assert m3.total_interest == Decimal("0.02")
    assert m3.total_payment == Decimal("1.53")
    assert m3.remaining_balance == ZERO


def test_final_payment_is_truncated_so_balances_never_go_negative():
    schedule = run([debt("a", "100.00", "12.00", "50.00")])
    for month in schedule.months:
        for row in month.debts:
            assert row.ending_balance >= ZERO


def test_month_rows_record_per_debt_detail():
    schedule = run([debt("a", "100.00", "0.00", "50.00")])
    row = schedule.months[0].debts[0]
    assert row.debt_id == "a"
    assert row.starting_balance == Decimal("100.00")
    assert row.interest_charged == ZERO
    assert row.payment_applied == Decimal("50.00")
    assert row.ending_balance == Decimal("50.00")


def test_extra_payment_is_quantized_on_entry():
    schedule = run([debt("a", "100.00", "0.00", "50.00")], extra="0.004")
    assert schedule.months[0].total_payment == Decimal("50.00")
