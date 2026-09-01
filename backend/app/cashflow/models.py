"""Framework-free models for one monthly household snapshot."""

from dataclasses import dataclass
from decimal import Decimal
from enum import Enum

class CashFlowStatus(Enum):
    DEFICIT = "deficit"
    BREAK_EVEN = "break_even"
    SURPLUS = "surplus"


@dataclass(frozen=True)
class CashFlowSummary:
    total_monthly_income: Decimal
    total_monthly_expenses: Decimal
    total_minimum_debt_payments: Decimal
    available_monthly_cash_flow: Decimal
    shortfall: Decimal
    maximum_affordable_extra_payment: Decimal
    status: CashFlowStatus


@dataclass(frozen=True)
class DebtPaymentAllocation:
    requested_extra_payment: Decimal
    planned_extra_payment: Decimal
    unallocated_cash_flow: Decimal
    extra_payment_gap: Decimal
    is_affordable: bool
