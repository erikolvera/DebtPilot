"""Deterministic debt payoff engine.

Pure Python. No framework imports, no I/O, no clock access. Every number the
product shows a user originates here.
"""

from .models import (
    InvalidDebt,
    Debt,
    DebtMonth,
    DebtPayoff,
    Month,
    MonthlyTotal,
    Outcome,
    PlanComparison,
    PlanSummary,
    Schedule,
    Strategy,
)
from .plans import compute_plans, summarize
from .simulator import simulate

__all__ = [
    "Debt",
    "DebtMonth",
    "DebtPayoff",
    "InvalidDebt",
    "Month",
    "MonthlyTotal",
    "Outcome",
    "PlanComparison",
    "PlanSummary",
    "Schedule",
    "Strategy",
    "compute_plans",
    "simulate",
    "summarize",
]
