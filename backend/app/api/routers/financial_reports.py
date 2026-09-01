"""A complete, stateless household cash-flow and debt report."""

from decimal import Decimal

from fastapi import APIRouter

from app.cashflow import (
    CashFlowStatus,
    allocate_extra_payment,
    analyze_cash_flow,
    monthly_income_amount,
)
from app.engine import Debt, compute_plans
from app.engine.money import to_cents

from ..mappers import to_response
from ..schemas import (
    CashFlowOut,
    DebtPaymentBudgetOut,
    FinancialReportRequest,
    FinancialReportResponse,
    RecommendationOut,
)

router = APIRouter()
ZERO = Decimal("0.00")


def _recommendations(
    status: CashFlowStatus,
    has_debts: bool,
    is_affordable: bool,
    planned_extra: Decimal,
    unallocated: Decimal,
) -> list[RecommendationOut]:
    if status is CashFlowStatus.DEFICIT:
        return [
            RecommendationOut(
                code="close_shortfall",
                title="Close the monthly shortfall first",
                detail=(
                    "Your current income does not cover expenses and debt minimums. "
                    "Reduce an expense, add income, or contact creditors before "
                    "committing to accelerated payments."
                ),
            )
        ]

    if not has_debts:
        return [
            RecommendationOut(
                code="build_cash_reserve",
                title="Give the remaining cash a job",
                detail=(
                    "There is no debt to accelerate. Consider directing available "
                    "cash toward an emergency reserve or another savings goal."
                ),
            )
        ]

    recommendations: list[RecommendationOut] = []
    if not is_affordable:
        recommendations.append(
            RecommendationOut(
                code="reduce_extra_payment",
                title="Use the affordable payment instead",
                detail=(
                    "The requested extra payment exceeds this month's available "
                    "cash. The payoff comparison has been capped at the amount "
                    "your budget supports."
                ),
            )
        )

    if planned_extra > ZERO:
        recommendations.append(
            RecommendationOut(
                code="compare_strategies",
                title="Choose the tradeoff you can sustain",
                detail=(
                    "Avalanche usually minimizes interest; Snowball prioritizes an "
                    "earlier balance win. Both estimates use the affordable payment."
                ),
            )
        )
    else:
        recommendations.append(
            RecommendationOut(
                code="protect_minimums",
                title="Keep every minimum current",
                detail=(
                    "There is no extra cash assigned to debt today. Keep minimum "
                    "payments current and revisit the plan when cash flow improves."
                ),
            )
        )

    if unallocated > ZERO:
        recommendations.append(
            RecommendationOut(
                code="assign_remaining_surplus",
                title="Decide what the unassigned surplus should do",
                detail=(
                    "Some available monthly cash is not included in the payoff plan. "
                    "Keep it as a buffer or deliberately add it to the extra payment."
                ),
            )
        )
    return recommendations


@router.post("/financial-reports", response_model=FinancialReportResponse)
def create_financial_report(
    request: FinancialReportRequest,
) -> FinancialReportResponse:
    """Calculate affordability first, then simulate only a feasible plan."""
    debts = [
        Debt(
            id=row.id,
            name=row.name,
            balance=row.balance,
            apr=row.apr,
            minimum_payment=row.minimum_payment,
        )
        for row in request.debts
    ]
    cash_flow = analyze_cash_flow(
        [monthly_income_amount(row.amount, row.frequency) for row in request.incomes],
        [row.monthly_amount for row in request.expenses],
        [debt.minimum_payment for debt in debts],
    )
    allocation = allocate_extra_payment(
        request.requested_extra_monthly_payment, cash_flow
    )

    has_debts = any(debt.balance > ZERO for debt in debts)
    payoff_plan = None
    if cash_flow.status is not CashFlowStatus.DEFICIT and has_debts:
        payoff_plan = to_response(
            compute_plans(debts, allocation.planned_extra_payment),
            request.start_month,
        )

    return FinancialReportResponse(
        start_month=request.start_month,
        total_debt=to_cents(sum((debt.balance for debt in debts), ZERO)),
        cash_flow=CashFlowOut(
            total_monthly_income=cash_flow.total_monthly_income,
            total_monthly_expenses=cash_flow.total_monthly_expenses,
            total_minimum_debt_payments=cash_flow.total_minimum_debt_payments,
            available_monthly_cash_flow=cash_flow.available_monthly_cash_flow,
            shortfall=cash_flow.shortfall,
            maximum_affordable_extra_payment=(
                cash_flow.maximum_affordable_extra_payment
            ),
            status=cash_flow.status.value,
        ),
        debt_payment_budget=DebtPaymentBudgetOut(
            requested_extra_monthly_payment=allocation.requested_extra_payment,
            planned_extra_monthly_payment=allocation.planned_extra_payment,
            unallocated_cash_flow=allocation.unallocated_cash_flow,
            extra_payment_gap=allocation.extra_payment_gap,
            is_affordable=allocation.is_affordable,
        ),
        payoff_plan=payoff_plan,
        recommendations=_recommendations(
            cash_flow.status,
            has_debts,
            allocation.is_affordable,
            allocation.planned_extra_payment,
            allocation.unallocated_cash_flow,
        ),
        estimate_disclosure=(
            "Payoff figures are estimates using monthly interest before payment. "
            "Non-credit-card debts use the same simplified balance, APR, and "
            "minimum-payment model and may differ from lender schedules."
        ),
    )
