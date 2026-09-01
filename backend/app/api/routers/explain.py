"""POST /v1/payoff-plans/explain.

A separate route from the plan itself, and it recomputes rather than accepting
a comparison from the client. The engine answers in under a millisecond while
a generation call takes seconds, so bundling them would make every reader wait
on the slow half to see the fast half -- and accepting the client's own
comparison would let an edited payload dictate what the narrative says.
"""

from fastapi import APIRouter, Depends

from app.engine import Debt

from ..guidance.ratelimit import rate_limit
from ..guidance.service import explain as explain_plan
from ..schemas import ExplainResponse, PayoffPlanRequest

router = APIRouter()


# A plain `def`: the engine work is CPU-bound and the provider call blocks, so
# FastAPI runs this in a threadpool rather than stalling the event loop.
@router.post(
    "/payoff-plans/explain",
    response_model=ExplainResponse,
    dependencies=[Depends(rate_limit)],
)
def explain_payoff_plan(request: PayoffPlanRequest) -> ExplainResponse:
    debts = [
        Debt(
            id=debt.id,
            name=debt.name,
            balance=debt.balance,
            apr=debt.apr,
            minimum_payment=debt.minimum_payment,
        )
        for debt in request.debts
    ]
    guidance = explain_plan(debts, request.extra_monthly_payment, request.start_month)
    return ExplainResponse(
        headline=guidance.headline, body=guidance.body, source=guidance.source
    )
