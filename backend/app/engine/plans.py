"""Summarizing schedules and comparing scenarios.

``months_to_payoff`` and ``total_interest_paid`` are not separate
calculations — they are folds over the schedule the simulator already built.
"""

from collections.abc import Sequence
from decimal import Decimal

from .minimums import declining_minimum, fixed_minimum
from .models import (
    Debt,
    DebtPayoff,
    MonthlyTotal,
    Outcome,
    PlanComparison,
    PlanSummary,
    Schedule,
    Strategy,
)
from .ordering import avalanche_order, snowball_order
from .simulator import ZERO, simulate


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


def _interest_delta(worse: PlanSummary, better: PlanSummary) -> Decimal | None:
    """How much interest ``better`` saves against ``worse``.

    ``None`` when either side never pays off: you cannot subtract from a plan
    with no end.
    """
    if worse.outcome is not Outcome.PAID_OFF or better.outcome is not Outcome.PAID_OFF:
        return None
    return worse.total_interest_paid - better.total_interest_paid


def _months_delta(worse: PlanSummary, better: PlanSummary) -> int | None:
    if worse.months_to_payoff is None or better.months_to_payoff is None:
        return None
    return worse.months_to_payoff - better.months_to_payoff


def compute_schedules(
    debts: Sequence[Debt], extra_payment: Decimal
) -> dict[Strategy, Schedule]:
    """Run all three scenarios and keep the full schedules.

    The scenario configuration lives here and nowhere else, so a caller that
    needs the per-debt grid cannot drift from one that only needs summaries.
    """
    return {
        Strategy.SNOWBALL: simulate(
            debts, extra_payment, snowball_order, fixed_minimum
        ),
        Strategy.AVALANCHE: simulate(
            debts, extra_payment, avalanche_order, fixed_minimum
        ),
        # The baseline takes no extra payment and does not roll over freed
        # minimums: "do nothing differently" means that money is spent elsewhere.
        Strategy.MINIMUM_ONLY: simulate(
            debts, ZERO, snowball_order, declining_minimum, rollover=False
        ),
    }


def summarize_schedules(
    schedules: dict[Strategy, Schedule], debts: Sequence[Debt]
) -> PlanComparison:
    """Fold three schedules into the comparison object."""
    snowball = summarize(schedules[Strategy.SNOWBALL], debts, Strategy.SNOWBALL)
    avalanche = summarize(schedules[Strategy.AVALANCHE], debts, Strategy.AVALANCHE)
    baseline = summarize(schedules[Strategy.MINIMUM_ONLY], debts, Strategy.MINIMUM_ONLY)

    return PlanComparison(
        snowball=snowball,
        avalanche=avalanche,
        baseline=baseline,
        interest_saved_snowball_vs_baseline=_interest_delta(baseline, snowball),
        interest_saved_avalanche_vs_baseline=_interest_delta(baseline, avalanche),
        interest_saved_avalanche_vs_snowball=_interest_delta(snowball, avalanche),
        months_saved_snowball_vs_baseline=_months_delta(baseline, snowball),
        months_saved_avalanche_vs_baseline=_months_delta(baseline, avalanche),
        months_saved_avalanche_vs_snowball=_months_delta(snowball, avalanche),
    )


def compute_plans(debts: Sequence[Debt], extra_payment: Decimal) -> PlanComparison:
    """Run all three scenarios and precompute every comparison."""
    return summarize_schedules(compute_schedules(debts, extra_payment), debts)
