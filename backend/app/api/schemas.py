"""The published HTTP contract.

These models are written by hand rather than derived from the engine's
dataclasses. The two type sets are not duplication: they are an internal
representation and a published contract that happen to look alike today.
Coupling them would turn an engine field rename into a silent breaking API
change; keeping them apart makes such a rename show up as a diff in this file.
"""

from decimal import Decimal
from typing import Annotated, Any, Literal

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, model_validator

from app.cashflow import IncomeFrequency

from .dates import MONTH_PATTERN

DebtType = Literal[
    "credit_card",
    "auto_loan",
    "personal_loan",
    "student_loan",
    "medical_debt",
    "other",
]
ExpenseCategory = Literal[
    "housing",
    "food",
    "utilities",
    "transportation",
    "insurance",
    "healthcare",
    "childcare",
    "subscriptions",
    "personal",
    "other",
]


def _reject_json_numbers(value: Any) -> Any:
    """Refuse money that arrives as a JSON number.

    `JSON.parse("1234.56")` yields an IEEE-754 double and 1234.56 is not
    exactly representable, so accepting bare numbers would reintroduce floats
    at the boundary of an engine whose whole discipline is excluding them.

    `Decimal` is allowed through because it cannot come from JSON: parsing
    only ever produces `str`, `int`, or `float`. A `Decimal` here means the
    mapper is constructing a response from engine output, which is exactly
    the value we want and the direction this guard is not aimed at.
    """
    if isinstance(value, (str, Decimal)):
        return value
    raise ValueError('money must be a JSON string, e.g. "1234.56"')


# `json_schema_input_type=str` is load-bearing, not decoration. A
# BeforeValidator does not change the generated JSON schema on its own, so
# OpenAPI would advertise request-side money as `number | string` while this
# validator rejects numbers — and the frontend's types are generated from
# that schema, so the published contract would be a lie the compiler believes.
Money = Annotated[
    Decimal, BeforeValidator(_reject_json_numbers, json_schema_input_type=str)
]

# Keep extreme but valid Decimal inputs from overwhelming the simulator.
MONEY_MAX = Decimal("99999999.99")


MAX_DEBTS_PER_USER = 20


def _non_blank(value: Any) -> Any:
    """Strip names and reject blank or unsafe text."""
    if isinstance(value, str):
        if "\x00" in value:
            raise ValueError("must not contain NUL bytes")
        stripped = value.strip()
        if not stripped:
            raise ValueError("must not be blank")
        return stripped
    return value


NonBlankName = Annotated[
    str, BeforeValidator(_non_blank), Field(min_length=1, max_length=120)
]


class DebtIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=64)
    name: NonBlankName
    balance: Money = Field(ge=0, le=MONEY_MAX)
    apr: Money = Field(ge=0, le=Decimal("999.99"), decimal_places=2)
    minimum_payment: Money = Field(ge=0, le=MONEY_MAX)


class PayoffPlanRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    debts: list[DebtIn] = Field(max_length=MAX_DEBTS_PER_USER)
    extra_monthly_payment: Money = Field(ge=0, le=MONEY_MAX)
    start_month: str = Field(pattern=MONTH_PATTERN)


class DebtPayoffOut(BaseModel):
    debt_id: str
    name: str
    months_to_payoff: int
    payoff_month: str
    total_interest_paid: Money


class MonthlyTotalOut(BaseModel):
    # `month_number` rather than `index`: engine jargon stays out of the
    # published contract, and it pairs naturally with `month`.
    month_number: int
    month: str
    remaining_balance: Money
    cumulative_interest: Money


class ScenarioOut(BaseModel):
    strategy: Literal["snowball", "avalanche", "minimum_only"]
    outcome: Literal["paid_off", "never_pays_off"]
    months_to_payoff: int | None
    payoff_month: str | None
    underwater_debt_ids: list[str]
    total_interest_paid: Money
    total_paid: Money
    debt_payoffs: list[DebtPayoffOut]
    monthly_totals: list[MonthlyTotalOut]


