from decimal import Decimal, getcontext

from app.engine.money import CENTS, to_cents, to_rate_precision


def test_to_cents_rounds_to_two_places():
    assert to_cents(Decimal("1.6658333")) == Decimal("1.67")


def test_to_cents_rounds_half_up_not_bankers():
    # Decimal defaults to ROUND_HALF_EVEN, which would give 0.02 here.
    # This test fails if the rounding mode is not passed explicitly.
    assert to_cents(Decimal("0.025")) == Decimal("0.03")


def test_to_cents_leaves_exact_values_alone():
    assert to_cents(Decimal("100.00")) == Decimal("100.00")


def test_to_cents_does_not_mutate_the_global_context():
    before = getcontext().rounding
    to_cents(Decimal("0.025"))
    assert getcontext().rounding == before


def test_to_rate_precision_rounds_apr_to_two_places():
    assert to_rate_precision(Decimal("24.9949")) == Decimal("24.99")


def test_cents_constant_is_two_places():
    assert CENTS == Decimal("0.01")
