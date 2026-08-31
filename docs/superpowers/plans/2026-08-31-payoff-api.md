# Payoff Plan API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the debt engine over HTTP as a stateless `POST /v1/payoff-plans` endpoint returning all three scenarios plus the precomputed comparison.

**Architecture:** A thin FastAPI layer over the existing engine. The route validates, calls the engine, and maps — nothing else. Pydantic schemas are hand-written and a dedicated mapper converts engine dataclasses into them, so the published contract lives in a file whose only job is recording what was promised. Money crosses the wire as JSON strings; the client supplies the start month; the engine stays free of framework imports.

**Tech Stack:** Python 3.12, FastAPI, Pydantic v2, uvicorn. Dev-only: pytest, pytest-cov, hypothesis, httpx (for `TestClient`).

**Spec:** `docs/superpowers/specs/2026-08-31-payoff-api-design.md`

## Global Constraints

Every task's requirements implicitly include this section.

- Python 3.12 or newer. Money is always `Decimal`, never `float` — including in Pydantic constraints (`le=Decimal("999.99")`, never `le=999.99`).
- **Every monetary field on the wire is a JSON string.** Bare JSON numbers are rejected with a 422.
- No framework imports inside `backend/app/engine/` — that boundary is unchanged by this work. FastAPI and Pydantic exist only under `backend/app/api/`.
- All application routes sit under `/v1`. `GET /health` is the one exception and sits at the root.
- Route handlers are `def`, never `async def` — the engine is CPU-bound, and a plain `def` lets FastAPI run it in a threadpool.
- A portfolio that never pays off returns **200**, not an error status.
- `payoff_month` is non-null exactly when `months_to_payoff` is 1 or greater. Zero-month and never-pays-off scenarios both emit `null`.
- The word "index" never appears in a response field name; schedule rows use `month_number`.
- snake_case everywhere. No `# pragma: no cover`. Commit after every task.
- 100% line and branch coverage across `app` (raised from `app.engine` in the final task).

## Refinements to the Spec

Three things planning surfaced. Each is deliberate; none changes behavior the spec describes.

1. **The engine cannot currently serve `?detail=full`, and Task 1 fixes that.** `compute_plans()` returns a `PlanComparison` of three `PlanSummary` objects — and `PlanSummary` carries `monthly_totals` but *not* the per-debt month-by-month grid. That grid lives on `Schedule`, which `compute_plans` builds internally and then discards. The engine spec's "Output layering" section anticipated the API needing it, but no function exposes it.

   The fix keeps `compute_plans`'s signature and behavior exactly as they are, splitting its body into two reusable halves: `compute_schedules()` (run the three scenarios) and `summarize_schedules()` (fold them into a `PlanComparison`). The detail path calls both and keeps the schedules; the default path calls `compute_plans` as before. Either way the simulation runs three times, not six.

   Deliberately **not** done: adding schedules to `PlanComparison`. That object is handed wholesale to the AI layer, and a 340-row schedule is not a number the model may state.

2. **Request models set `extra="forbid"`.** Not in the spec. A client that sends `minimum` instead of `minimum_payment` should get a 422 naming the unknown field, not a silent default. Silently-ignored typos are among the worst API failure modes because they look like server bugs from the client side.

3. **`GET /health` sits at the root, not under `/v1`.** Health is about the process, not the API contract, and it should keep working across a future `/v2`.

## File Structure

```
backend/app/api/
  __init__.py
  main.py                 create_app(), CORS, exception handlers, GET /health
  schemas.py              Money type, request models, response models
  dates.py                YYYY-MM arithmetic — no engine, no framework imports
  mappers.py              PlanComparison (+ schedules) -> PayoffPlanResponse
  routers/
    __init__.py
    payoff_plans.py       POST /v1/payoff-plans
backend/tests/api/
  __init__.py  test_dates.py  test_schemas.py  test_mappers.py
  test_routes.py  test_contract.py
```

Dependency direction, one-way:

```
dates  ->  schemas  ->  mappers  ->  routers  ->  main
                 (engine feeds mappers and routers; engine imports none of this)
```

---

### Task 1: Expose the engine's schedules

**Files:**
- Modify: `backend/app/engine/plans.py`
- Modify: `backend/app/engine/__init__.py`
- Test: `backend/tests/engine/test_plans.py` (append)

**Interfaces:**
- Consumes: `simulate`, `summarize`, both orderings, both minimum rules, `Strategy`, `Schedule`, `PlanComparison`, `ZERO`.
- Produces: `compute_schedules(debts, extra_payment) -> dict[Strategy, Schedule]`; `summarize_schedules(schedules, debts) -> PlanComparison`; `compute_plans` unchanged in signature and behavior.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/engine/test_plans.py`:

```python
from app.engine.models import Schedule
from app.engine.plans import compute_schedules, summarize_schedules


def test_compute_schedules_returns_one_schedule_per_strategy():
    debts = [debt("a", "500.00", "5.00", "25.00"), debt("b", "2000.00", "25.00", "50.00")]
    schedules = compute_schedules(debts, Decimal("200.00"))
    assert set(schedules) == {Strategy.SNOWBALL, Strategy.AVALANCHE, Strategy.MINIMUM_ONLY}
    for schedule in schedules.values():
        assert isinstance(schedule, Schedule)


def test_schedules_carry_the_per_debt_grid_that_summaries_drop():
    # This is the whole point: PlanSummary has monthly_totals but no per-debt
    # rows, so ?detail=full cannot be served from compute_plans alone.
    debts = [debt("a", "100.00", "12.00", "50.00")]
    schedules = compute_schedules(debts, ZERO)
    first_month = schedules[Strategy.AVALANCHE].months[0]
    assert first_month.debts[0].debt_id == "a"
    assert first_month.debts[0].interest_charged == Decimal("1.00")


def test_summarize_schedules_reproduces_compute_plans_exactly():
    debts = [debt("a", "500.00", "5.00", "25.00"), debt("b", "2000.00", "25.00", "50.00")]
    extra = Decimal("200.00")
    assert summarize_schedules(compute_schedules(debts, extra), debts) == compute_plans(debts, extra)


def test_baseline_schedule_ignores_the_extra_payment():
    debts = [debt("a", "1000.00", "12.00", "100.00")]
    with_extra = compute_schedules(debts, Decimal("900.00"))[Strategy.MINIMUM_ONLY]
    without = compute_schedules(debts, ZERO)[Strategy.MINIMUM_ONLY]
    assert len(with_extra.months) == len(without.months)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/engine/test_plans.py -v -k "schedules"`
Expected: FAIL — `ImportError: cannot import name 'compute_schedules' from 'app.engine.plans'`

- [ ] **Step 3: Refactor `compute_plans` in `backend/app/engine/plans.py`**

Replace the existing `compute_plans` function with these three. Its signature and behavior do not change; its body is split so the schedules can be reused.

```python
def compute_schedules(
    debts: Sequence[Debt], extra_payment: Decimal
) -> dict[Strategy, Schedule]:
    """Run all three scenarios and keep the full schedules.

    The scenario configuration lives here and nowhere else, so a caller that
    needs the per-debt grid cannot drift from one that only needs summaries.
    """
    return {
        Strategy.SNOWBALL: simulate(
            debts, extra_payment, snowball_order, fixed_minimum
        ),
        Strategy.AVALANCHE: simulate(
            debts, extra_payment, avalanche_order, fixed_minimum
        ),
        # The baseline takes no extra payment and does not roll over freed
        # minimums: "do nothing differently" means that money is spent elsewhere.
        Strategy.MINIMUM_ONLY: simulate(
            debts, ZERO, snowball_order, declining_minimum, rollover=False
        ),
    }


