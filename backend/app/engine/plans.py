"""Summarizing schedules and comparing scenarios.

``months_to_payoff`` and ``total_interest_paid`` are not separate
calculations — they are folds over the schedule the simulator already built.
"""

from collections.abc import Sequence
from decimal import Decimal

from .models import (
    Debt,
    DebtPayoff,
    MonthlyTotal,
    Outcome,
    PlanSummary,
    Schedule,
    Strategy,
)
from .simulator import ZERO


def summarize(
    schedule: Schedule, debts: Sequence[Debt], strategy: Strategy
) -> PlanSummary:
    """Fold a full schedule into the object that crosses the API boundary."""
    names = {d.id: d.name for d in debts}

    payoff_month: dict[str, int] = {}
    interest_by_debt: dict[str, Decimal] = {}
    monthly_totals: list[MonthlyTotal] = []
    cumulative = ZERO
    total_interest = ZERO
    total_paid = ZERO

    for month in schedule.months:
        total_interest += month.total_interest
        total_paid += month.total_payment
        cumulative += month.total_interest
        monthly_totals.append(
            MonthlyTotal(
                index=month.index,
                remaining_balance=month.remaining_balance,
                cumulative_interest=cumulative,
            )
        )
        for row in month.debts:
            interest_by_debt[row.debt_id] = (
                interest_by_debt.get(row.debt_id, ZERO) + row.interest_charged
            )
            if row.ending_balance <= ZERO and row.debt_id not in payoff_month:
                payoff_month[row.debt_id] = month.index

    debt_payoffs = tuple(
        DebtPayoff(
            debt_id=debt_id,
            name=names[debt_id],
            payoff_month=month_index,
            total_interest_paid=interest_by_debt[debt_id],
        )
        # Sorted by month, then id, so the order is total and reproducible.
        for debt_id, month_index in sorted(
            payoff_month.items(), key=lambda item: (item[1], item[0])
        )
    )

    paid_off = schedule.outcome is Outcome.PAID_OFF
    return PlanSummary(
        strategy=strategy,
        outcome=schedule.outcome,
        months_to_payoff=len(schedule.months) if paid_off else None,
        underwater_debt_ids=schedule.underwater_debt_ids,
        total_interest_paid=total_interest,
        total_paid=total_paid,
        debt_payoffs=debt_payoffs if paid_off else (),
        monthly_totals=tuple(monthly_totals),
    )
