"""The published HTTP contract.

These models are written by hand rather than derived from the engine's
dataclasses. The two type sets are not duplication: they are an internal
representation and a published contract that happen to look alike today.
Coupling them would turn an engine field rename into a silent breaking API
change; keeping them apart makes such a rename show up as a diff in this file.
"""

from decimal import Decimal
from typing import Annotated, Any, Literal

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field

from .dates import MONTH_PATTERN


def _reject_non_string(value: Any) -> Any:
    """Refuse money that arrives as a JSON number.

    `JSON.parse("1234.56")` yields an IEEE-754 double and 1234.56 is not
    exactly representable, so accepting bare numbers would reintroduce floats
    at the boundary of an engine whose whole discipline is excluding them.
    """
    if not isinstance(value, str):
        raise ValueError('money must be a JSON string, e.g. "1234.56"')
    return value


Money = Annotated[Decimal, BeforeValidator(_reject_non_string)]


class DebtIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=120)
    balance: Money = Field(ge=0)
    apr: Money = Field(ge=0, le=Decimal("999.99"))
    minimum_payment: Money = Field(ge=0)


class PayoffPlanRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # The 50-debt cap is a denial-of-service bound, not a product limit:
    # 50 debts x 1200 months x 3 scenarios is roughly 180,000 iterations.
    debts: list[DebtIn] = Field(max_length=50)
    extra_monthly_payment: Money = Field(ge=0)
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


class DebtMonthOut(BaseModel):
    debt_id: str
    starting_balance: Money
    interest_charged: Money
    payment_applied: Money
    ending_balance: Money


class MonthOut(BaseModel):
    month_number: int
    month: str
    debts: list[DebtMonthOut]
    total_payment: Money
    total_interest: Money
    remaining_balance: Money


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
    schedule: list[MonthOut] | None


class ScenariosOut(BaseModel):
    # Three named fields rather than dict[str, ScenarioOut]: OpenAPI would
    # type a dict as an open map, and the generated client would lose the
    # guarantee that exactly these three always exist.
    snowball: ScenarioOut
    avalanche: ScenarioOut
    baseline: ScenarioOut


class ComparisonOut(BaseModel):
    """Every delta the AI layer is permitted to state.

    Nullable throughout, because you cannot subtract from a plan that never
    pays off. A delta omitted here is a delta the model would compute in
    prose, which is the exact failure the engine/AI split exists to prevent.
    """

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
