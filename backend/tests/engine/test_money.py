from decimal import Decimal, getcontext

from app.engine.money import to_cents


def test_to_cents_rounds_half_up_not_bankers():
    # Decimal defaults to ROUND_HALF_EVEN, which would give 0.02 here.
    # This test fails if the rounding mode is not passed explicitly.
    assert to_cents(Decimal("0.025")) == Decimal("0.03")


def test_to_cents_does_not_mutate_the_global_context():
    before = getcontext().rounding
    to_cents(Decimal("0.025"))
    assert getcontext().rounding == before