def summarize_schedules(
    schedules: dict[Strategy, Schedule], debts: Sequence[Debt]
) -> PlanComparison:
    """Fold three schedules into the comparison object."""
    snowball = summarize(schedules[Strategy.SNOWBALL], debts, Strategy.SNOWBALL)
    avalanche = summarize(schedules[Strategy.AVALANCHE], debts, Strategy.AVALANCHE)
    baseline = summarize(schedules[Strategy.MINIMUM_ONLY], debts, Strategy.MINIMUM_ONLY)

    return PlanComparison(
        snowball=snowball,
        avalanche=avalanche,
        baseline=baseline,
        interest_saved_snowball_vs_baseline=_interest_delta(baseline, snowball),
        interest_saved_avalanche_vs_baseline=_interest_delta(baseline, avalanche),
        interest_saved_avalanche_vs_snowball=_interest_delta(snowball, avalanche),
        months_saved_snowball_vs_baseline=_months_delta(baseline, snowball),
        months_saved_avalanche_vs_baseline=_months_delta(baseline, avalanche),
        months_saved_avalanche_vs_snowball=_months_delta(snowball, avalanche),
    )


def compute_plans(debts: Sequence[Debt], extra_payment: Decimal) -> PlanComparison:
    """Run all three scenarios and precompute every comparison.

    The deltas exist so the AI layer never performs arithmetic: every number
    that could appear in a generated sentence is already a field here.
    """
    return summarize_schedules(compute_schedules(debts, extra_payment), debts)
```

Add `Schedule` to the `from .models import (...)` block at the top of the file.

- [ ] **Step 4: Export the new functions**

In `backend/app/engine/__init__.py`, change the plans import and `__all__`:

```python
from .plans import compute_plans, compute_schedules, summarize, summarize_schedules
```

and add `"compute_schedules"` and `"summarize_schedules"` to `__all__`, keeping it alphabetically sorted.

- [ ] **Step 5: Run the full engine suite**

Run: `cd backend && .venv/bin/pytest tests/engine -q`
Expected: PASS, 113 tests (109 existing + 4 new), coverage still 100%

- [ ] **Step 6: Commit**

```bash
git add backend/app/engine/plans.py backend/app/engine/__init__.py backend/tests/engine/test_plans.py
git commit -m "feat(engine): expose the three scenario schedules for detailed API responses"
```

---

### Task 2: API package, dependencies, and date arithmetic

**Files:**
- Modify: `backend/pyproject.toml`
- Create: `backend/app/api/__init__.py`, `backend/app/api/routers/__init__.py`, `backend/tests/api/__init__.py`
- Create: `backend/app/api/dates.py`
- Test: `backend/tests/api/test_dates.py`

**Interfaces:**
- Consumes: nothing — `dates.py` imports neither the engine nor a framework.
- Produces: `parse_month(value: str) -> tuple[int, int]`; `shift_month(year: int, month: int, offset: int) -> tuple[int, int]`; `month_label(start_month: str, index: int) -> str`; `MONTH_PATTERN: str`.

- [ ] **Step 1: Add dependencies to `backend/pyproject.toml`**

Replace the `dependencies` and `optional-dependencies` blocks:

```toml
dependencies = ["fastapi>=0.115", "uvicorn[standard]>=0.32"]

[project.optional-dependencies]
dev = ["pytest>=8.0", "pytest-cov>=5.0", "hypothesis>=6.100", "httpx>=0.27"]
```

`httpx` is what FastAPI's `TestClient` runs on. Leave the pytest and coverage config alone — the gate moves to `app` in Task 11.

- [ ] **Step 2: Install and create the package skeleton**

```bash
cd backend && .venv/bin/pip install -e ".[dev]"
mkdir -p app/api/routers tests/api
touch app/api/__init__.py app/api/routers/__init__.py tests/api/__init__.py
```

- [ ] **Step 3: Write the failing test**

Create `backend/tests/api/test_dates.py`:

```python
import pytest

from app.api.dates import month_label, parse_month, shift_month


def test_parse_month_splits_year_and_month():
    assert parse_month("2026-09") == (2026, 9)


@pytest.mark.parametrize("bad", ["2026-13", "2026-00", "26-09", "2026-9", "", "2026/09", "not-a-month"])
def test_parse_month_rejects_malformed_input(bad):
    with pytest.raises(ValueError):
        parse_month(bad)


def test_shift_month_by_zero_is_identity():
    assert shift_month(2026, 9, 0) == (2026, 9)


def test_shift_month_crosses_the_year_boundary():
    assert shift_month(2026, 12, 1) == (2027, 1)


def test_shift_month_does_not_roll_over_early():
    assert shift_month(2026, 1, 11) == (2026, 12)


def test_shift_month_handles_multi_year_offsets():
    assert shift_month(2026, 9, 25) == (2028, 10)


def test_month_one_is_the_start_month():
    # Month 1 is the first month a payment is made — the start month itself.
    assert month_label("2026-09", 1) == "2026-09"


def test_month_label_crosses_the_year_boundary():
    assert month_label("2026-12", 2) == "2027-01"


def test_month_label_no_premature_rollover():
    assert month_label("2026-01", 12) == "2026-12"


def test_month_label_at_the_simulation_cap():
    # 1200 months is the engine's MAX_MONTHS: a century out, still plain ints.
    assert month_label("2026-09", 1200) == "2126-08"


def test_fourteen_months_from_september():
    assert month_label("2026-09", 14) == "2027-10"


def test_month_label_pads_single_digit_months():
    assert month_label("2026-09", 5) == "2027-01"


def test_month_label_round_trips_at_index_one():
    for label in ("2026-01", "2026-12", "2030-07", "2199-11"):
        assert month_label(label, 1) == label
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/api/test_dates.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.api.dates'`

- [ ] **Step 5: Write the implementation**

Create `backend/app/api/dates.py`:

```python
"""Calendar month arithmetic for the API boundary.

The engine speaks only in 1-based month indices, which keeps it a pure
function with no hidden clock. Turning those indices into calendar months is
this module's entire job.

Because the engine has no concept of days, this is pure integer arithmetic —
no leap years, no "January 31st plus one month", no daylight saving, no
timezones. Working in an absolute month count also removes the year rollover
as a special case, which is where date arithmetic usually breaks.
"""

import re

MONTH_PATTERN = r"^\d{4}-(0[1-9]|1[0-2])$"

_MONTH_RE = re.compile(MONTH_PATTERN)
_MONTHS_PER_YEAR = 12


def parse_month(value: str) -> tuple[int, int]:
    """Parse "2026-09" into (2026, 9). Raises ValueError on anything else."""
    if not _MONTH_RE.match(value):
        raise ValueError(f"expected a YYYY-MM month, got {value!r}")
    year, month = value.split("-")
    return int(year), int(month)


def shift_month(year: int, month: int, offset: int) -> tuple[int, int]:
    """Move (year, month) by `offset` months, forward or back."""
    total = year * _MONTHS_PER_YEAR + (month - 1) + offset
    return total // _MONTHS_PER_YEAR, total % _MONTHS_PER_YEAR + 1


def month_label(start_month: str, index: int) -> str:
    """Calendar label for the 1-based month `index`.

    Month 1 IS ``start_month`` — the first month a payment is made — so the
    offset is ``index - 1``. Callers must not pass an index below 1: a
    zero-month or never-paying-off scenario has no payoff month, and the
    mapper emits null for those rather than asking this function to invent one.
    """
    year, month = shift_month(*parse_month(start_month), index - 1)
    return f"{year:04d}-{month:02d}"
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd backend && .venv/bin/pytest tests/api/test_dates.py -v`
Expected: PASS, 18 tests

- [ ] **Step 7: Commit**

```bash
git add backend/pyproject.toml backend/app/api backend/tests/api
git commit -m "feat(api): add FastAPI dependencies and calendar month arithmetic"
```

---

### Task 3: The Money type and request schemas

**Files:**
- Create: `backend/app/api/schemas.py`
- Test: `backend/tests/api/test_schemas.py`

