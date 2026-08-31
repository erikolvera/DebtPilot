"""Interest accrual — the swappable seam.

Monthly periods: one simulation step is one month, interest is charged before
the payment posts. This slightly understates real daily compounding (26.82%
versus 27.12% effective at a 24% APR), which is why user-facing copy must say
"estimated". Replacing this module with daily accrual should not require any
change to simulator.py.
"""

from decimal import Decimal

from .money import to_cents

HUNDRED = Decimal(100)
MONTHS_PER_YEAR = Decimal(12)


def monthly_rate(apr: Decimal) -> Decimal:
    """Convert an APR percentage to a monthly rate. Not rounded."""
    return apr / HUNDRED / MONTHS_PER_YEAR


def monthly_interest(balance: Decimal, apr: Decimal) -> Decimal:
    """Interest accrued in one month, rounded to whole cents."""
    if balance <= 0 or apr <= 0:
        return Decimal("0.00")
    return to_cents(balance * monthly_rate(apr))
