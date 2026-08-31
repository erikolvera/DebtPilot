from decimal import Decimal

from app.engine.minimums import fixed_minimum
from app.engine.models import Debt, Outcome
from app.engine.ordering import avalanche_order, snowball_order
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


def test_extra_payment_goes_to_the_target_debt():
    # $100 at 0% with a $50 minimum and $50 extra clears in one month.
    schedule = run([debt("a", "100.00", "0.00", "50.00")], extra="50.00")
    assert len(schedule.months) == 1
    assert schedule.months[0].total_payment == Decimal("100.00")


def test_rollover_keeps_the_total_outlay_constant():
    # a: $100 @ 0%, min 50    b: $200 @ 0%, min 50    extra: 0
    #   M1: a 100->50,  b 200->150            total paid 100
    #   M2: a  50->0,   b 150->100            total paid 100, a's 50 freed
    #   M3: b 100->50 (min) then -50 (freed)  total paid 100 -> clear
    debts = [debt("a", "100.00", "0.00", "50.00"), debt("b", "200.00", "0.00", "50.00")]
    schedule = run(debts)
    assert len(schedule.months) == 3
    for month in schedule.months:
        assert month.total_payment == Decimal("100.00")


def test_without_rollover_the_freed_minimum_is_not_reused():
    # Same portfolio, rollover off: b keeps paying only its own $50, so it
    # needs a fourth month.
    debts = [debt("a", "100.00", "0.00", "50.00"), debt("b", "200.00", "0.00", "50.00")]
    schedule = run(debts, rollover=False)
    assert len(schedule.months) == 4


def test_truncation_remainder_cascades_within_the_same_month():
    # a: $30 @ 0%, min 50   b: $500 @ 0%, min 50
    # Budget is built from the SCHEDULED minimums (50+50=100), but a can only
    # absorb 30. The spare 20 must reach b in month 1, not evaporate.
    debts = [debt("a", "30.00", "0.00", "50.00"), debt("b", "500.00", "0.00", "50.00")]
    schedule = run(debts)
    month1 = schedule.months[0]
    assert month1.total_payment == Decimal("100.00")
    by_id = {row.debt_id: row for row in month1.debts}
    assert by_id["a"].payment_applied == Decimal("30.00")
    assert by_id["b"].payment_applied == Decimal("70.00")


def test_snowball_and_avalanche_attack_different_debts_first():
    # a: small balance, low APR   b: large balance, high APR
    debts = [debt("a", "500.00", "5.00", "25.00"), debt("b", "2000.00", "25.00", "50.00")]
    snow = simulate(debts, Decimal("200.00"), snowball_order, fixed_minimum)
    aval = simulate(debts, Decimal("200.00"), avalanche_order, fixed_minimum)

    snow_first = {r.debt_id: r.payment_applied for r in snow.months[0].debts}
    aval_first = {r.debt_id: r.payment_applied for r in aval.months[0].debts}
    assert snow_first["a"] > snow_first["b"]
    assert aval_first["b"] > aval_first["a"]


def test_surplus_larger_than_the_whole_portfolio_is_not_overpaid():
    debts = [debt("a", "100.00", "0.00", "50.00")]
    schedule = run(debts, extra="5000.00")
    assert len(schedule.months) == 1
    assert schedule.months[0].total_payment == Decimal("100.00")
    assert schedule.months[0].remaining_balance == ZERO
