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


def test_extra_payment_is_quantized_on_entry():
    schedule = run([debt("a", "100.00", "0.00", "50.00")], extra="0.004")
    assert schedule.months[0].total_payment == Decimal("50.00")


def test_extra_payment_goes_to_the_target_debt():
    # $100 at 0% with a $50 minimum and $50 extra clears in one month.
    schedule = run([debt("a", "100.00", "0.00", "50.00")], extra="50.00")
    assert len(schedule.months) == 1
    assert schedule.months[0].total_payment == Decimal("100.00")


def test_without_rollover_the_freed_minimum_is_not_reused():
    # a: $100 @ 0%, min 50   b: $200 @ 0%, min 50. With rollover this clears
    # in 3 months; with it off, b keeps paying only its own $50 and needs a fourth.
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


def test_surplus_larger_than_the_whole_portfolio_is_not_overpaid():
    debts = [debt("a", "100.00", "0.00", "50.00")]
    schedule = run(debts, extra="5000.00")
    assert len(schedule.months) == 1
    assert schedule.months[0].total_payment == Decimal("100.00")
    assert schedule.months[0].remaining_balance == ZERO


def test_extra_payment_can_rescue_an_underwater_debt():
    schedule = run([debt("a", "1000.00", "24.00", "10.00")], extra="500.00")
    assert schedule.outcome is Outcome.PAID_OFF


def test_max_months_backstop_stops_glacial_progress():
    # $100,000 at 1.2% accrues $100.00/month against a $101.01 minimum:
    # one dollar and one cent of progress per month would run for centuries without the backstop.
    schedule = run([debt("a", "100000.00", "1.20", "101.01")])
    assert schedule.outcome is Outcome.NEVER_PAYS_OFF
    assert len(schedule.months) == 1200
    assert schedule.underwater_debt_ids == ()


def test_zero_minimum_and_zero_extra_never_pays_off():
    schedule = run([debt("a", "500.00", "18.00", "0.00")])
    assert schedule.outcome is Outcome.NEVER_PAYS_OFF


def test_cap_path_underwater_ids_name_only_debts_interest_outruns():
    # T is glacial but healthy (payment beats interest); U is genuinely
    # underwater. T cannot clear within the cap, so the run exhausts
    # MAX_MONTHS — and only U belongs in underwater_debt_ids.
    debts = [debt("t", "100000.00", "1.20", "101.01"), debt("u", "1000.00", "24.00", "10.00")]
    schedule = run(debts)
    assert schedule.outcome is Outcome.NEVER_PAYS_OFF
    assert len(schedule.months) == 1200
    assert schedule.underwater_debt_ids == ("u",)


def test_schema_maximums_cannot_overflow_decimal_context():
    # One glacial healthy debt prevents the sound all-underwater early exit
    # while the other grows for the full horizon at the published API bounds.
    # The growing balance reaches hundreds of digits; the default Decimal
    # context cannot quantize it to cents and used to raise InvalidOperation.
    debts = [
        debt("healthy", "99999999.99", "0.00", "0.01"),
        debt("growing", "99999999.99", "999.99", "0.00"),
    ]
    schedule = run(debts)
    assert schedule.outcome is Outcome.NEVER_PAYS_OFF
    assert len(schedule.months) == 1200
    assert schedule.underwater_debt_ids == ("growing",)
    assert schedule.months[-1].remaining_balance.adjusted() > 300
