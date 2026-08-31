"""The published HTTP contract.

These models are written by hand rather than derived from the engine's
dataclasses. The two type sets are not duplication: they are an internal
representation and a published contract that happen to look alike today.
Coupling them would turn an engine field rename into a silent breaking API
change; keeping them apart makes such a rename show up as a diff in this file.
"""

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Annotated, Any, Literal

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, model_validator

from .dates import MONTH_PATTERN


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

# The ceiling on every money field. Without an upper bound a well-formed
# request like {"balance": "1e1000"} passes validation, reaches the engine,
# and raises decimal.InvalidOperation out of `to_cents` — not an InvalidDebt,
# so it escapes the handler as an unhandled 500. The value matches the
# eventual numeric(10,2) column exactly, the way `apr` matches numeric(5,2).
MONEY_MAX = Decimal("99999999.99")


class DebtIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=120)
    balance: Money = Field(ge=0, le=MONEY_MAX)
    apr: Money = Field(ge=0, le=Decimal("999.99"))
    minimum_payment: Money = Field(ge=0, le=MONEY_MAX)


class PayoffPlanRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # The 20-debt cap is a denial-of-service bound, not a product limit:
    # one measured 50-debt ?detail=full request produced a 16.7 MB body,
    # ~2.6s of CPU and 215 MB of peak RSS, on an endpoint with no auth.
    debts: list[DebtIn] = Field(max_length=20)
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
    # True only when `schedule` was requested and months were dropped to stay
    # under MAX_SCHEDULE_ROWS. A client that would otherwise read a short
    # schedule as a short plan needs to be told the difference.
    schedule_truncated: bool


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


MAX_DEBTS_PER_USER = 20


def _non_blank(value: Any) -> Any:
    """Strip, then require content.

    The column's CHECK is `length(trim(name)) between 1 and 120`. Pydantic's
    `min_length` alone accepts "   ", which passes validation and then
    violates the constraint as an unhandled IntegrityError -- a 500 from a
    well-formed request. Stripping here keeps the two layers agreeing on what
    "empty" means.
    """
    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            raise ValueError("must not be blank")
        return stripped
    return value


NonBlankName = Annotated[
    str, BeforeValidator(_non_blank), Field(min_length=1, max_length=120)
]


class DebtCreate(BaseModel):
    """A new debt.

    No `id` -- the database generates it -- and no `user_id`, which comes from
    the verified token and never from the body. Accepting `user_id` from a
    request body is how a caller writes into someone else's account.
    """

    model_config = ConfigDict(extra="forbid")

    name: NonBlankName
    type: str = Field(default="credit_card", min_length=1, max_length=40)
    balance: Money = Field(ge=0, le=Decimal("99999999.99"))
    apr: Money = Field(ge=0, le=Decimal("999.99"))
    minimum_payment: Money = Field(ge=0, le=Decimal("99999999.99"))


class DebtUpdate(BaseModel):
    """A partial update. Every field optional, but not all of them at once."""

    model_config = ConfigDict(extra="forbid")

    name: NonBlankName | None = None
    type: str | None = Field(default=None, min_length=1, max_length=40)
    balance: Money | None = Field(default=None, ge=0, le=Decimal("99999999.99"))
    apr: Money | None = Field(default=None, ge=0, le=Decimal("999.99"))
    minimum_payment: Money | None = Field(
        default=None, ge=0, le=Decimal("99999999.99")
    )

    @model_validator(mode="after")
    def _at_least_one_field(self) -> "DebtUpdate":
        if not self.model_dump(exclude_none=True):
            raise ValueError("at least one field must be supplied")
        return self


class DebtOut(BaseModel):
    """A stored debt on the wire.

    `id` is a UUID rather than a str: the database returns a UUID object and
    Pydantic does not coerce it to str, so typing it correctly here is what
    lets a row map straight onto this model. It still serializes to a JSON
    string, so the wire contract is unchanged.
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    type: str
    balance: Money
    apr: Money
    minimum_payment: Money
    created_at: datetime
    updated_at: datetime