class ScenariosOut(BaseModel):
    # Three named fields rather than dict[str, ScenarioOut]: OpenAPI would
    # type a dict as an open map, and the generated client would lose the
    # guarantee that exactly these three always exist.
    snowball: ScenarioOut
    avalanche: ScenarioOut
    baseline: ScenarioOut


class ComparisonOut(BaseModel):
    """Precomputed strategy differences; null when a plan never pays off."""

    interest_saved_snowball_vs_baseline: Money | None
    interest_saved_avalanche_vs_baseline: Money | None
    interest_saved_avalanche_vs_snowball: Money | None
    months_saved_snowball_vs_baseline: int | None
    months_saved_avalanche_vs_baseline: int | None
    months_saved_avalanche_vs_snowball: int | None


class PayoffPlanResponse(BaseModel):
    # start_month is echoed back so a stored or logged response is
    # self-describing: a payoff month can be read without the original request.
    start_month: str
    scenarios: ScenariosOut
    comparison: ComparisonOut


class IncomeIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=64)
    name: NonBlankName
    amount: Money = Field(ge=0, le=MONEY_MAX)
    frequency: IncomeFrequency = IncomeFrequency.MONTHLY


class ExpenseIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=64)
    name: NonBlankName
    category: ExpenseCategory
    monthly_amount: Money = Field(ge=0, le=MONEY_MAX)


class FinancialReportDebtIn(DebtIn):
    type: DebtType = "credit_card"


class FinancialReportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    incomes: list[IncomeIn] = Field(max_length=50)
    expenses: list[ExpenseIn] = Field(max_length=100)
    debts: list[FinancialReportDebtIn] = Field(max_length=MAX_DEBTS_PER_USER)
    requested_extra_monthly_payment: Money = Field(ge=0, le=MONEY_MAX)
    start_month: str = Field(pattern=MONTH_PATTERN)

    @model_validator(mode="after")
    def _unique_ids(self) -> "FinancialReportRequest":
        for label, rows in (
            ("income", self.incomes),
            ("expense", self.expenses),
            ("debt", self.debts),
        ):
            ids = [row.id for row in rows]
            if len(ids) != len(set(ids)):
                raise ValueError(f"duplicate {label} id")
        return self


class CashFlowOut(BaseModel):
    total_monthly_income: Money
    total_monthly_expenses: Money
    total_minimum_debt_payments: Money
    available_monthly_cash_flow: Money
    shortfall: Money
    maximum_affordable_extra_payment: Money
    status: Literal["deficit", "break_even", "surplus"]


class DebtPaymentBudgetOut(BaseModel):
    requested_extra_monthly_payment: Money
    planned_extra_monthly_payment: Money
    unallocated_cash_flow: Money
    extra_payment_gap: Money
    is_affordable: bool


class RecommendationOut(BaseModel):
    code: Literal[
        "close_shortfall",
        "protect_minimums",
        "reduce_extra_payment",
        "compare_strategies",
        "assign_remaining_surplus",
        "build_cash_reserve",
    ]
    title: str
    detail: str


class CompactOptionImpactOut(BaseModel):
    outcome: Literal["paid_off", "never_pays_off"]
    payoff_month: str | None
    months_to_payoff: int | None
    total_interest_paid: Money
    months_saved_vs_current: int | None
    interest_saved_vs_current: Money | None


class PayoffPaymentOptionOut(BaseModel):
    kind: Literal["current", "split_difference", "maximum"]
    extra_monthly_payment: Money
    additional_monthly_payment: Money
    monthly_cushion_remaining: Money
    snowball: CompactOptionImpactOut
    avalanche: CompactOptionImpactOut


class PayoffGuidanceOut(BaseModel):
    recommended_strategy: Literal["snowball", "avalanche"] | None
    payment_options: list[PayoffPaymentOptionOut]


class FinancialReportResponse(BaseModel):
    start_month: str
    total_debt: Money
    cash_flow: CashFlowOut
    debt_payment_budget: DebtPaymentBudgetOut
    payoff_plan: PayoffPlanResponse | None
    payoff_guidance: PayoffGuidanceOut | None
    recommendations: list[RecommendationOut]
    estimate_disclosure: str
