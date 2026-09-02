"""Exact, stateless comparisons for browser-local monthly check-ins."""

from collections.abc import Mapping, Sequence
from decimal import Decimal

from app.engine import Debt
from app.engine.money import to_cents

from .schemas import (
    CheckInContextIn,
    CheckInProgressOut,
    ProgressComparisonOut,
    ProgressMilestone,
)

ZERO = Decimal("0.00")
MILESTONES: tuple[tuple[int, ProgressMilestone], ...] = (
    (10, "10_percent"),
    (25, "25_percent"),
    (50, "50_percent"),
    (75, "75_percent"),
    (100, "debt_free"),
)


def _total(balances: Mapping[str, Decimal]) -> Decimal:
    return to_cents(sum(balances.values(), ZERO))


def _comparison(
    earlier: Mapping[str, Decimal], current: Mapping[str, Decimal]
) -> ProgressComparisonOut:
    if set(earlier) != set(current):
        return ProgressComparisonOut(status="portfolio_changed", amount=None)

    change = to_cents(_total(current) - _total(earlier))
    if change < ZERO:
        return ProgressComparisonOut(status="decreased", amount=to_cents(-change))
    if change > ZERO:
        return ProgressComparisonOut(status="increased", amount=change)
    return ProgressComparisonOut(status="unchanged", amount=ZERO)


def _milestones(
    baseline: Mapping[str, Decimal],
    previous: Mapping[str, Decimal],
    current: Mapping[str, Decimal],
) -> list[ProgressMilestone]:
    if set(baseline) != set(previous) or set(baseline) != set(current):
        return []

    baseline_total = _total(baseline)
    if baseline_total <= ZERO:
        return []
    reduction = max(baseline_total - _total(current), ZERO)
    return [
        milestone
        for percentage, milestone in MILESTONES
        if reduction * 100 >= baseline_total * percentage
    ]


def build_check_in_progress(
    context: CheckInContextIn | None,
    current_debts: Sequence[Debt],
) -> CheckInProgressOut | None:
    """Compare stored snapshots without retaining any financial data server-side."""
    if context is None:
        return None

    baseline = {row.id: row.balance for row in context.baseline.debts}
    previous = {row.id: row.balance for row in context.previous.debts}
    current = {debt.id: debt.balance for debt in current_debts}
    same_previous_portfolio = set(previous) == set(current)
    newly_paid_off = (
        sorted(
            debt_id
            for debt_id, previous_balance in previous.items()
            if previous_balance > ZERO and current[debt_id] <= ZERO
        )
        if same_previous_portfolio
        else []
    )

    return CheckInProgressOut(
        previous_month=context.previous.month,
        since_previous=_comparison(previous, current),
        since_baseline=_comparison(baseline, current),
        newly_paid_off_debt_ids=newly_paid_off,
        milestones_reached=_milestones(baseline, previous, current),
    )
