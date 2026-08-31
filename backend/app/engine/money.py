"""Money rounding helpers.

Every monetary value in the engine is quantized to whole cents at every step.
This reproduces how lenders actually round interest monthly, and it removes an
entire bug class: because balances are always exact cent values, "paid off" is
exactly ``balance == 0`` with no epsilon comparison.
"""

from decimal import ROUND_HALF_UP, Decimal

CENTS = Decimal("0.01")


def to_cents(value: Decimal) -> Decimal:
    """Round a money amount to whole cents, half away from zero.

    The rounding mode is passed explicitly rather than set on the global
    decimal context, which is process-wide state a library must not touch.
    """
    return value.quantize(CENTS, rounding=ROUND_HALF_UP)


def to_rate_precision(value: Decimal) -> Decimal:
    """Round an APR percentage to two places, matching ``numeric(5,2)``."""
    return value.quantize(CENTS, rounding=ROUND_HALF_UP)
