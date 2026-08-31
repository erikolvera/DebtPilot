"""Minimum-payment rules — the second seam.

Snowball and avalanche use ``fixed_minimum``: safe because the total monthly
outlay is held constant, so a shrinking real-world minimum would only free
cash the model already directs at the target debt.

The minimums-only baseline uses ``declining_minimum``, because minimums that
shrink with the balance are exactly why paying minimums alone takes decades.
Modeling them as fixed would make the baseline wildly too optimistic and
understate the gap the product exists to show.
"""

from decimal import Decimal

from .models import Debt
from .money import to_cents

MINIMUM_FLOOR = Decimal("25.00")


def fixed_minimum(debt: Debt, balance: Decimal) -> Decimal:
    """The stored minimum, unchanged. ``balance`` is ignored by design."""
    return debt.minimum_payment


def implied_percentage(debt: Debt) -> Decimal:
    """The debt's minimum as a fraction of its starting balance.

    Derived rather than collected, because users do not know their card's
    minimum-payment formula.
    """
    if debt.balance <= 0 or debt.minimum_payment <= 0:
        return Decimal(0)
    return debt.minimum_payment / debt.balance


def declining_minimum(debt: Debt, balance: Decimal) -> Decimal:
    """A minimum that shrinks with the balance, floored at the LESSER of
    ``MINIMUM_FLOOR`` and the debt's own stored minimum.

    The floor must never manufacture a payment larger than the one the user
    actually has: a $10 stored minimum stays a $10 floor, and a debt with no
    stored minimum keeps no minimum at all.
    """
    if debt.minimum_payment <= 0:
        return Decimal("0.00")
    floor = min(MINIMUM_FLOOR, debt.minimum_payment)
    scaled = implied_percentage(debt) * balance
    return to_cents(max(floor, scaled))