**Interfaces:**
- Consumes: `MONTH_PATTERN` from Task 2.
- Produces: `Money` (annotated `Decimal`); `DebtIn`; `PayoffPlanRequest` with fields `debts`, `extra_monthly_payment`, `start_month`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/api/test_schemas.py`:

```python
from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.api.schemas import DebtIn, PayoffPlanRequest


def debt_payload(**overrides) -> dict:
    payload = {
        "id": "card-a",
        "name": "Visa",
        "balance": "1000.00",
        "apr": "24.99",
        "minimum_payment": "50.00",
    }
    payload.update(overrides)
    return payload


def request_payload(**overrides) -> dict:
    payload = {
        "debts": [debt_payload()],
        "extra_monthly_payment": "200.00",
        "start_month": "2026-09",
    }
    payload.update(overrides)
    return payload


def test_money_strings_parse_to_decimal():
    debt = DebtIn(**debt_payload())
    assert debt.balance == Decimal("1000.00")
    assert debt.apr == Decimal("24.99")


def test_money_as_a_json_number_is_rejected():
    # JSON has no decimal type: 1234.56 arrives as an IEEE-754 double, which
    # would reintroduce floats at the boundary of a Decimal-only engine.
    with pytest.raises(ValidationError, match="JSON string"):
        DebtIn(**debt_payload(balance=1000.00))


def test_money_as_an_integer_is_also_rejected():
    with pytest.raises(ValidationError, match="JSON string"):
        DebtIn(**debt_payload(balance=1000))


def test_negative_balance_is_rejected():
    with pytest.raises(ValidationError):
        DebtIn(**debt_payload(balance="-1.00"))


def test_negative_minimum_is_rejected():
    with pytest.raises(ValidationError):
        DebtIn(**debt_payload(minimum_payment="-1.00"))


def test_apr_above_the_numeric_5_2_ceiling_is_rejected():
    with pytest.raises(ValidationError):
        DebtIn(**debt_payload(apr="1000.00"))


def test_empty_id_is_rejected():
    with pytest.raises(ValidationError):
        DebtIn(**debt_payload(id=""))


def test_unknown_field_is_rejected():
    # A client sending "minimum" instead of "minimum_payment" must be told,
    # not silently defaulted.
    with pytest.raises(ValidationError):
        DebtIn(**debt_payload(minimum="50.00"))


def test_valid_request_parses():
    request = PayoffPlanRequest(**request_payload())
    assert request.start_month == "2026-09"
    assert request.extra_monthly_payment == Decimal("200.00")
    assert len(request.debts) == 1


def test_empty_debt_list_is_valid():
    # "No debts yet" is the normal state of a new account, not an error.
    assert PayoffPlanRequest(**request_payload(debts=[])).debts == []


def test_more_than_fifty_debts_is_rejected():
    with pytest.raises(ValidationError):
        PayoffPlanRequest(**request_payload(debts=[debt_payload(id=f"d{i}") for i in range(51)]))


def test_exactly_fifty_debts_is_allowed():
    request = PayoffPlanRequest(**request_payload(debts=[debt_payload(id=f"d{i}") for i in range(50)]))
    assert len(request.debts) == 50


@pytest.mark.parametrize("bad", ["2026-13", "26-09", "2026-9", "2026-09-14", ""])
def test_malformed_start_month_is_rejected(bad):
    with pytest.raises(ValidationError):
        PayoffPlanRequest(**request_payload(start_month=bad))


def test_negative_extra_payment_is_rejected():
    with pytest.raises(ValidationError):
        PayoffPlanRequest(**request_payload(extra_monthly_payment="-1.00"))
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/api/test_schemas.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.api.schemas'`

- [ ] **Step 3: Write the implementation**

Create `backend/app/api/schemas.py`:

```python
"""The published HTTP contract.

These models are written by hand rather than derived from the engine's
dataclasses. The two type sets are not duplication: they are an internal
representation and a published contract that happen to look alike today.
Coupling them would turn an engine field rename into a silent breaking API
change; keeping them apart makes such a rename show up as a diff in this file.
"""

from decimal import Decimal
from typing import Annotated, Any

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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && .venv/bin/pytest tests/api/test_schemas.py -v`
Expected: PASS, 18 tests

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/schemas.py backend/tests/api/test_schemas.py
git commit -m "feat(api): add string-only Money type and request schemas"
```

---

### Task 4: Response schemas

**Files:**
- Modify: `backend/app/api/schemas.py` (append)
- Test: `backend/tests/api/test_schemas.py` (append)

**Interfaces:**
- Consumes: `Money` from Task 3.
- Produces: `DebtPayoffOut`, `MonthlyTotalOut`, `DebtMonthOut`, `MonthOut`, `ScenarioOut`, `ScenariosOut`, `ComparisonOut`, `PayoffPlanResponse`.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/api/test_schemas.py`:

```python
import json

from app.api.schemas import ComparisonOut, PayoffPlanResponse, ScenarioOut, ScenariosOut


def scenario_payload(strategy="avalanche", **overrides) -> dict:
    payload = {
        "strategy": strategy,
        "outcome": "paid_off",
        "months_to_payoff": 14,
        "payoff_month": "2027-10",
        "underwater_debt_ids": [],
        "total_interest_paid": "412.88",
        "total_paid": "2912.88",
        "debt_payoffs": [
            {
                "debt_id": "card-a",
                "name": "Visa",
                "months_to_payoff": 9,
                "payoff_month": "2027-05",
                "total_interest_paid": "298.14",
            }
        ],
        "monthly_totals": [
            {
                "month_number": 1,
                "month": "2026-09",
                "remaining_balance": "2371.50",
                "cumulative_interest": "43.20",
            }
        ],
        "schedule": None,
    }
    payload.update(overrides)
    return payload


def test_scenario_parses_and_keeps_decimals():
    scenario = ScenarioOut(**scenario_payload())
    assert scenario.total_interest_paid == Decimal("412.88")
    assert scenario.debt_payoffs[0].months_to_payoff == 9


def test_never_pays_off_allows_null_months_and_month():
    scenario = ScenarioOut(
        **scenario_payload(
            outcome="never_pays_off",
            months_to_payoff=None,
            payoff_month=None,
            underwater_debt_ids=["card-a"],
            debt_payoffs=[],
        )
    )
    assert scenario.months_to_payoff is None
    assert scenario.payoff_month is None


def test_unknown_strategy_is_rejected():
    with pytest.raises(ValidationError):
        ScenarioOut(**scenario_payload(strategy="debt_lasso"))


def test_comparison_allows_null_deltas():
    comparison = ComparisonOut(
        interest_saved_snowball_vs_baseline=None,
        interest_saved_avalanche_vs_baseline=None,
        interest_saved_avalanche_vs_snowball="37.41",
        months_saved_snowball_vs_baseline=None,
        months_saved_avalanche_vs_baseline=None,
        months_saved_avalanche_vs_snowball=0,
    )
    assert comparison.interest_saved_avalanche_vs_baseline is None
    assert comparison.months_saved_avalanche_vs_snowball == 0


def test_money_serializes_back_out_as_a_json_string():
    # The contract is symmetric: strings in, strings out. If Pydantic ever
    # emitted a bare number here, every JS client would silently get a float.
    response = PayoffPlanResponse(
        start_month="2026-09",
        scenarios=ScenariosOut(
            snowball=ScenarioOut(**scenario_payload("snowball")),
            avalanche=ScenarioOut(**scenario_payload("avalanche")),
            baseline=ScenarioOut(**scenario_payload("minimum_only")),
        ),
        comparison=ComparisonOut(
            interest_saved_snowball_vs_baseline="1.00",
            interest_saved_avalanche_vs_baseline="2.00",
            interest_saved_avalanche_vs_snowball="3.00",
            months_saved_snowball_vs_baseline=1,
            months_saved_avalanche_vs_baseline=2,
            months_saved_avalanche_vs_snowball=3,
        ),
    )
    body = json.loads(response.model_dump_json())
    assert body["scenarios"]["avalanche"]["total_interest_paid"] == "412.88"
    assert body["comparison"]["interest_saved_avalanche_vs_snowball"] == "3.00"
    assert body["start_month"] == "2026-09"


def test_scenarios_requires_all_three():
    with pytest.raises(ValidationError):
        ScenariosOut(snowball=ScenarioOut(**scenario_payload("snowball")))
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/api/test_schemas.py -v -k "scenario or comparison or serializes"`
Expected: FAIL — `ImportError: cannot import name 'ScenarioOut' from 'app.api.schemas'`

