"""An independent oracle for the single-debt case.

The closed-form amortization formula is derived algebraically, with no
stepping loop anywhere in it. If a month-by-month simulation and an equation
agree across thousands of randomized cases, the monthly accrual model itself
is right — which is the thing golden fixtures can only check at a few points.
"""

import math
from decimal import Decimal

from hypothesis import assume, given, settings
from hypothesis import strategies as st

from app.engine.minimums import fixed_minimum
from app.engine.models import Debt, Outcome
from app.engine.money import to_cents
from app.engine.ordering import snowball_order
from app.engine.simulator import ZERO, simulate


@given(
    balance=st.decimals(
        min_value=Decimal("100.00"), max_value=Decimal("50000.00"), places=2
    ),
    apr=st.decimals(min_value=Decimal("1.00"), max_value=Decimal("35.00"), places=2),
    payment_fraction=st.decimals(
        min_value=Decimal("0.05"), max_value=Decimal("0.50"), places=4
    ),
)
@settings(max_examples=300, deadline=None)
def test_single_debt_matches_the_closed_form(balance, apr, payment_fraction):
    payment = to_cents(balance * payment_fraction)

    rate = float(apr) / 100.0 / 12.0
    principal = float(balance)
    installment = float(payment)

    # The formula only applies while the payment outruns the interest.
    assume(installment > principal * rate * 1.05)

    #   n = -log(1 - r*B/P) / log(1 + r)
    expected_months = -math.log(1 - rate * principal / installment) / math.log(1 + rate)

    schedule = simulate(
        [Debt("a", "Card a", balance, apr, payment)],
        ZERO,
        snowball_order,
        fixed_minimum,
    )

    assert schedule.outcome is Outcome.PAID_OFF
    # One month of slack absorbs cent-level rounding in the simulator.
    assert abs(len(schedule.months) - math.ceil(expected_months)) <= 1


@given(
    balance=st.decimals(
        min_value=Decimal("100.00"), max_value=Decimal("10000.00"), places=2
    ),
    payment=st.decimals(
        min_value=Decimal("25.00"), max_value=Decimal("500.00"), places=2
    ),
)
@settings(max_examples=100, deadline=None)
def test_zero_apr_takes_exactly_ceil_balance_over_payment(balance, payment):
    # With no interest the answer needs no calculus at all.
    schedule = simulate(
        [Debt("a", "Card a", balance, Decimal("0.00"), payment)],
        ZERO,
        snowball_order,
        fixed_minimum,
    )
    expected = math.ceil(balance / payment)
    assert len(schedule.months) == expected
