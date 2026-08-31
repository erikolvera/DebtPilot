from decimal import Decimal

from app.engine.minimums import (
    MINIMUM_FLOOR,
    declining_minimum,
    fixed_minimum,
    implied_percentage,
)
from app.engine.models import Debt


def make_debt(balance="1000.00", minimum="50.00") -> Debt:
    return Debt(
        id="d1",
        name="Visa",
        balance=Decimal(balance),
        apr=Decimal("20.00"),
        minimum_payment=Decimal(minimum),
    )


def test_floor_is_twenty_five_dollars():
    assert MINIMUM_FLOOR == Decimal("25.00")


def test_fixed_minimum_ignores_current_balance():
    debt = make_debt()
    assert fixed_minimum(debt, Decimal("100.00")) == Decimal("50.00")
    assert fixed_minimum(debt, Decimal("900.00")) == Decimal("50.00")


def test_implied_percentage_is_minimum_over_starting_balance():
    # 50 / 1000 = 5%
    assert implied_percentage(make_debt()) == Decimal("0.05")


def test_declining_minimum_scales_with_current_balance():
    # 5% of 900.00 = 45.00, which is above the floor
    assert declining_minimum(make_debt(), Decimal("900.00")) == Decimal("45.00")


def test_declining_minimum_applies_the_floor():
    # 5% of 400.00 = 20.00, which is below the 25.00 floor
    assert declining_minimum(make_debt(), Decimal("400.00")) == Decimal("25.00")


def test_declining_minimum_rounds_to_cents():
    # 5% of 333.33 = 16.6665 -> below floor, so floor wins
    assert declining_minimum(make_debt(), Decimal("333.33")) == Decimal("25.00")
    # 5% of 1234.57 = 61.7285 -> 61.73
    assert declining_minimum(make_debt(), Decimal("1234.57")) == Decimal("61.73")


def test_zero_stored_minimum_yields_zero_not_the_floor():
    # The floor must not manufacture a payment the user never had.
    debt = make_debt(minimum="0.00")
    assert declining_minimum(debt, Decimal("1000.00")) == Decimal("0.00")


def test_implied_percentage_of_zero_minimum_is_zero():
    assert implied_percentage(make_debt(minimum="0.00")) == Decimal(0)


def test_implied_percentage_of_zero_balance_is_zero():
    assert implied_percentage(make_debt(balance="0.00")) == Decimal(0)


def test_floor_never_exceeds_the_stored_minimum():
    # A $10 stored minimum must not be inflated to $25 by the floor —
    # the floor is $25 or the user's own minimum, whichever is smaller.
    debt = make_debt(minimum="10.00")
    # implied pct = 1%; at balance 400 scaled = 4.00, so the 10.00 floor wins
    assert declining_minimum(debt, Decimal("400.00")) == Decimal("10.00")
