"""Pure arithmetic for cash flow and an affordable debt-payment budget."""

from collections.abc import Sequence
from decimal import Decimal

from app.engine.money import to_cents

from .errors import InvalidCashFlow
from .models import (
    CashFlowStatus,
    CashFlowSummary,
    DebtPaymentAllocation,
    IncomeFrequency,
)

ZERO = Decimal("0.00")
MONTHS_PER_YEAR = Decimal("12")
PAY_PERIODS = {
    IncomeFrequency.SALARY: Decimal("1"),
    IncomeFrequency.MONTHLY: Decimal("12"),
    IncomeFrequency.BIWEEKLY: Decimal("26"),
    IncomeFrequency.WEEKLY: Decimal("52"),
}


def monthly_income_amount(amount: Decimal, frequency: IncomeFrequency) -> Decimal:
    """Convert one paycheck amount to its monthly equivalent."""
    if amount < ZERO:
        raise InvalidCashFlow("income may not be negative")
    return amount * PAY_PERIODS[frequency] / MONTHS_PER_YEAR


def analyze_cash_flow(
    incomes: Sequence[Decimal],
    expenses: Sequence[Decimal],
    minimum_debt_payments: Sequence[Decimal],
) -> CashFlowSummary:
    """Summarize one normalized month without making lifestyle judgments."""
    if any(amount < ZERO for amount in incomes):
        raise InvalidCashFlow("income may not be negative")
    if any(amount < ZERO for amount in expenses):
        raise InvalidCashFlow("expenses may not be negative")
    if any(amount < ZERO for amount in minimum_debt_payments):
        raise InvalidCashFlow("minimum debt payments may not be negative")

    income = to_cents(sum(incomes, ZERO))
    spending = to_cents(sum(expenses, ZERO))
    minimums = to_cents(sum(minimum_debt_payments, ZERO))
    available = to_cents(income - spending - minimums)

    if available < ZERO:
        status = CashFlowStatus.DEFICIT
    elif available == ZERO:
        status = CashFlowStatus.BREAK_EVEN
    else:
        status = CashFlowStatus.SURPLUS

    return CashFlowSummary(
        total_monthly_income=income,
        total_monthly_expenses=spending,
        total_minimum_debt_payments=minimums,
        available_monthly_cash_flow=available,
        shortfall=max(-available, ZERO),
        maximum_affordable_extra_payment=max(available, ZERO),
        status=status,
    )


def allocate_extra_payment(
    requested: Decimal, summary: CashFlowSummary
) -> DebtPaymentAllocation:
    """Cap a requested extra payment at the cash the household actually has."""
    if requested < ZERO:
        raise InvalidCashFlow("requested extra payment may not be negative")
    requested = to_cents(requested)
    maximum = summary.maximum_affordable_extra_payment
    planned = min(requested, maximum)
    return DebtPaymentAllocation(
        requested_extra_payment=requested,
        planned_extra_payment=planned,
        unallocated_cash_flow=to_cents(max(maximum - planned, ZERO)),
        extra_payment_gap=to_cents(max(requested - maximum, ZERO)),
        is_affordable=requested <= maximum,
    )