- [ ] **Step 3: Append the response models to `backend/app/api/schemas.py`**

Add `Literal` to the `typing` import at the top of the file, then append:

```python
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
```

Note the response models deliberately do **not** set `extra="forbid"` — that constraint is about rejecting client input, and these are only ever constructed by the mapper.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && .venv/bin/pytest tests/api/test_schemas.py -v`
Expected: PASS, 24 tests

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/schemas.py backend/tests/api/test_schemas.py
git commit -m "feat(api): add response schemas for scenarios and comparison"
```

---

### Task 5: The mapper — summaries to response

**Files:**
- Create: `backend/app/api/mappers.py`
- Test: `backend/tests/api/test_mappers.py`

**Interfaces:**
- Consumes: `month_label` (Task 2); all response models (Task 4); `PlanComparison`, `PlanSummary`, `Schedule`, `Strategy` from the engine.
- Produces: `to_response(comparison, start_month, schedules=None) -> PayoffPlanResponse`.

This task maps everything except the `detail=full` schedule, which Task 6 adds. `to_response` already accepts the `schedules` argument here and ignores nothing else — it simply passes `None` through to `schedule` for now.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/api/test_mappers.py`:

```python
from decimal import Decimal

from app.api.mappers import to_response
from app.engine import Debt, compute_plans


def debt(id_, balance, apr, minimum) -> Debt:
    return Debt(
        id=id_,
        name=f"Card {id_}",
        balance=Decimal(balance),
        apr=Decimal(apr),
        minimum_payment=Decimal(minimum),
    )


PORTFOLIO = [debt("a", "500.00", "5.00", "25.00"), debt("b", "2000.00", "25.00", "50.00")]


def test_start_month_is_echoed_back():
    response = to_response(compute_plans(PORTFOLIO, Decimal("200.00")), "2026-09")
    assert response.start_month == "2026-09"


def test_all_three_scenarios_are_present_and_labelled():
    response = to_response(compute_plans(PORTFOLIO, Decimal("200.00")), "2026-09")
    assert response.scenarios.snowball.strategy == "snowball"
    assert response.scenarios.avalanche.strategy == "avalanche"
    assert response.scenarios.baseline.strategy == "minimum_only"


def test_totals_are_copied_verbatim_from_the_engine():
    comparison = compute_plans(PORTFOLIO, Decimal("200.00"))
    response = to_response(comparison, "2026-09")
    assert response.scenarios.avalanche.total_interest_paid == comparison.avalanche.total_interest_paid
    assert response.scenarios.avalanche.total_paid == comparison.avalanche.total_paid
    assert response.scenarios.avalanche.months_to_payoff == comparison.avalanche.months_to_payoff


def test_payoff_month_is_the_start_month_shifted_by_the_term():
    comparison = compute_plans(PORTFOLIO, Decimal("200.00"))
    response = to_response(comparison, "2026-09")
    months = comparison.avalanche.months_to_payoff
    from app.api.dates import month_label
    assert response.scenarios.avalanche.payoff_month == month_label("2026-09", months)


def test_debt_payoffs_carry_both_the_count_and_the_calendar_month():
    response = to_response(compute_plans(PORTFOLIO, Decimal("200.00")), "2026-09")
    payoff = response.scenarios.snowball.debt_payoffs[0]
    assert payoff.debt_id == "a"
    assert payoff.name == "Card a"
    assert payoff.months_to_payoff >= 1
    assert payoff.payoff_month.startswith("202")


def test_monthly_totals_get_calendar_months_alongside_numbers():
    response = to_response(compute_plans(PORTFOLIO, Decimal("200.00")), "2026-09")
    first = response.scenarios.avalanche.monthly_totals[0]
    assert first.month_number == 1
    assert first.month == "2026-09"


def test_comparison_deltas_are_copied_verbatim():
    comparison = compute_plans(PORTFOLIO, Decimal("200.00"))
    response = to_response(comparison, "2026-09")
    assert (
        response.comparison.interest_saved_avalanche_vs_snowball
        == comparison.interest_saved_avalanche_vs_snowball
    )
    assert (
        response.comparison.months_saved_avalanche_vs_baseline
        == comparison.months_saved_avalanche_vs_baseline
    )


def test_never_pays_off_scenario_has_null_month_and_underwater_ids():
    # Implied minimum of 1% against a 2% monthly rate: the baseline is
    # underwater, while a large extra payment still clears the strategies.
    comparison = compute_plans([debt("a", "10000.00", "24.00", "100.00")], Decimal("3000.00"))
    response = to_response(comparison, "2026-09")
    baseline = response.scenarios.baseline
    assert baseline.outcome == "never_pays_off"
    assert baseline.months_to_payoff is None
    assert baseline.payoff_month is None
    assert baseline.underwater_debt_ids == ["a"]
    assert response.comparison.interest_saved_avalanche_vs_baseline is None


def test_zero_month_scenario_has_a_null_payoff_month():
    # An empty portfolio pays off in zero months. month_label(start, 0) would
    # name the month BEFORE the start month, so the mapper must emit null.
    response = to_response(compute_plans([], Decimal("100.00")), "2026-09")
    assert response.scenarios.avalanche.months_to_payoff == 0
    assert response.scenarios.avalanche.payoff_month is None
    assert response.scenarios.avalanche.monthly_totals == []


def test_schedule_is_null_when_no_schedules_are_supplied():
    response = to_response(compute_plans(PORTFOLIO, Decimal("200.00")), "2026-09")
    assert response.scenarios.avalanche.schedule is None
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/api/test_mappers.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.api.mappers'`

- [ ] **Step 3: Write the implementation**

Create `backend/app/api/mappers.py`:

