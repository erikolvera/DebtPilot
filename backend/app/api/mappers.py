"""Engine dataclasses to published response models.

This is the one place the internal representation meets the public contract,
which is why the conversion is written out rather than derived: an engine
field rename must surface here as a reviewable diff, not as a silent change
to what clients receive.
"""

from app.engine import PlanComparison, PlanSummary, Schedule, Strategy

from .dates import month_label
from .schemas import (
    ComparisonOut,
    DebtMonthOut,
    DebtPayoffOut,
    MonthlyTotalOut,
    MonthOut,
    PayoffPlanResponse,
    ScenarioOut,
    ScenariosOut,
)


# The hard ceiling on per-debt rows in one scenario's `detail=full` schedule.
# The debt cap alone does not bound the payload: a minimums-only baseline can
# run the full 1200-month horizon, so 20 debts x 1200 months x 3 scenarios is
# tens of megabytes of JSON built in memory before a byte is sent. Whole
# months are dropped from the tail, never partial ones, so every month that
# does appear is complete; `schedule_truncated` tells the client it happened.
MAX_SCHEDULE_ROWS = 5000


def _payoff_month(months_to_payoff: int | None, start_month: str) -> str | None:
    """Calendar month a plan finishes in, or None when it never does.

    Non-null exactly when the term is one month or more. A never-paying-off
    plan has no end, and a zero-month plan (an empty portfolio) never began —
    asking for month 0 would name the month before `start_month`.
    """
    if months_to_payoff is None or months_to_payoff < 1:
        return None
    return month_label(start_month, months_to_payoff)


def _schedule(
    schedule: Schedule | None, start_month: str
) -> tuple[list[MonthOut] | None, bool]:
    """The per-debt month-by-month grid and whether it was truncated.

    `(None, False)` when detail was not requested. Otherwise the leading
    months whose per-debt rows fit inside MAX_SCHEDULE_ROWS, and a flag that
    is true exactly when at least one month was dropped.
    """
    if schedule is None:
        return None, False

    kept = []
    rows = 0
    truncated = False
    for month in schedule.months:
        rows += len(month.debts)
        if rows > MAX_SCHEDULE_ROWS:
            truncated = True
            break
        kept.append(month)

    return [
        MonthOut(
            month_number=month.index,
            month=month_label(start_month, month.index),
            debts=[
                DebtMonthOut(
                    debt_id=row.debt_id,
                    starting_balance=row.starting_balance,
                    interest_charged=row.interest_charged,
                    payment_applied=row.payment_applied,
                    ending_balance=row.ending_balance,
                )
                for row in month.debts
            ],
            total_payment=month.total_payment,
            total_interest=month.total_interest,
            remaining_balance=month.remaining_balance,
        )
        for month in kept
    ], truncated


def _scenario(
    summary: PlanSummary, start_month: str, schedule: Schedule | None
) -> ScenarioOut:
    months, truncated = _schedule(schedule, start_month)
    return ScenarioOut(
        strategy=summary.strategy.value,
        outcome=summary.outcome.value,
        months_to_payoff=summary.months_to_payoff,
        payoff_month=_payoff_month(summary.months_to_payoff, start_month),
        underwater_debt_ids=list(summary.underwater_debt_ids),
        total_interest_paid=summary.total_interest_paid,
        total_paid=summary.total_paid,
        debt_payoffs=[
            DebtPayoffOut(
                debt_id=payoff.debt_id,
                name=payoff.name,
                months_to_payoff=payoff.payoff_month,
                payoff_month=month_label(start_month, payoff.payoff_month),
                total_interest_paid=payoff.total_interest_paid,
            )
            for payoff in summary.debt_payoffs
        ],
        monthly_totals=[
            MonthlyTotalOut(
                month_number=total.index,
                month=month_label(start_month, total.index),
                remaining_balance=total.remaining_balance,
                cumulative_interest=total.cumulative_interest,
            )
            for total in summary.monthly_totals
        ],
        schedule=months,
        schedule_truncated=truncated,
    )


def to_response(
    comparison: PlanComparison,
    start_month: str,
    schedules: dict[Strategy, Schedule] | None = None,
) -> PayoffPlanResponse:
    """Build the wire response. Pass `schedules` to populate detail=full."""
    return PayoffPlanResponse(
        start_month=start_month,
        scenarios=ScenariosOut(
            snowball=_scenario(
                comparison.snowball,
                start_month,
                None if schedules is None else schedules[Strategy.SNOWBALL],
            ),
            avalanche=_scenario(
                comparison.avalanche,
                start_month,
                None if schedules is None else schedules[Strategy.AVALANCHE],
            ),
            baseline=_scenario(
                comparison.baseline,
                start_month,
                None if schedules is None else schedules[Strategy.MINIMUM_ONLY],
            ),
        ),
        comparison=ComparisonOut(
            interest_saved_snowball_vs_baseline=comparison.interest_saved_snowball_vs_baseline,
            interest_saved_avalanche_vs_baseline=comparison.interest_saved_avalanche_vs_baseline,
            interest_saved_avalanche_vs_snowball=comparison.interest_saved_avalanche_vs_snowball,
            months_saved_snowball_vs_baseline=comparison.months_saved_snowball_vs_baseline,
            months_saved_avalanche_vs_baseline=comparison.months_saved_avalanche_vs_baseline,
            months_saved_avalanche_vs_snowball=comparison.months_saved_avalanche_vs_snowball,
        ),
    )
