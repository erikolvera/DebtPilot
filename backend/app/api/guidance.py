"""Deterministic, affordable options for accelerating a payoff plan."""

from collections.abc import Sequence
from decimal import Decimal

from app.engine import Debt, Outcome, PlanComparison, PlanSummary, compute_plans
from app.engine.money import to_cents

from .dates import month_label
from .schemas import (
    CompactOptionImpactOut,
    PayoffGuidanceOut,
    PayoffPaymentOptionOut,
)

ZERO = Decimal("0.00")


def _recommended_strategy(comparison: PlanComparison) -> str | None:
    snowball_paid = comparison.snowball.outcome is Outcome.PAID_OFF
    avalanche_paid = comparison.avalanche.outcome is Outcome.PAID_OFF
    if snowball_paid != avalanche_paid:
        return "snowball" if snowball_paid else "avalanche"
    if not snowball_paid:
        return None
    if comparison.snowball.total_interest_paid < comparison.avalanche.total_interest_paid:
        return "snowball"
    if comparison.avalanche.total_interest_paid < comparison.snowball.total_interest_paid:
        return "avalanche"
    return None


def _option_amounts(
    current: Decimal, maximum: Decimal
) -> list[tuple[str, Decimal]]:
    """Return ordered, unique cent amounts without exceeding ``maximum``."""
    current = to_cents(current)
    maximum = to_cents(maximum)
    unallocated = to_cents(max(maximum - current, ZERO))
    options: list[tuple[str, Decimal]] = [("current", current)]
    if unallocated > ZERO:
        split = to_cents(current + unallocated / 2)
        if split != current and split != maximum:
            options.append(("split_difference", split))
        if maximum != current:
            options.append(("maximum", maximum))
    return options


def _impact(
    option: PlanSummary, current: PlanSummary, start_month: str
) -> CompactOptionImpactOut:
    both_pay_off = (
        option.outcome is Outcome.PAID_OFF and current.outcome is Outcome.PAID_OFF
    )
    return CompactOptionImpactOut(
        outcome=option.outcome.value,
        payoff_month=(
            month_label(start_month, option.months_to_payoff)
            if option.months_to_payoff is not None and option.months_to_payoff > 0
            else None
        ),
        months_to_payoff=option.months_to_payoff,
        total_interest_paid=option.total_interest_paid,
        months_saved_vs_current=(
            current.months_to_payoff - option.months_to_payoff
            if both_pay_off
            and current.months_to_payoff is not None
            and option.months_to_payoff is not None
            else None
        ),
        interest_saved_vs_current=(
            current.total_interest_paid - option.total_interest_paid
            if both_pay_off
            else None
        ),
    )


def build_payoff_guidance(
    debts: Sequence[Debt],
    current_extra: Decimal,
    maximum_extra: Decimal,
    current_comparison: PlanComparison,
    start_month: str,
) -> PayoffGuidanceOut:
    """Build guidance while reusing the report's already-computed current plan."""
    current_extra = to_cents(current_extra)
    maximum_extra = to_cents(maximum_extra)
    options: list[PayoffPaymentOptionOut] = []
    for kind, amount in _option_amounts(current_extra, maximum_extra):
        comparison = (
            current_comparison
            if amount == current_extra
            else compute_plans(debts, amount)
        )
        options.append(
            PayoffPaymentOptionOut(
                kind=kind,
                extra_monthly_payment=amount,
                additional_monthly_payment=to_cents(amount - current_extra),
                monthly_cushion_remaining=to_cents(maximum_extra - amount),
                snowball=_impact(
                    comparison.snowball, current_comparison.snowball, start_month
                ),
                avalanche=_impact(
                    comparison.avalanche, current_comparison.avalanche, start_month
                ),
            )
        )
    return PayoffGuidanceOut(
        recommended_strategy=_recommended_strategy(current_comparison),
        payment_options=options,
    )