```python
"""Engine dataclasses to published response models.

This is the one place the internal representation meets the public contract,
which is why the conversion is written out rather than derived: an engine
field rename must surface here as a reviewable diff, not as a silent change
to what clients receive.
"""

from app.engine import PlanComparison, PlanSummary, Schedule, Strategy

from .dates import month_label
from .schemas import (
    ComparisonOut,
    DebtPayoffOut,
    MonthlyTotalOut,
    PayoffPlanResponse,
    ScenarioOut,
    ScenariosOut,
)


def _payoff_month(months_to_payoff: int | None, start_month: str) -> str | None:
    """Calendar month a plan finishes in, or None when it never does.

    Non-null exactly when the term is one month or more. A never-paying-off
    plan has no end, and a zero-month plan (an empty portfolio) never began —
    asking for month 0 would name the month before `start_month`.
    """
    if months_to_payoff is None or months_to_payoff < 1:
        return None
    return month_label(start_month, months_to_payoff)


def _scenario(
    summary: PlanSummary, start_month: str, schedule: Schedule | None
) -> ScenarioOut:
    return ScenarioOut(
        strategy=summary.strategy.value,
        outcome=summary.outcome.value,
        months_to_payoff=summary.months_to_payoff,
        payoff_month=_payoff_month(summary.months_to_payoff, start_month),
        underwater_debt_ids=list(summary.underwater_debt_ids),
        total_interest_paid=summary.total_interest_paid,
        total_paid=summary.total_paid,
        debt_payoffs=[
            DebtPayoffOut(
                debt_id=payoff.debt_id,
                name=payoff.name,
                months_to_payoff=payoff.payoff_month,
                payoff_month=month_label(start_month, payoff.payoff_month),
                total_interest_paid=payoff.total_interest_paid,
            )
            for payoff in summary.debt_payoffs
        ],
        monthly_totals=[
            MonthlyTotalOut(
                month_number=total.index,
                month=month_label(start_month, total.index),
                remaining_balance=total.remaining_balance,
                cumulative_interest=total.cumulative_interest,
            )
            for total in summary.monthly_totals
        ],
        schedule=None,
    )


def to_response(
    comparison: PlanComparison,
    start_month: str,
    schedules: dict[Strategy, Schedule] | None = None,
) -> PayoffPlanResponse:
    """Build the wire response. Pass `schedules` to populate detail=full."""
    return PayoffPlanResponse(
        start_month=start_month,
        scenarios=ScenariosOut(
            snowball=_scenario(comparison.snowball, start_month, None),
            avalanche=_scenario(comparison.avalanche, start_month, None),
            baseline=_scenario(comparison.baseline, start_month, None),
        ),
        comparison=ComparisonOut(
            interest_saved_snowball_vs_baseline=comparison.interest_saved_snowball_vs_baseline,
            interest_saved_avalanche_vs_baseline=comparison.interest_saved_avalanche_vs_baseline,
            interest_saved_avalanche_vs_snowball=comparison.interest_saved_avalanche_vs_snowball,
            months_saved_snowball_vs_baseline=comparison.months_saved_snowball_vs_baseline,
            months_saved_avalanche_vs_baseline=comparison.months_saved_avalanche_vs_baseline,
            months_saved_avalanche_vs_snowball=comparison.months_saved_avalanche_vs_snowball,
        ),
    )
```

Note `payoff.payoff_month` on the engine's `DebtPayoff` is an integer month index; it becomes the response's `months_to_payoff`, and the calendar label goes in the response's `payoff_month`. That rename is exactly why this mapper is written by hand.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && .venv/bin/pytest tests/api/test_mappers.py -v`
Expected: PASS, 10 tests

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/mappers.py backend/tests/api/test_mappers.py
git commit -m "feat(api): map engine comparisons onto the response contract"
```

---

### Task 6: The mapper — detailed schedules

**Files:**
- Modify: `backend/app/api/mappers.py`
- Test: `backend/tests/api/test_mappers.py` (append)

**Interfaces:**
- Consumes: everything from Task 5, plus `DebtMonthOut` and `MonthOut` from Task 4.
- Produces: no signature change. `to_response(..., schedules=...)` now populates each scenario's `schedule`.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/api/test_mappers.py`:

```python
from app.engine import Strategy, compute_schedules, summarize_schedules


def test_schedules_populate_the_per_debt_grid():
    schedules = compute_schedules(PORTFOLIO, Decimal("200.00"))
    comparison = summarize_schedules(schedules, PORTFOLIO)
    response = to_response(comparison, "2026-09", schedules)

    schedule = response.scenarios.avalanche.schedule
    assert schedule is not None
    assert len(schedule) == comparison.avalanche.months_to_payoff

    first = schedule[0]
    assert first.month_number == 1
    assert first.month == "2026-09"
    assert {row.debt_id for row in first.debts} == {"a", "b"}


def test_schedule_rows_copy_engine_values_verbatim():
    schedules = compute_schedules(PORTFOLIO, Decimal("200.00"))
    comparison = summarize_schedules(schedules, PORTFOLIO)
    response = to_response(comparison, "2026-09", schedules)

    engine_row = schedules[Strategy.AVALANCHE].months[0].debts[0]
    wire_row = next(
        row for row in response.scenarios.avalanche.schedule[0].debts
        if row.debt_id == engine_row.debt_id
    )
    assert wire_row.starting_balance == engine_row.starting_balance
    assert wire_row.interest_charged == engine_row.interest_charged
    assert wire_row.payment_applied == engine_row.payment_applied
    assert wire_row.ending_balance == engine_row.ending_balance


def test_every_scenario_gets_its_own_schedule():
    schedules = compute_schedules(PORTFOLIO, Decimal("200.00"))
    comparison = summarize_schedules(schedules, PORTFOLIO)
    response = to_response(comparison, "2026-09", schedules)
    for scenario in (response.scenarios.snowball, response.scenarios.avalanche, response.scenarios.baseline):
        assert scenario.schedule is not None
        assert len(scenario.schedule) >= 1


def test_schedule_months_run_consecutively_from_the_start_month():
    schedules = compute_schedules(PORTFOLIO, Decimal("200.00"))
    comparison = summarize_schedules(schedules, PORTFOLIO)
    response = to_response(comparison, "2026-12", schedules)
    schedule = response.scenarios.avalanche.schedule
    assert schedule[0].month == "2026-12"
    assert schedule[1].month == "2027-01"


def test_empty_portfolio_with_schedules_has_empty_schedule_lists():
    schedules = compute_schedules([], Decimal("100.00"))
    comparison = summarize_schedules(schedules, [])
    response = to_response(comparison, "2026-09", schedules)
    assert response.scenarios.avalanche.schedule == []
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/api/test_mappers.py -v -k "schedule"`
Expected: FAIL — `test_schedules_populate_the_per_debt_grid` asserts a schedule but gets `None`.

- [ ] **Step 3: Add schedule mapping to `backend/app/api/mappers.py`**

Add `DebtMonthOut` and `MonthOut` to the `.schemas` import, then add this helper above `_scenario`:

```python
def _schedule(schedule: Schedule | None, start_month: str) -> list[MonthOut] | None:
    """The per-debt month-by-month grid, or None when detail was not requested."""
    if schedule is None:
        return None
    return [
        MonthOut(
            month_number=month.index,
            month=month_label(start_month, month.index),
            debts=[
                DebtMonthOut(
                    debt_id=row.debt_id,
                    starting_balance=row.starting_balance,
                    interest_charged=row.interest_charged,
                    payment_applied=row.payment_applied,
                    ending_balance=row.ending_balance,
                )
                for row in month.debts
            ],
            total_payment=month.total_payment,
            total_interest=month.total_interest,
            remaining_balance=month.remaining_balance,
        )
        for month in schedule.months
    ]
```

Change `_scenario`'s last field from `schedule=None` to:

```python
        schedule=_schedule(schedule, start_month),
```

And in `to_response`, pass each scenario its schedule:

```python
        scenarios=ScenariosOut(
            snowball=_scenario(
                comparison.snowball, start_month,
                None if schedules is None else schedules[Strategy.SNOWBALL],
            ),
            avalanche=_scenario(
                comparison.avalanche, start_month,
                None if schedules is None else schedules[Strategy.AVALANCHE],
            ),
            baseline=_scenario(
                comparison.baseline, start_month,
                None if schedules is None else schedules[Strategy.MINIMUM_ONLY],
            ),
        ),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && .venv/bin/pytest tests/api/test_mappers.py -v`
Expected: PASS, 15 tests

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/mappers.py backend/tests/api/test_mappers.py
git commit -m "feat(api): map per-debt schedules for detailed responses"
```

---

### Task 7: The application factory

**Files:**
- Create: `backend/app/api/main.py`
- Test: `backend/tests/api/test_routes.py`

**Interfaces:**
- Consumes: `InvalidDebt` from the engine.
- Produces: `create_app() -> FastAPI`; module-level `app`; `allowed_origins() -> list[str]`; `GET /health`.

The router is wired in Task 8; this task builds the app around it.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/api/test_routes.py`:

