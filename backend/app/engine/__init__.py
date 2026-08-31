"""Deterministic debt payoff engine.

Pure Python. No framework imports, no I/O, no clock access. Every number the
product shows a user originates here.
"""

from .errors import InvalidDebt
from .models import (
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
from .plans import compute_plans, compute_schedules, summarize, summarize_schedules
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
    "compute_schedules",
    "simulate",
    "summarize",
    "summarize_schedules",
]
