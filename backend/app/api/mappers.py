"""Map engine summaries onto the public response contract."""

from app.engine import PlanComparison, PlanSummary

from .dates import month_label
from .schemas import (
    ComparisonOut,
    DebtPayoffOut,
    MonthlyTotalOut,
    PayoffPlanResponse,
    ScenarioOut,
    ScenariosOut,
)


def _payoff_month(months_to_payoff: int | None, start_month: str) -> str | None:
    if months_to_payoff is None or months_to_payoff < 1:
        return None
    return month_label(start_month, months_to_payoff)


def _scenario(summary: PlanSummary, start_month: str) -> ScenarioOut:
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
    )


def to_response(
    comparison: PlanComparison, start_month: str
) -> PayoffPlanResponse:
    return PayoffPlanResponse(
        start_month=start_month,
        scenarios=ScenariosOut(
            snowball=_scenario(comparison.snowball, start_month),
            avalanche=_scenario(comparison.avalanche, start_month),
            baseline=_scenario(comparison.baseline, start_month),
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
