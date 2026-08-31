"""POST /v1/payoff-plans — the endpoint.

Validate, call the engine, map. Nothing else belongs here.
"""

from typing import Literal

from fastapi import APIRouter, Query

from app.engine import Debt, compute_plans, compute_schedules, summarize_schedules

from ..mappers import to_response
from ..schemas import PayoffPlanRequest, PayoffPlanResponse

router = APIRouter()


def _to_engine_debts(request: PayoffPlanRequest) -> list[Debt]:
    return [
        Debt(
            id=debt.id,
            name=debt.name,
            balance=debt.balance,
            apr=debt.apr,
            minimum_payment=debt.minimum_payment,
        )
        for debt in request.debts
    ]


# A plain `def`, not `async def`: the engine is CPU-bound pure Python, so
# FastAPI runs this in a threadpool instead of blocking the event loop.
@router.post("/payoff-plans", response_model=PayoffPlanResponse)
def create_payoff_plan(
    request: PayoffPlanRequest,
    detail: Literal["full"] | None = Query(
        default=None,
        description="Pass 'full' to include the per-debt month-by-month schedule.",
    ),
) -> PayoffPlanResponse:
    debts = _to_engine_debts(request)

    if detail == "full":
        schedules = compute_schedules(debts, request.extra_monthly_payment)
        comparison = summarize_schedules(schedules, debts)
    else:
        schedules = None
        comparison = compute_plans(debts, request.extra_monthly_payment)

    return to_response(comparison, request.start_month, schedules)