```python
import pytest
from fastapi.testclient import TestClient

from app.api.main import allowed_origins, create_app


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app())


def test_health_returns_ok(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_health_is_not_versioned(client):
    # Health describes the process, not the API contract, so it must keep
    # working across a future /v2.
    assert client.get("/v1/health").status_code == 404


def test_allowed_origins_defaults_to_local_dev(monkeypatch):
    monkeypatch.delenv("ALLOWED_ORIGINS", raising=False)
    assert allowed_origins() == ["http://localhost:3000"]


def test_allowed_origins_splits_and_strips_the_env_var(monkeypatch):
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://a.example, https://b.example ")
    assert allowed_origins() == ["https://a.example", "https://b.example"]


def test_allowed_origins_ignores_empty_entries(monkeypatch):
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://a.example,,")
    assert allowed_origins() == ["https://a.example"]


def test_cors_headers_are_sent_for_an_allowed_origin(monkeypatch):
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://app.example")
    client = TestClient(create_app())
    response = client.get("/health", headers={"Origin": "https://app.example"})
    assert response.headers["access-control-allow-origin"] == "https://app.example"
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/api/test_routes.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.api.main'`

- [ ] **Step 3: Write the implementation**

Create `backend/app/api/main.py`:

```python
"""Application factory.

Everything process-shaped lives here: CORS, exception handlers, and the
health check. The payoff-plan route itself lives in routers/payoff_plans.py.
"""

import os

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.engine import InvalidDebt

DEFAULT_ORIGIN = "http://localhost:3000"


def allowed_origins() -> list[str]:
    """CORS origins from the environment, comma separated.

    Never hardcoded: every Vercel preview deployment gets its own origin.
    """
    raw = os.environ.get("ALLOWED_ORIGINS", DEFAULT_ORIGIN)
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


def handle_invalid_debt(request: Request, exc: InvalidDebt) -> JSONResponse:
    """Surface engine validation as a 422 in FastAPI's own error envelope.

    Matching the framework's shape means clients write one error parser
    rather than two — and it guarantees a rejected portfolio never escapes as
    an unhandled 500.
    """
    return JSONResponse(
        status_code=422,
        content={"detail": [{"type": "invalid_debt", "msg": str(exc)}]},
    )


def create_app() -> FastAPI:
    app = FastAPI(title="DebtPilot API", version="1.0.0")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins(),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_exception_handler(InvalidDebt, handle_invalid_debt)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && .venv/bin/pytest tests/api/test_routes.py -v`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/main.py backend/tests/api/test_routes.py
git commit -m "feat(api): add application factory with CORS and health check"
```

---

### Task 8: The payoff-plans endpoint

**Files:**
- Create: `backend/app/api/routers/payoff_plans.py`
- Modify: `backend/app/api/main.py` (wire the router under `/v1`)
- Test: `backend/tests/api/test_routes.py` (append)

**Interfaces:**
- Consumes: `PayoffPlanRequest`, `PayoffPlanResponse` (Tasks 3-4); `to_response` (Tasks 5-6); `Debt`, `compute_plans`, `compute_schedules`, `summarize_schedules` from the engine.
- Produces: `router: APIRouter` with `POST /payoff-plans`, mounted at `/v1`.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/api/test_routes.py`:

```python
def portfolio_body(**overrides) -> dict:
    body = {
        "debts": [
            {"id": "a", "name": "Store card", "balance": "500.00",
             "apr": "5.00", "minimum_payment": "25.00"},
            {"id": "b", "name": "Visa", "balance": "2000.00",
             "apr": "25.00", "minimum_payment": "50.00"},
        ],
        "extra_monthly_payment": "200.00",
        "start_month": "2026-09",
    }
    body.update(overrides)
    return body


def test_happy_path_returns_all_three_scenarios(client):
    response = client.post("/v1/payoff-plans", json=portfolio_body())
    assert response.status_code == 200
    body = response.json()
    assert set(body["scenarios"]) == {"snowball", "avalanche", "baseline"}
    assert body["start_month"] == "2026-09"


def test_money_comes_back_as_strings(client):
    body = client.post("/v1/payoff-plans", json=portfolio_body()).json()
    assert isinstance(body["scenarios"]["avalanche"]["total_interest_paid"], str)
    assert isinstance(body["comparison"]["interest_saved_avalanche_vs_snowball"], str)


def test_comparison_carries_every_delta(client):
    comparison = client.post("/v1/payoff-plans", json=portfolio_body()).json()["comparison"]
    assert set(comparison) == {
        "interest_saved_snowball_vs_baseline",
        "interest_saved_avalanche_vs_baseline",
        "interest_saved_avalanche_vs_snowball",
        "months_saved_snowball_vs_baseline",
        "months_saved_avalanche_vs_baseline",
        "months_saved_avalanche_vs_snowball",
    }


def test_schedule_is_omitted_by_default(client):
    body = client.post("/v1/payoff-plans", json=portfolio_body()).json()
    assert body["scenarios"]["avalanche"]["schedule"] is None


def test_empty_portfolio_returns_zero_month_scenarios(client):
    body = client.post("/v1/payoff-plans", json=portfolio_body(debts=[])).json()
    assert body["scenarios"]["avalanche"]["months_to_payoff"] == 0
    assert body["scenarios"]["avalanche"]["payoff_month"] is None


def test_route_is_versioned(client):
    assert client.post("/payoff-plans", json=portfolio_body()).status_code == 404


def test_money_as_a_json_number_is_a_422(client):
    body = portfolio_body()
    body["debts"][0]["balance"] = 500.00
    response = client.post("/v1/payoff-plans", json=body)
    assert response.status_code == 422
    assert "JSON string" in response.text


def test_negative_extra_payment_is_a_422(client):
    response = client.post("/v1/payoff-plans", json=portfolio_body(extra_monthly_payment="-1.00"))
    assert response.status_code == 422


def test_malformed_start_month_is_a_422(client):
    response = client.post("/v1/payoff-plans", json=portfolio_body(start_month="2026-13"))
    assert response.status_code == 422


def test_unknown_field_is_a_422(client):
    response = client.post("/v1/payoff-plans", json=portfolio_body(extra_payment="200.00"))
    assert response.status_code == 422


def test_too_many_debts_is_a_422(client):
    many = [
        {"id": f"d{i}", "name": f"Card {i}", "balance": "100.00",
         "apr": "10.00", "minimum_payment": "25.00"}
        for i in range(51)
    ]
    assert client.post("/v1/payoff-plans", json=portfolio_body(debts=many)).status_code == 422


def test_duplicate_debt_ids_are_a_422_from_the_engine(client):
    # Pydantic cannot see this; the engine raises InvalidDebt and the handler
    # turns it into a 422 rather than letting it escape as a 500.
    duplicated = portfolio_body()
    duplicated["debts"][1]["id"] = "a"
    response = client.post("/v1/payoff-plans", json=duplicated)
    assert response.status_code == 422
    assert response.json()["detail"][0]["type"] == "invalid_debt"


def test_never_pays_off_returns_200_not_an_error(client):
    # The single most important thing the product can tell this user. Returning
    # 4xx would route it into every client's error path.
    body = client.post(
        "/v1/payoff-plans",
        json=portfolio_body(
            debts=[{"id": "a", "name": "Maxed card", "balance": "10000.00",
                    "apr": "24.00", "minimum_payment": "100.00"}],
            extra_monthly_payment="3000.00",
        ),
    )
    assert body.status_code == 200
    payload = body.json()
    assert payload["scenarios"]["baseline"]["outcome"] == "never_pays_off"
    assert payload["scenarios"]["baseline"]["payoff_month"] is None
    assert payload["scenarios"]["baseline"]["underwater_debt_ids"] == ["a"]
    assert payload["comparison"]["interest_saved_avalanche_vs_baseline"] is None
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/api/test_routes.py -v -k "happy_path"`
Expected: FAIL — 404, because no `/v1/payoff-plans` route exists yet.

- [ ] **Step 3: Write the router**

Create `backend/app/api/routers/payoff_plans.py`:

```python
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
```

Either branch runs the simulation three times, never six.

- [ ] **Step 4: Wire the router into `backend/app/api/main.py`**

Add the import at the top:

