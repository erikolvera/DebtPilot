"""Deterministic household cash-flow calculations."""

from .analysis import allocate_extra_payment, analyze_cash_flow
from .errors import InvalidCashFlow
from .models import (
    CashFlowStatus,
    CashFlowSummary,
    DebtPaymentAllocation,
)

__all__ = [
    "CashFlowStatus",
    "CashFlowSummary",
    "DebtPaymentAllocation",
    "InvalidCashFlow",
    "allocate_extra_payment",
    "analyze_cash_flow",
]
