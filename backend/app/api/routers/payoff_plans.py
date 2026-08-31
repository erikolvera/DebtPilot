"""POST /v1/payoff-plans — the endpoint.

Validate, call the engine, map. Nothing else belongs here.
"""

from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, Query

from app.engine import Debt, compute_plans, compute_schedules, summarize_schedules

from ..auth import current_user_id
from ..dates import MONTH_PATTERN
from ..db import user_scoped_connection
from ..repositories import debts as debts_repo

from ..mappers import to_response
from ..schemas import Money, PayoffPlanRequest, PayoffPlanResponse

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


@router.get("/me/payoff-plan", response_model=PayoffPlanResponse)
def my_payoff_plan(
    extra_monthly_payment: Money = Query(ge=0, le=Decimal("99999999.99")),
    start_month: str = Query(pattern=MONTH_PATTERN),
    detail: Literal["full"] | None = Query(
        default=None,
        description="Pass 'full' to include the per-debt month-by-month schedule.",
    ),
    user_id: str = Depends(current_user_id),
) -> PayoffPlanResponse:
    """The signed-in user's plan, computed from their stored debts.

    Money arrives as a query parameter here, so it is a string by definition:
    the Money type still parses it to Decimal, but its reject-bare-numbers
    guarantee is trivially satisfied. The bounds are what do the work.
    """
    with user_scoped_connection(user_id) as conn:
        rows = debts_repo.list_debts(conn, user_id)

    debts = [
        Debt(
            id=str(row.id),
            name=row.name,
            balance=row.balance,
            apr=row.apr,
            minimum_payment=row.minimum_payment,
        )
        for row in rows
    ]

    if detail == "full":
        schedules = compute_schedules(debts, extra_monthly_payment)
        comparison = summarize_schedules(schedules, debts)
    else:
        schedules = None
        comparison = compute_plans(debts, extra_monthly_payment)

    return to_response(comparison, start_month, schedules)
