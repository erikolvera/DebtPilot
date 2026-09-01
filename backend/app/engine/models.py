"""Engine data model.

Plain frozen dataclasses only. No Pydantic, no FastAPI, no ORM — Pydantic
lives at the API boundary, which keeps this package testable with no app
context.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from decimal import Decimal
from enum import Enum

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


class Strategy(Enum):
    SNOWBALL = "snowball"
    AVALANCHE = "avalanche"
    MINIMUM_ONLY = "minimum_only"


class Outcome(Enum):
    PAID_OFF = "paid_off"
    NEVER_PAYS_OFF = "never_pays_off"


@dataclass(frozen=True)
class DebtMonth:
    """One debt's activity in one month."""

    debt_id: str
    starting_balance: Decimal
    interest_charged: Decimal
    payment_applied: Decimal
    ending_balance: Decimal


@dataclass(frozen=True)
class Month:
    """One month across every active debt. ``index`` is 1-based."""

    index: int
    debts: tuple[DebtMonth, ...]
    total_payment: Decimal
    total_interest: Decimal
    remaining_balance: Decimal


@dataclass(frozen=True)
class Schedule:
    """The full simulation record, plus how the run ended.

    ``simulate`` returns this, so it has to carry the outcome; the summary
    layer above it cannot invent one.
    """

    months: tuple[Month, ...]
    outcome: Outcome
    underwater_debt_ids: tuple[str, ...] = ()


@dataclass(frozen=True)
class MonthlyTotal:
    """A compact per-month row for charting, without the per-debt grid."""

    index: int
    remaining_balance: Decimal
    cumulative_interest: Decimal


@dataclass(frozen=True)
class DebtPayoff:
    debt_id: str
    name: str
    payoff_month: int
    total_interest_paid: Decimal


@dataclass(frozen=True)
class PlanSummary:
    """What crosses the API boundary for one scenario."""

    strategy: Strategy
    outcome: Outcome
    months_to_payoff: int | None
    underwater_debt_ids: tuple[str, ...]
    total_interest_paid: Decimal
    total_paid: Decimal
    debt_payoffs: tuple[DebtPayoff, ...]
    monthly_totals: tuple[MonthlyTotal, ...]


@dataclass(frozen=True)
class PlanComparison:
    """All three scenarios and their precomputed, nullable differences."""

    snowball: PlanSummary
    avalanche: PlanSummary
    baseline: PlanSummary
    interest_saved_snowball_vs_baseline: Decimal | None
    interest_saved_avalanche_vs_baseline: Decimal | None
    interest_saved_avalanche_vs_snowball: Decimal | None
    months_saved_snowball_vs_baseline: int | None
    months_saved_avalanche_vs_baseline: int | None
    months_saved_avalanche_vs_snowball: int | None
