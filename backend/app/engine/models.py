"""Engine data model.

Plain frozen dataclasses only. No Pydantic, no FastAPI, no ORM — Pydantic
lives at the API boundary, which keeps this package testable with no app
context.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from decimal import Decimal

from .errors import InvalidDebt
from .money import to_cents, to_rate_precision


@dataclass(frozen=True)
class Debt:
    """A single debt, as the engine sees it.

    Deliberately carries no ``user_id``, ``type``, or timestamps: the engine
    does not know users exist. ``apr`` is a percent (24.99), not a rate.
    """

    id: str
    name: str
    balance: Decimal
    apr: Decimal
    minimum_payment: Decimal

    def __post_init__(self) -> None:
        if self.balance < 0:
            raise InvalidDebt(f"debt {self.id!r}: balance may not be negative")
        if self.apr < 0:
            raise InvalidDebt(f"debt {self.id!r}: apr may not be negative")
        if self.minimum_payment < 0:
            raise InvalidDebt(
                f"debt {self.id!r}: minimum_payment may not be negative"
            )
        # Normalize precision on ingest rather than rejecting it. The frozen
        # dataclass requires object.__setattr__ to write during __post_init__.
        object.__setattr__(self, "balance", to_cents(self.balance))
        object.__setattr__(self, "minimum_payment", to_cents(self.minimum_payment))
        object.__setattr__(self, "apr", to_rate_precision(self.apr))


def validate_portfolio(debts: Sequence[Debt], extra_payment: Decimal) -> None:
    """Validate cross-debt invariants that a single ``Debt`` cannot check."""
    if extra_payment < 0:
        raise InvalidDebt("extra_payment may not be negative")
    seen: set[str] = set()
    for debt in debts:
        if debt.id in seen:
            raise InvalidDebt(f"duplicate debt id {debt.id!r}")
        seen.add(debt.id)
