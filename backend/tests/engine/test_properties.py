"""Invariants that must hold for every input.

These prove internal consistency. They cannot catch a wrong premise — see
test_golden.py for that, and test_oracle.py for an independent derivation.
"""

import random
from decimal import Decimal

from hypothesis import given, settings
from hypothesis import strategies as st

from app.engine.minimums import fixed_minimum
from app.engine.models import Debt, Outcome
from app.engine.ordering import avalanche_order, snowball_order
from app.engine.plans import compute_plans
from app.engine.simulator import ZERO, simulate

SLOW = settings(max_examples=100, deadline=None)


@st.composite
def portfolios(draw):
    count = draw(st.integers(min_value=1, max_value=5))
    debts = []
    for i in range(count):
        debts.append(
            Debt(
                id=f"d{i}",
                name=f"Debt {i}",
                balance=draw(
                    st.decimals(
                        min_value=Decimal("1.00"),
                        max_value=Decimal("50000.00"),
                        places=2,
                    )
                ),
                apr=draw(
                    st.decimals(
                        min_value=Decimal("0.00"),
                        max_value=Decimal("35.00"),
                        places=2,
                    )
                ),
                minimum_payment=draw(
                    st.decimals(
                        min_value=Decimal("0.00"),
                        max_value=Decimal("500.00"),
                        places=2,
                    )
                ),
            )
        )
    extra = draw(
        st.decimals(min_value=Decimal("0.00"), max_value=Decimal("2000.00"), places=2)
    )
    return debts, extra


def totals(schedule):
    paid = sum((m.total_payment for m in schedule.months), ZERO)
    interest = sum((m.total_interest for m in schedule.months), ZERO)
    remaining = schedule.months[-1].remaining_balance if schedule.months else ZERO
    return paid, interest, remaining


@given(portfolios())
@SLOW
def test_money_is_conserved(portfolio):
    # Stated with the remainder so it holds for NEVER_PAYS_OFF runs too.
    debts, extra = portfolio
    schedule = simulate(debts, extra, avalanche_order, fixed_minimum)
    paid, interest, remaining = totals(schedule)
    assert paid + remaining == sum((d.balance for d in debts), ZERO) + interest


@given(portfolios())
@SLOW
def test_balances_are_never_negative(portfolio):
    debts, extra = portfolio
    schedule = simulate(debts, extra, snowball_order, fixed_minimum)
    for month in schedule.months:
        for row in month.debts:
            assert row.ending_balance >= ZERO


@given(portfolios())
@SLOW
def test_every_amount_is_an_exact_cent_value(portfolio):
    debts, extra = portfolio
    schedule = simulate(debts, extra, snowball_order, fixed_minimum)
    for month in schedule.months:
        for row in month.debts:
            for amount in (
                row.starting_balance,
                row.interest_charged,
                row.payment_applied,
                row.ending_balance,
            ):
                assert amount == amount.quantize(Decimal("0.01"))


@given(portfolios())
@SLOW
def test_total_outlay_is_constant_under_rollover(portfolio):
    debts, extra = portfolio
    schedule = simulate(debts, extra, snowball_order, fixed_minimum)
    if schedule.outcome is not Outcome.PAID_OFF or len(schedule.months) < 2:
        return
    expected = sum((d.minimum_payment for d in debts if d.balance > ZERO), ZERO) + extra
    for month in schedule.months[:-1]:
        assert month.total_payment == expected


@given(portfolios())
@SLOW
def test_total_balance_strictly_decreases_when_paid_off(portfolio):
    debts, extra = portfolio
    schedule = simulate(debts, extra, avalanche_order, fixed_minimum)
    if schedule.outcome is not Outcome.PAID_OFF:
        return
    previous = sum((d.balance for d in debts), ZERO)
    for month in schedule.months:
        assert month.remaining_balance < previous
        previous = month.remaining_balance


@given(portfolios())
@SLOW
def test_avalanche_never_costs_more_interest_than_snowball(portfolio):
    debts, extra = portfolio
    plans = compute_plans(debts, extra)
    if Outcome.NEVER_PAYS_OFF in (plans.avalanche.outcome, plans.snowball.outcome):
        return
    # One cent of tolerance: avalanche is optimal in the continuous case, but
    # cent-rounding lets a near-tie invert by a penny.
    assert plans.avalanche.total_interest_paid <= (
        plans.snowball.total_interest_paid + Decimal("0.01")
    )


@given(portfolios())
@SLOW
def test_strategies_beat_the_baseline(portfolio):
    debts, extra = portfolio
    plans = compute_plans(debts, extra)
    if plans.baseline.outcome is not Outcome.PAID_OFF:
        return
    for plan in (plans.snowball, plans.avalanche):
        if plan.outcome is not Outcome.PAID_OFF:
            continue
        assert plan.months_to_payoff <= plans.baseline.months_to_payoff
        assert plan.total_interest_paid <= plans.baseline.total_interest_paid + Decimal("0.01")


@given(portfolios(), st.integers(min_value=0, max_value=10_000))
@SLOW
def test_input_order_does_not_change_the_result(portfolio, seed):
    # The executable guard for the stable-sort determinism bug: without the
    # trailing id tiebreak in ordering.py, this fails on tied debts.
    debts, extra = portfolio
    shuffled = list(debts)
    random.Random(seed).shuffle(shuffled)
    assert compute_plans(debts, extra) == compute_plans(shuffled, extra)


@given(portfolios())
@SLOW
def test_baseline_is_independent_of_the_extra_payment(portfolio):
    debts, extra = portfolio
    assert compute_plans(debts, extra).baseline == compute_plans(debts, ZERO).baseline


@given(portfolios())
@SLOW
def test_simulate_always_terminates_within_the_cap(portfolio):
    debts, extra = portfolio
    schedule = simulate(debts, extra, snowball_order, fixed_minimum)
    assert len(schedule.months) <= 1200
