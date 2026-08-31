"""Debt ordering — the strategy seam.

Snowball and avalanche differ by exactly one sort key. Both orderings are
*total*: the trailing ``id`` tiebreak is load-bearing, not pedantry. Python's
sort is stable, so without it the ordering silently inherits input order, and
the same debts submitted in a different sequence would produce a different
per-debt payoff order — a determinism bug that fixed-list unit tests cannot
find.
"""

from collections.abc import Mapping, Sequence
from decimal import Decimal

from .models import Debt


def snowball_order(
    debts: Sequence[Debt], balances: Mapping[str, Decimal]
) -> tuple[Debt, ...]:
    """Smallest balance first, then highest APR, then id."""
    return tuple(sorted(debts, key=lambda d: (balances[d.id], -d.apr, d.id)))


def avalanche_order(
    debts: Sequence[Debt], balances: Mapping[str, Decimal]
) -> tuple[Debt, ...]:
    """Highest APR first, then smallest balance, then id."""
    return tuple(sorted(debts, key=lambda d: (-d.apr, balances[d.id], d.id)))