```python
from .routers import payoff_plans
```

and inside `create_app()`, after the `health` endpoint definition:

```python
    app.include_router(payoff_plans.router, prefix="/v1")
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend && .venv/bin/pytest tests/api/test_routes.py -v`
Expected: PASS, 19 tests

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/routers/payoff_plans.py backend/app/api/main.py backend/tests/api/test_routes.py
git commit -m "feat(api): add POST /v1/payoff-plans"
```

---

### Task 9: The detail=full query parameter

**Files:**
- Test: `backend/tests/api/test_routes.py` (append)

**Interfaces:**
- Consumes: everything from Task 8. No production code changes — Task 8 wired the branch; this task proves it end to end and pins the parameter's accepted values.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/api/test_routes.py`:

```python
def test_detail_full_includes_the_per_debt_schedule(client):
    body = client.post("/v1/payoff-plans?detail=full", json=portfolio_body()).json()
    schedule = body["scenarios"]["avalanche"]["schedule"]
    assert schedule is not None
    assert schedule[0]["month_number"] == 1
    assert schedule[0]["month"] == "2026-09"
    assert {row["debt_id"] for row in schedule[0]["debts"]} == {"a", "b"}


def test_detail_full_covers_all_three_scenarios(client):
    body = client.post("/v1/payoff-plans?detail=full", json=portfolio_body()).json()
    for name in ("snowball", "avalanche", "baseline"):
        assert body["scenarios"][name]["schedule"] is not None


def test_detail_full_schedule_rows_are_money_strings(client):
    body = client.post("/v1/payoff-plans?detail=full", json=portfolio_body()).json()
    row = body["scenarios"]["avalanche"]["schedule"][0]["debts"][0]
    assert isinstance(row["interest_charged"], str)
    assert isinstance(row["ending_balance"], str)


def test_detail_full_and_default_agree_on_every_summary_number(client):
    default = client.post("/v1/payoff-plans", json=portfolio_body()).json()
    detailed = client.post("/v1/payoff-plans?detail=full", json=portfolio_body()).json()
    for name in ("snowball", "avalanche", "baseline"):
        a, b = default["scenarios"][name], detailed["scenarios"][name]
        assert a["months_to_payoff"] == b["months_to_payoff"]
        assert a["total_interest_paid"] == b["total_interest_paid"]
        assert a["total_paid"] == b["total_paid"]
    assert default["comparison"] == detailed["comparison"]


def test_a_misspelled_detail_value_is_a_422(client):
    # ?detail=fill must not quietly return a summary.
    assert client.post("/v1/payoff-plans?detail=fill", json=portfolio_body()).status_code == 422


def test_the_baseline_schedule_is_long(client):
    # The reason detail is opt-in: a minimums-only baseline can run for
    # hundreds of months, and serializing three of those by default would be
    # a payload the UI mostly discards.
    body = client.post("/v1/payoff-plans?detail=full", json=portfolio_body()).json()
    assert len(body["scenarios"]["baseline"]["schedule"]) > len(
        body["scenarios"]["avalanche"]["schedule"]
    )
```

- [ ] **Step 2: Run the tests**

Run: `cd backend && .venv/bin/pytest tests/api/test_routes.py -v -k "detail"`
Expected: PASS, 6 tests. If `test_a_misspelled_detail_value_is_a_422` fails, the `Literal["full"] | None` annotation in Task 8 is missing — fix it there rather than loosening this test.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/api/test_routes.py
git commit -m "test(api): cover the detail=full query parameter"
```

---

### Task 10: Contract tests

**Files:**
- Create: `backend/tests/api/test_contract.py`

**Interfaces:**
- Consumes: the app, the engine. No production code.

These are the two invariants this layer exists to protect, and the ones most worth keeping if the rest of the suite were ever trimmed.

- [ ] **Step 1: Write the tests**

Create `backend/tests/api/test_contract.py`:

```python
"""The two properties the API layer must never break.

The first makes the deliberate validation overlap safe: Pydantic re-checks
rules the engine also enforces, and if the two ever disagree the result must
be a well-formed 422, never an unhandled 500.

The second guards the one bug class this layer can uniquely introduce: a
mapper that silently drops a field or rounds a delta.
"""

from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from app.api.main import create_app
from app.engine import Debt, InvalidDebt, compute_plans


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app())


def body(debts, extra="200.00", start="2026-09") -> dict:
    return {"debts": debts, "extra_monthly_payment": extra, "start_month": start}


ENGINE_REJECTS = [
    pytest.param(
        [{"id": "a", "name": "A", "balance": "100.00", "apr": "10.00", "minimum_payment": "25.00"},
         {"id": "a", "name": "B", "balance": "200.00", "apr": "10.00", "minimum_payment": "25.00"}],
        "200.00",
        id="duplicate-ids",
    ),
    pytest.param(
        [{"id": "a", "name": "A", "balance": "100.00", "apr": "10.00", "minimum_payment": "25.00"}],
        "-1.00",
        id="negative-extra",
    ),
    pytest.param(
        [{"id": "a", "name": "A", "balance": "-100.00", "apr": "10.00", "minimum_payment": "25.00"}],
        "200.00",
        id="negative-balance",
    ),
    pytest.param(
        [{"id": "a", "name": "A", "balance": "100.00", "apr": "-1.00", "minimum_payment": "25.00"}],
        "200.00",
        id="negative-apr",
    ),
    pytest.param(
        [{"id": "a", "name": "A", "balance": "100.00", "apr": "10.00", "minimum_payment": "-5.00"}],
        "200.00",
        id="negative-minimum",
    ),
]


@pytest.mark.parametrize("debts,extra", ENGINE_REJECTS)
def test_every_engine_rejection_is_a_422_never_a_500(client, debts, extra):
    response = client.post("/v1/payoff-plans", json=body(debts, extra))
    assert response.status_code == 422, response.text
    assert "detail" in response.json()


def test_invalid_debt_is_registered_as_a_handler_not_an_accident(client):
    # Prove the handler exists by confirming the engine really would raise:
    # without the handler this same input would surface as a 500.
    with pytest.raises(InvalidDebt):
        compute_plans(
            [
                Debt("a", "A", Decimal("100.00"), Decimal("10.00"), Decimal("25.00")),
                Debt("a", "B", Decimal("200.00"), Decimal("10.00"), Decimal("25.00")),
            ],
            Decimal("200.00"),
        )


def test_response_numbers_equal_the_engines_own_output(client):
    """Run one portfolio through both paths and compare every money string."""
    debts = [
        Debt("a", "Store card", Decimal("500.00"), Decimal("5.00"), Decimal("25.00")),
        Debt("b", "Visa", Decimal("2000.00"), Decimal("25.00"), Decimal("50.00")),
    ]
    expected = compute_plans(debts, Decimal("200.00"))

    payload = client.post(
        "/v1/payoff-plans",
        json=body(
            [{"id": "a", "name": "Store card", "balance": "500.00",
              "apr": "5.00", "minimum_payment": "25.00"},
             {"id": "b", "name": "Visa", "balance": "2000.00",
              "apr": "25.00", "minimum_payment": "50.00"}]
        ),
    ).json()

    for name, summary in (
        ("snowball", expected.snowball),
        ("avalanche", expected.avalanche),
        ("baseline", expected.baseline),
    ):
        wire = payload["scenarios"][name]
        assert wire["months_to_payoff"] == summary.months_to_payoff
        assert wire["total_interest_paid"] == str(summary.total_interest_paid)
        assert wire["total_paid"] == str(summary.total_paid)
        assert wire["underwater_debt_ids"] == list(summary.underwater_debt_ids)
        assert len(wire["debt_payoffs"]) == len(summary.debt_payoffs)
        assert len(wire["monthly_totals"]) == len(summary.monthly_totals)

    assert payload["comparison"]["interest_saved_avalanche_vs_snowball"] == str(
        expected.interest_saved_avalanche_vs_snowball
    )
    assert payload["comparison"]["months_saved_avalanche_vs_baseline"] == (
        expected.months_saved_avalanche_vs_baseline
    )


def test_per_debt_payoff_numbers_survive_the_mapping(client):
    debts = [
        Debt("a", "Store card", Decimal("500.00"), Decimal("5.00"), Decimal("25.00")),
        Debt("b", "Visa", Decimal("2000.00"), Decimal("25.00"), Decimal("50.00")),
    ]
    expected = compute_plans(debts, Decimal("200.00"))
    payload = client.post(
        "/v1/payoff-plans",
        json=body(
            [{"id": "a", "name": "Store card", "balance": "500.00",
              "apr": "5.00", "minimum_payment": "25.00"},
             {"id": "b", "name": "Visa", "balance": "2000.00",
              "apr": "25.00", "minimum_payment": "50.00"}]
        ),
    ).json()

    for wire, engine_payoff in zip(
        payload["scenarios"]["avalanche"]["debt_payoffs"], expected.avalanche.debt_payoffs
    ):
        assert wire["debt_id"] == engine_payoff.debt_id
        assert wire["name"] == engine_payoff.name
        assert wire["months_to_payoff"] == engine_payoff.payoff_month
        assert wire["total_interest_paid"] == str(engine_payoff.total_interest_paid)
```

- [ ] **Step 2: Run the tests**

Run: `cd backend && .venv/bin/pytest tests/api/test_contract.py -v`
Expected: PASS, 8 tests

- [ ] **Step 3: Commit**

```bash
git add backend/tests/api/test_contract.py
git commit -m "test(api): pin the 422-not-500 and engine-parity contracts"
```

---

### Task 11: Raise the coverage gate and document the API

**Files:**
- Modify: `backend/pyproject.toml`
- Create: `backend/.env.example`
- Modify: `README.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: the full suite.
- Produces: a build that fails below 100% coverage of `app`, not just `app.engine`.

- [ ] **Step 1: Raise the gate in `backend/pyproject.toml`**

```toml
[tool.pytest.ini_options]
testpaths = ["tests"]
pythonpath = ["."]
addopts = "--cov=app --cov-report=term-missing --cov-fail-under=100"

[tool.coverage.run]
source = ["app"]
branch = true
```

- [ ] **Step 2: Run the full suite and close any gaps**

Run: `cd backend && .venv/bin/pytest`
Expected: PASS at 100%. If a line or branch is uncovered, add a test for it — never a `# pragma: no cover`. The likely candidates are the `else` branch of the `detail` check and the `schedules is None` branches in the mapper; Tasks 8, 9 and 5 already cover all three, so an uncovered line here means a test was skipped.

- [ ] **Step 3: Create `backend/.env.example`**

```bash
# Comma-separated CORS origins for the API. Every Vercel preview deployment
# gets its own origin, so this must not be hardcoded in the app.
ALLOWED_ORIGINS=http://localhost:3000
```

This slice needs no secrets: there is no database and no model provider yet.

- [ ] **Step 4: Document the endpoint in `README.md`**

Under the existing "Running the tests" section, add:

````markdown
## Running the API

```bash
cd backend
.venv/bin/uvicorn app.api.main:app --reload
```

Interactive docs at `http://127.0.0.1:8000/docs`; health check at `/health`.

`POST /v1/payoff-plans` takes a portfolio and returns all three scenarios plus
every precomputed comparison. Money is a JSON **string** in both directions —
JSON has no decimal type, and accepting bare numbers would reintroduce floats
at the boundary of a Decimal-only engine. Add `?detail=full` for the per-debt
month-by-month schedule.

```bash
curl -X POST http://127.0.0.1:8000/v1/payoff-plans \
  -H 'content-type: application/json' \
  -d '{"debts":[{"id":"a","name":"Visa","balance":"2000.00","apr":"24.99","minimum_payment":"50.00"}],
       "extra_monthly_payment":"200.00","start_month":"2026-09"}'
```
````

Then update the roadmap: change `- [ ] FastAPI layer — debts CRUD, POST /payoff-plans` to two entries, `- [x] Payoff plan API (stateless)` and `- [ ] Debts CRUD with persistence`.

- [ ] **Step 5: Update `CLAUDE.md`**

In the "## API endpoints (rough draft)" section, replace the "Payoff plans" bullet block with:

```markdown
Payoff plans
- POST /v1/payoff-plans — built. Stateless: debts arrive in the request body.
  Returns snowball, avalanche, and the minimums-only baseline, plus the six
  precomputed comparison deltas. `?detail=full` adds the per-debt
  month-by-month grid. Money is a JSON string in both directions; bare
  numbers are a 422. `start_month` (YYYY-MM) is required — the API reads no
  clock, so a response is a pure function of its request.
- A portfolio that never pays off is a 200, not an error.
- GET /payoff-plans, GET /payoff-plans/{id} — deferred until persistence exists.
```

Add to the "## Conventions" section:

```markdown
- FastAPI and Pydantic live only under `app/api/`. The engine imports no
  framework, and route handlers are `def`, not `async def`, because the
  engine is CPU-bound.
```

- [ ] **Step 6: Run the full suite once more**

Run: `cd backend && .venv/bin/pytest`
Expected: PASS, 109 engine + 4 new engine + 63 API tests, 100% coverage of `app`

- [ ] **Step 7: Commit**

```bash
git add backend/pyproject.toml backend/.env.example README.md CLAUDE.md
git commit -m "ci(api): extend the coverage gate to the whole app and document the endpoint"
```

---

## Self-Review

**Spec coverage.** Every section maps to a task:

| Spec section | Task |
|---|---|
| §3.1 money as strings, enforced | 3 |
| §3.2 required client `start_month` | 3, 8 |
| §3.3 scenarios keyed, deltas grouped | 4, 5 |
| §3.4 snake_case end to end | 3, 4 |
| §3.5 explicit mapper | 5, 6 |
| §4 module layout, `def` not `async def` | 2, 7, 8 |
| §5 endpoints, `detail`, `/health`, `/v1` | 7, 8, 9 |
| §6 request schema, 50-debt cap, validation overlap | 3 |
| §7 response schema, `month_number`, both payoff numbers | 4, 5 |
| §8 date conversion, null for zero-month | 2, 5 |
| §9 error table, never-pays-off as 200 | 7, 8 |
| §10 `ALLOWED_ORIGINS`, no secrets | 7, 11 |
| §11 five test files, gate raised to `app` | 2–11 |
| §12 deferred items | deliberately not built |

**One spec gap found and filled.** §5 and §7 describe `?detail=full` returning the per-debt grid, but the engine exposed no way to obtain it — `compute_plans` discards the schedules. Task 1 adds `compute_schedules` and `summarize_schedules` without changing `compute_plans`'s signature or behavior. This is an engine change, so it lands first and carries its own tests. **Amend spec §4 to note that the API calls `compute_schedules`/`summarize_schedules` on the detail path.**

**Placeholder scan.** No "TBD", no "add validation", no "similar to Task N". Every code step carries runnable code; every test step carries real assertions with expected values.

**Type consistency.** Verified across tasks: `MONTH_PATTERN` and `month_label` (Task 2) are consumed by Tasks 3 and 5. `Money` (Task 3) is used by every response model in Task 4. `to_response(comparison, start_month, schedules=None)` is defined in Task 5, extended in Task 6, and called in Task 8 with exactly that signature. `compute_schedules` returns `dict[Strategy, Schedule]` in Task 1 and is indexed by `Strategy.SNOWBALL` / `AVALANCHE` / `MINIMUM_ONLY` in Tasks 6 and 8. The engine's `DebtPayoff.payoff_month` (an `int`) becomes the response's `months_to_payoff`, and the response's `payoff_month` is the calendar label — the rename is applied consistently in Task 5's mapper and asserted in Task 10's contract test.
