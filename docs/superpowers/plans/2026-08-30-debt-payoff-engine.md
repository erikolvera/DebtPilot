# Debt Payoff Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the deterministic debt payoff engine — a pure Python package that computes snowball, avalanche, and minimums-only payoff projections from a list of debts.

**Architecture:** One parameterized month-stepping simulator with four injected seams (interest accrual, minimum-payment rule, debt ordering, rollover). Snowball and avalanche differ only by a sort key, so the arithmetic lives in exactly one place. All money is `Decimal` quantized to cents at every step. The engine has no dates, no I/O, no framework imports, and no knowledge that users or databases exist.

**Tech Stack:** Python 3.12, stdlib only at runtime (`decimal`, `dataclasses`, `enum`). Dev-only: pytest, pytest-cov, hypothesis.

**Spec:** `docs/superpowers/specs/2026-08-30-debt-engine-design.md`

## Global Constraints

Every task's requirements implicitly include this section.

- Python 3.12 or newer.
- Money is always `Decimal`, never `float`. The single exception is Task 14's closed-form oracle, which deliberately uses `math` as an independent check.
- `ROUND_HALF_UP` passed explicitly at every quantize call site. **Never** mutate the global decimal context (`getcontext().rounding = ...`).
- No `pydantic`, `fastapi`, `sqlalchemy`, or any framework import inside `backend/app/engine/`. The engine's only runtime imports are stdlib.
- No mocks in any engine test. Pure functions with injected seams need none.
- All engine dataclasses are `frozen=True`. Collections are `tuple`, never `list`.
- 100% line coverage on `backend/app/engine/`, enforced.
- `MINIMUM_FLOOR = Decimal("25.00")`, `MAX_MONTHS = 1200`.
- APR is stored as a percent (`Decimal("24.99")`), not a rate. The `/100` conversion happens only in `interest.py`.
- Month indices are 1-based. Month 1 is the first month a payment is made.
- Commit after every task.

## Refinements to the Spec

Two things the spec's prose left underspecified, resolved here. Both are deliberate and neither changes behavior described in the spec.

1. **`money.py` is a new module** not listed in the spec's §4 layout. `to_cents()` is needed by `models`, `interest`, `minimums`, and `simulator`. Putting it in `models.py` would force `interest.py` to import the data model just to round a number, inverting the dependency for a pure arithmetic helper.

2. **Spec §6's "cheap pre-flight" is not implemented.** The no-progress check already catches a doomed debt in month 1 — one loop iteration — so a pre-flight would be a second implementation of the same decision, in a codebase whose central argument is that the arithmetic has exactly one home. Two detectors that must agree is a worse failure mode than one detector that runs one iteration longer. Spec §6 should be amended to record this.

3. **The ordering seam takes balances explicitly:** `order_fn(debts, balances)` rather than the spec's `order_fn(active)`. `Debt` is frozen and holds the *original* balance, so ordering by anything current is impossible without passing a `Mapping[str, Decimal]`. Ordering uses each debt's balance at the **start of the month**, before interest and payments — that is the number a user sees on a statement, and it keeps the order from wobbling with minimum-payment sizes.

## File Structure

```
backend/
  pyproject.toml                  deps, pytest + coverage config
  app/__init__.py
  app/engine/__init__.py          public exports: compute_plans, Debt, and result types
  app/engine/money.py             CENTS, to_cents, to_rate_precision
  app/engine/errors.py            InvalidDebt
  app/engine/models.py            Debt, validate_portfolio, all result dataclasses, enums
  app/engine/interest.py          monthly_rate, monthly_interest        [accrual seam]
  app/engine/minimums.py          fixed_minimum, declining_minimum       [rule seam]
  app/engine/ordering.py          snowball_order, avalanche_order        [strategy seam]
  app/engine/simulator.py         simulate                               [the one loop]
  app/engine/plans.py             summarize, compute_plans
  tests/engine/test_money.py
  tests/engine/test_models.py
  tests/engine/test_interest.py
  tests/engine/test_minimums.py
  tests/engine/test_ordering.py
  tests/engine/test_simulator.py
  tests/engine/test_plans.py
  tests/engine/test_golden.py
  tests/engine/test_properties.py
  tests/engine/test_oracle.py
  tests/engine/fixtures/
.github/workflows/backend.yml
```

Dependency direction is strictly one-way, no cycles:

```
money  ->  errors  ->  models  ->  interest, minimums, ordering  ->  simulator  ->  plans
```

---

### Task 1: Scaffolding and the money module

**Files:**
- Create: `backend/pyproject.toml`
- Create: `backend/app/__init__.py`, `backend/app/engine/__init__.py`
- Create: `backend/app/engine/money.py`
- Test: `backend/tests/engine/test_money.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `CENTS: Decimal`, `to_cents(value: Decimal) -> Decimal`, `to_rate_precision(value: Decimal) -> Decimal`.

- [ ] **Step 1: Create the package skeleton**

```bash
mkdir -p backend/app/engine backend/tests/engine/fixtures
touch backend/app/__init__.py backend/app/engine/__init__.py
touch backend/tests/__init__.py backend/tests/engine/__init__.py
```

- [ ] **Step 2: Write `backend/pyproject.toml`**

```toml
[project]
name = "debtpilot-backend"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = []

[project.optional-dependencies]
dev = ["pytest>=8.0", "pytest-cov>=5.0", "hypothesis>=6.100"]

[tool.pytest.ini_options]
testpaths = ["tests"]
pythonpath = ["."]

[tool.coverage.run]
source = ["app/engine"]
branch = true
```

- [ ] **Step 3: Install dev dependencies**

```bash
cd backend && python3 -m venv .venv && .venv/bin/pip install -e ".[dev]"
```

- [ ] **Step 4: Write the failing test**

Create `backend/tests/engine/test_money.py`:

```python
from decimal import Decimal, getcontext

from app.engine.money import CENTS, to_cents, to_rate_precision


def test_to_cents_rounds_to_two_places():
    assert to_cents(Decimal("1.6658333")) == Decimal("1.67")


def test_to_cents_rounds_half_up_not_bankers():
    # Decimal defaults to ROUND_HALF_EVEN, which would give 0.02 here.
    # This test fails if the rounding mode is not passed explicitly.
    assert to_cents(Decimal("0.025")) == Decimal("0.03")


def test_to_cents_leaves_exact_values_alone():
    assert to_cents(Decimal("100.00")) == Decimal("100.00")


def test_to_cents_does_not_mutate_the_global_context():
    before = getcontext().rounding
    to_cents(Decimal("0.025"))
    assert getcontext().rounding == before


def test_to_rate_precision_rounds_apr_to_two_places():
    assert to_rate_precision(Decimal("24.9949")) == Decimal("24.99")


def test_cents_constant_is_two_places():
    assert CENTS == Decimal("0.01")
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/engine/test_money.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.engine.money'`

- [ ] **Step 6: Write the implementation**

Create `backend/app/engine/money.py`:

```python
"""Money rounding helpers.

Every monetary value in the engine is quantized to whole cents at every step.
This reproduces how lenders actually round interest monthly, and it removes an
entire bug class: because balances are always exact cent values, "paid off" is
exactly ``balance == 0`` with no epsilon comparison.
"""

from decimal import ROUND_HALF_UP, Decimal

CENTS = Decimal("0.01")


def to_cents(value: Decimal) -> Decimal:
    """Round a money amount to whole cents, half away from zero.

    The rounding mode is passed explicitly rather than set on the global
    decimal context, which is process-wide state a library must not touch.
    """
    return value.quantize(CENTS, rounding=ROUND_HALF_UP)


def to_rate_precision(value: Decimal) -> Decimal:
    """Round an APR percentage to two places, matching ``numeric(5,2)``."""
    return value.quantize(CENTS, rounding=ROUND_HALF_UP)
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `cd backend && .venv/bin/pytest tests/engine/test_money.py -v`
Expected: PASS, 6 tests

- [ ] **Step 8: Commit**

```bash
git add backend/pyproject.toml backend/app backend/tests
git commit -m "feat(engine): add package scaffolding and money rounding helpers"
```

---

### Task 2: Errors and the Debt input model

**Files:**
- Create: `backend/app/engine/errors.py`
- Create: `backend/app/engine/models.py`
- Test: `backend/tests/engine/test_models.py`

**Interfaces:**
- Consumes: `to_cents`, `to_rate_precision` from Task 1.
- Produces: `InvalidDebt(ValueError)`; `Debt(id, name, balance, apr, minimum_payment)` frozen dataclass that validates and quantizes on construction; `validate_portfolio(debts: Sequence[Debt], extra_payment: Decimal) -> None`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/engine/test_models.py`:

```python
from decimal import Decimal

import pytest

from app.engine.errors import InvalidDebt
from app.engine.models import Debt, validate_portfolio


def make_debt(**overrides) -> Debt:
    kwargs = {
        "id": "d1",
        "name": "Visa",
        "balance": Decimal("1000.00"),
        "apr": Decimal("24.00"),
        "minimum_payment": Decimal("50.00"),
    }
    kwargs.update(overrides)
    return Debt(**kwargs)


def test_debt_is_frozen():
    debt = make_debt()
    with pytest.raises(Exception):
        debt.balance = Decimal("5.00")


def test_debt_quantizes_balance_on_ingest():
    assert make_debt(balance=Decimal("100.005")).balance == Decimal("100.01")


def test_debt_quantizes_minimum_on_ingest():
    assert make_debt(minimum_payment=Decimal("49.999")).minimum_payment == Decimal("50.00")


def test_debt_quantizes_apr_on_ingest():
    assert make_debt(apr=Decimal("24.9949")).apr == Decimal("24.99")


def test_negative_balance_is_rejected():
    with pytest.raises(InvalidDebt, match="balance"):
        make_debt(balance=Decimal("-1.00"))


def test_negative_apr_is_rejected():
    with pytest.raises(InvalidDebt, match="apr"):
        make_debt(apr=Decimal("-0.01"))


def test_negative_minimum_is_rejected():
    with pytest.raises(InvalidDebt, match="minimum_payment"):
        make_debt(minimum_payment=Decimal("-5.00"))


def test_zero_balance_is_accepted():
    assert make_debt(balance=Decimal("0.00")).balance == Decimal("0.00")


def test_zero_minimum_is_accepted():
    assert make_debt(minimum_payment=Decimal("0.00")).minimum_payment == Decimal("0.00")


def test_minimum_larger_than_balance_is_accepted():
    debt = make_debt(balance=Decimal("10.00"), minimum_payment=Decimal("50.00"))
    assert debt.minimum_payment == Decimal("50.00")


def test_duplicate_ids_are_rejected():
    debts = [make_debt(id="a"), make_debt(id="a")]
    with pytest.raises(InvalidDebt, match="duplicate"):
        validate_portfolio(debts, Decimal("0.00"))


def test_negative_extra_payment_is_rejected():
    with pytest.raises(InvalidDebt, match="extra_payment"):
        validate_portfolio([make_debt()], Decimal("-1.00"))


def test_valid_portfolio_passes():
    validate_portfolio([make_debt(id="a"), make_debt(id="b")], Decimal("100.00"))


def test_empty_portfolio_passes():
    validate_portfolio([], Decimal("0.00"))
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/engine/test_models.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.engine.errors'`

- [ ] **Step 3: Write `backend/app/engine/errors.py`**

```python
"""Engine exceptions.

Only genuine "I cannot answer your question" cases live here. A portfolio that
never pays off is a *result*, not an exception — see ``Outcome`` in models.py.
"""


class InvalidDebt(ValueError):
    """Raised when inputs cannot produce a meaningful simulation."""
```

- [ ] **Step 4: Write the `Debt` half of `backend/app/engine/models.py`**

```python
"""Engine data model.

Plain frozen dataclasses only. No Pydantic, no FastAPI, no ORM — Pydantic
lives at the API boundary, which keeps this package testable with no app
context.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from decimal import Decimal

from .errors import InvalidDebt
from .money import to_cents, to_rate_precision


@dataclass(frozen=True)
class Debt:
    """A single debt, as the engine sees it.

    Deliberately carries no ``user_id``, ``type``, or timestamps: the engine
    does not know users exist. ``apr`` is a percent (24.99), not a rate.
    """

    id: str
    name: str
    balance: Decimal
    apr: Decimal
    minimum_payment: Decimal

    def __post_init__(self) -> None:
        if self.balance < 0:
            raise InvalidDebt(f"debt {self.id!r}: balance may not be negative")
        if self.apr < 0:
            raise InvalidDebt(f"debt {self.id!r}: apr may not be negative")
        if self.minimum_payment < 0:
            raise InvalidDebt(
                f"debt {self.id!r}: minimum_payment may not be negative"
            )
        # Normalize precision on ingest rather than rejecting it. The frozen
        # dataclass requires object.__setattr__ to write during __post_init__.
        object.__setattr__(self, "balance", to_cents(self.balance))
        object.__setattr__(self, "minimum_payment", to_cents(self.minimum_payment))
        object.__setattr__(self, "apr", to_rate_precision(self.apr))


def validate_portfolio(debts: Sequence[Debt], extra_payment: Decimal) -> None:
    """Validate cross-debt invariants that a single ``Debt`` cannot check."""
    if extra_payment < 0:
        raise InvalidDebt("extra_payment may not be negative")
    seen: set[str] = set()
    for debt in debts:
        if debt.id in seen:
            raise InvalidDebt(f"duplicate debt id {debt.id!r}")
        seen.add(debt.id)
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend && .venv/bin/pytest tests/engine/test_models.py -v`
Expected: PASS, 14 tests

- [ ] **Step 6: Commit**

```bash
git add backend/app/engine/errors.py backend/app/engine/models.py backend/tests/engine/test_models.py
git commit -m "feat(engine): add Debt model with ingest validation and quantization"
```

---

### Task 3: Interest accrual seam

**Files:**
- Create: `backend/app/engine/interest.py`
- Test: `backend/tests/engine/test_interest.py`

**Interfaces:**
- Consumes: `to_cents` from Task 1.
- Produces: `monthly_rate(apr: Decimal) -> Decimal`, `monthly_interest(balance: Decimal, apr: Decimal) -> Decimal`.

Takes primitives rather than a `Debt` so this module has no dependency on the data model — it is the seam that daily compounding will replace later.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/engine/test_interest.py`:

```python
from decimal import Decimal

from app.engine.interest import monthly_interest, monthly_rate


def test_monthly_rate_divides_percent_by_twelve():
    # 24% APR -> 2% per month
    assert monthly_rate(Decimal("24.00")) == Decimal("0.02")


def test_round_number_case():
    # $1,000 at 24% APR -> 2% -> $20.00
    assert monthly_interest(Decimal("1000.00"), Decimal("24.00")) == Decimal("20.00")


def test_result_is_rounded_to_cents():
    # 100.00 * 19.99 / 100 / 12 = 1.6658333... -> 1.67
    assert monthly_interest(Decimal("100.00"), Decimal("19.99")) == Decimal("1.67")


def test_zero_apr_accrues_nothing():
    assert monthly_interest(Decimal("5000.00"), Decimal("0.00")) == Decimal("0.00")


def test_zero_balance_accrues_nothing():
    assert monthly_interest(Decimal("0.00"), Decimal("24.00")) == Decimal("0.00")


def test_penny_balance_accrues_nothing():
    # 0.01 * 0.02 = 0.0002, which quantizes to 0.00. This is what prevents an
    # immortal fractional debt.
    assert monthly_interest(Decimal("0.01"), Decimal("24.00")) == Decimal("0.00")


def test_result_is_always_two_places():
    result = monthly_interest(Decimal("1234.56"), Decimal("17.99"))
    assert result.as_tuple().exponent == -2
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/engine/test_interest.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.engine.interest'`

- [ ] **Step 3: Write the implementation**

Create `backend/app/engine/interest.py`:

```python
"""Interest accrual — the swappable seam.

Monthly periods: one simulation step is one month, interest is charged before
the payment posts. This slightly understates real daily compounding (26.82%
versus 27.12% effective at a 24% APR), which is why user-facing copy must say
"estimated". Replacing this module with daily accrual should not require any
change to simulator.py.
"""

from decimal import Decimal

from .money import to_cents

HUNDRED = Decimal(100)
MONTHS_PER_YEAR = Decimal(12)


def monthly_rate(apr: Decimal) -> Decimal:
    """Convert an APR percentage to a monthly rate. Not rounded."""
    return apr / HUNDRED / MONTHS_PER_YEAR


def monthly_interest(balance: Decimal, apr: Decimal) -> Decimal:
    """Interest accrued in one month, rounded to whole cents."""
    if balance <= 0 or apr <= 0:
        return Decimal("0.00")
    return to_cents(balance * monthly_rate(apr))
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && .venv/bin/pytest tests/engine/test_interest.py -v`
Expected: PASS, 7 tests

- [ ] **Step 5: Commit**

```bash
git add backend/app/engine/interest.py backend/tests/engine/test_interest.py
git commit -m "feat(engine): add monthly interest accrual seam"
```

---

### Task 4: Minimum payment rules

**Files:**
- Create: `backend/app/engine/minimums.py`
- Test: `backend/tests/engine/test_minimums.py`

**Interfaces:**
- Consumes: `Debt` from Task 2, `to_cents` from Task 1.
- Produces: `MINIMUM_FLOOR: Decimal`, `implied_percentage(debt) -> Decimal`, `fixed_minimum(debt, balance) -> Decimal`, `declining_minimum(debt, balance) -> Decimal`.

Both rules share the signature `(debt: Debt, balance: Decimal) -> Decimal` so they are interchangeable at the seam. `fixed_minimum` ignores `balance` by design.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/engine/test_minimums.py`:

```python
from decimal import Decimal

from app.engine.minimums import (
    MINIMUM_FLOOR,
    declining_minimum,
    fixed_minimum,
    implied_percentage,
)
from app.engine.models import Debt


def make_debt(balance="1000.00", minimum="50.00") -> Debt:
    return Debt(
        id="d1",
        name="Visa",
        balance=Decimal(balance),
        apr=Decimal("20.00"),
        minimum_payment=Decimal(minimum),
    )


def test_floor_is_twenty_five_dollars():
    assert MINIMUM_FLOOR == Decimal("25.00")


def test_fixed_minimum_ignores_current_balance():
    debt = make_debt()
    assert fixed_minimum(debt, Decimal("100.00")) == Decimal("50.00")
    assert fixed_minimum(debt, Decimal("900.00")) == Decimal("50.00")


def test_implied_percentage_is_minimum_over_starting_balance():
    # 50 / 1000 = 5%
    assert implied_percentage(make_debt()) == Decimal("0.05")


def test_declining_minimum_scales_with_current_balance():
    # 5% of 900.00 = 45.00, which is above the floor
    assert declining_minimum(make_debt(), Decimal("900.00")) == Decimal("45.00")


def test_declining_minimum_applies_the_floor():
    # 5% of 400.00 = 20.00, which is below the 25.00 floor
    assert declining_minimum(make_debt(), Decimal("400.00")) == Decimal("25.00")


def test_declining_minimum_rounds_to_cents():
    # 5% of 333.33 = 16.6665 -> below floor, so floor wins
    assert declining_minimum(make_debt(), Decimal("333.33")) == Decimal("25.00")
    # 5% of 1234.57 = 61.7285 -> 61.73
    assert declining_minimum(make_debt(), Decimal("1234.57")) == Decimal("61.73")


def test_zero_stored_minimum_yields_zero_not_the_floor():
    # The floor must not manufacture a payment the user never had.
    debt = make_debt(minimum="0.00")
    assert declining_minimum(debt, Decimal("1000.00")) == Decimal("0.00")


def test_implied_percentage_of_zero_minimum_is_zero():
    assert implied_percentage(make_debt(minimum="0.00")) == Decimal(0)


def test_implied_percentage_of_zero_balance_is_zero():
    assert implied_percentage(make_debt(balance="0.00")) == Decimal(0)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/engine/test_minimums.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.engine.minimums'`

- [ ] **Step 3: Write the implementation**

Create `backend/app/engine/minimums.py`:

```python
"""Minimum-payment rules — the second seam.

Snowball and avalanche use ``fixed_minimum``: safe because the total monthly
outlay is held constant, so a shrinking real-world minimum would only free
cash the model already directs at the target debt.

The minimums-only baseline uses ``declining_minimum``, because minimums that
shrink with the balance are exactly why paying minimums alone takes decades.
Modeling them as fixed would make the baseline wildly too optimistic and
understate the gap the product exists to show.
"""

from decimal import Decimal

from .models import Debt
from .money import to_cents

MINIMUM_FLOOR = Decimal("25.00")


def fixed_minimum(debt: Debt, balance: Decimal) -> Decimal:
    """The stored minimum, unchanged. ``balance`` is ignored by design."""
    return debt.minimum_payment


def implied_percentage(debt: Debt) -> Decimal:
    """The debt's minimum as a fraction of its starting balance.

    Derived rather than collected, because users do not know their card's
    minimum-payment formula.
    """
    if debt.balance <= 0 or debt.minimum_payment <= 0:
        return Decimal(0)
    return debt.minimum_payment / debt.balance


def declining_minimum(debt: Debt, balance: Decimal) -> Decimal:
    """A minimum that shrinks with the balance, floored at ``MINIMUM_FLOOR``.

    A debt with no stored minimum keeps no minimum: the floor must not
    manufacture a payment the user never had.
    """
    if debt.minimum_payment <= 0:
        return Decimal("0.00")
    scaled = implied_percentage(debt) * balance
    return to_cents(max(MINIMUM_FLOOR, scaled))
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && .venv/bin/pytest tests/engine/test_minimums.py -v`
Expected: PASS, 9 tests

- [ ] **Step 5: Commit**

```bash
git add backend/app/engine/minimums.py backend/tests/engine/test_minimums.py
git commit -m "feat(engine): add fixed and declining minimum payment rules"
```

---

### Task 5: Ordering seam with total tiebreaks

**Files:**
- Create: `backend/app/engine/ordering.py`
- Test: `backend/tests/engine/test_ordering.py`

**Interfaces:**
- Consumes: `Debt` from Task 2.
- Produces: `snowball_order(debts, balances) -> tuple[Debt, ...]`, `avalanche_order(debts, balances) -> tuple[Debt, ...]`, both taking `Sequence[Debt]` and `Mapping[str, Decimal]`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/engine/test_ordering.py`:

```python
import random
from decimal import Decimal

from app.engine.models import Debt
from app.engine.ordering import avalanche_order, snowball_order


def debt(id_, balance, apr, minimum="25.00") -> Debt:
    return Debt(
        id=id_,
        name=f"Card {id_}",
        balance=Decimal(balance),
        apr=Decimal(apr),
        minimum_payment=Decimal(minimum),
    )


def balances_of(debts) -> dict[str, Decimal]:
    return {d.id: d.balance for d in debts}


def ids(ordered) -> list[str]:
    return [d.id for d in ordered]


def test_snowball_orders_by_smallest_balance():
    debts = [debt("a", "3000.00", "10.00"), debt("b", "500.00", "20.00"),
             debt("c", "1500.00", "15.00")]
    assert ids(snowball_order(debts, balances_of(debts))) == ["b", "c", "a"]


def test_avalanche_orders_by_highest_apr():
    debts = [debt("a", "3000.00", "10.00"), debt("b", "500.00", "20.00"),
             debt("c", "1500.00", "15.00")]
    assert ids(avalanche_order(debts, balances_of(debts))) == ["b", "c", "a"]


def test_snowball_uses_the_passed_balances_not_the_original():
    debts = [debt("a", "3000.00", "10.00"), debt("b", "500.00", "20.00")]
    current = {"a": Decimal("100.00"), "b": Decimal("500.00")}
    assert ids(snowball_order(debts, current)) == ["a", "b"]


def test_avalanche_breaks_apr_ties_by_smaller_balance():
    debts = [debt("a", "3000.00", "20.00"), debt("b", "500.00", "20.00")]
    assert ids(avalanche_order(debts, balances_of(debts))) == ["b", "a"]


def test_snowball_breaks_balance_ties_by_higher_apr():
    debts = [debt("a", "1000.00", "10.00"), debt("b", "1000.00", "25.00")]
    assert ids(snowball_order(debts, balances_of(debts))) == ["b", "a"]


def test_full_ties_break_by_id():
    debts = [debt("z", "1000.00", "20.00"), debt("a", "1000.00", "20.00")]
    assert ids(snowball_order(debts, balances_of(debts))) == ["a", "z"]
    assert ids(avalanche_order(debts, balances_of(debts))) == ["a", "z"]


def test_ordering_is_independent_of_input_order():
    # Python's sort is stable, so without the trailing id tiebreak the result
    # would silently inherit input order. This is the determinism guard.
    debts = [debt("a", "1000.00", "20.00"), debt("b", "1000.00", "20.00"),
             debt("c", "1000.00", "20.00")]
    balances = balances_of(debts)
    expected_snowball = ids(snowball_order(debts, balances))
    expected_avalanche = ids(avalanche_order(debts, balances))
    rng = random.Random(1234)
    for _ in range(20):
        shuffled = debts[:]
        rng.shuffle(shuffled)
        assert ids(snowball_order(shuffled, balances)) == expected_snowball
        assert ids(avalanche_order(shuffled, balances)) == expected_avalanche


def test_ordering_returns_a_tuple():
    debts = [debt("a", "1000.00", "20.00")]
    assert isinstance(snowball_order(debts, balances_of(debts)), tuple)
    assert isinstance(avalanche_order(debts, balances_of(debts)), tuple)


def test_empty_input_returns_empty_tuple():
    assert snowball_order([], {}) == ()
    assert avalanche_order([], {}) == ()
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/engine/test_ordering.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.engine.ordering'`

- [ ] **Step 3: Write the implementation**

Create `backend/app/engine/ordering.py`:

```python
"""Debt ordering — the strategy seam.

Snowball and avalanche differ by exactly one sort key. Both orderings are
*total*: the trailing ``id`` tiebreak is load-bearing, not pedantry. Python's
sort is stable, so without it the ordering silently inherits input order, and
the same debts submitted in a different sequence would produce a different
per-debt payoff order — a determinism bug that fixed-list unit tests cannot
find.
"""

from collections.abc import Mapping, Sequence
from decimal import Decimal

from .models import Debt


def snowball_order(
    debts: Sequence[Debt], balances: Mapping[str, Decimal]
) -> tuple[Debt, ...]:
    """Smallest balance first, then highest APR, then id."""
    return tuple(sorted(debts, key=lambda d: (balances[d.id], -d.apr, d.id)))


def avalanche_order(
    debts: Sequence[Debt], balances: Mapping[str, Decimal]
) -> tuple[Debt, ...]:
    """Highest APR first, then smallest balance, then id."""
    return tuple(sorted(debts, key=lambda d: (-d.apr, balances[d.id], d.id)))
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && .venv/bin/pytest tests/engine/test_ordering.py -v`
Expected: PASS, 9 tests

- [ ] **Step 5: Commit**

```bash
git add backend/app/engine/ordering.py backend/tests/engine/test_ordering.py
git commit -m "feat(engine): add snowball and avalanche ordering with total tiebreaks"
```

---

### Task 6: Result data model

**Files:**
- Modify: `backend/app/engine/models.py` (append after `validate_portfolio`)
- Test: `backend/tests/engine/test_models.py` (append)

**Interfaces:**
- Consumes: nothing new.
- Produces: `Strategy`, `Outcome` (enums); `DebtMonth`, `Month`, `Schedule`, `MonthlyTotal`, `DebtPayoff`, `PlanSummary`, `PlanComparison` (frozen dataclasses).

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/engine/test_models.py`:

```python
from app.engine.models import (
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


def test_strategy_values():
    assert Strategy.SNOWBALL.value == "snowball"
    assert Strategy.AVALANCHE.value == "avalanche"
    assert Strategy.MINIMUM_ONLY.value == "minimum_only"


def test_outcome_values():
    assert Outcome.PAID_OFF.value == "paid_off"
    assert Outcome.NEVER_PAYS_OFF.value == "never_pays_off"


def make_month(index=1) -> Month:
    row = DebtMonth(
        debt_id="d1",
        starting_balance=Decimal("100.00"),
        interest_charged=Decimal("1.00"),
        payment_applied=Decimal("50.00"),
        ending_balance=Decimal("51.00"),
    )
    return Month(
        index=index,
        debts=(row,),
        total_payment=Decimal("50.00"),
        total_interest=Decimal("1.00"),
        remaining_balance=Decimal("51.00"),
    )


def test_schedule_defaults_to_no_underwater_debts():
    schedule = Schedule(months=(make_month(),), outcome=Outcome.PAID_OFF)
    assert schedule.underwater_debt_ids == ()


def test_schedule_carries_the_outcome():
    # simulate() returns a Schedule, so the Schedule must record how the run
    # ended — the outcome cannot live only on PlanSummary.
    schedule = Schedule(
        months=(), outcome=Outcome.NEVER_PAYS_OFF, underwater_debt_ids=("d1",)
    )
    assert schedule.outcome is Outcome.NEVER_PAYS_OFF
    assert schedule.underwater_debt_ids == ("d1",)


def test_result_types_are_frozen():
    month = make_month()
    with pytest.raises(Exception):
        month.index = 2


def test_plan_summary_allows_null_months_when_never_pays_off():
    summary = PlanSummary(
        strategy=Strategy.MINIMUM_ONLY,
        outcome=Outcome.NEVER_PAYS_OFF,
        months_to_payoff=None,
        underwater_debt_ids=("d1",),
        total_interest_paid=Decimal("500.00"),
        total_paid=Decimal("500.00"),
        debt_payoffs=(),
        monthly_totals=(MonthlyTotal(1, Decimal("10.00"), Decimal("1.00")),),
    )
    assert summary.months_to_payoff is None


def test_plan_comparison_allows_null_deltas():
    summary = PlanSummary(
        strategy=Strategy.SNOWBALL,
        outcome=Outcome.PAID_OFF,
        months_to_payoff=3,
        underwater_debt_ids=(),
        total_interest_paid=Decimal("1.53"),
        total_paid=Decimal("101.53"),
        debt_payoffs=(DebtPayoff("d1", "Visa", 3, Decimal("1.53")),),
        monthly_totals=(),
    )
    comparison = PlanComparison(
        snowball=summary,
        avalanche=summary,
        baseline=summary,
        interest_saved_snowball_vs_baseline=None,
        interest_saved_avalanche_vs_baseline=None,
        interest_saved_avalanche_vs_snowball=Decimal("0.00"),
        months_saved_snowball_vs_baseline=None,
        months_saved_avalanche_vs_baseline=None,
        months_saved_avalanche_vs_snowball=0,
    )
    assert comparison.interest_saved_snowball_vs_baseline is None
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/engine/test_models.py -v`
Expected: FAIL — `ImportError: cannot import name 'Strategy' from 'app.engine.models'`

- [ ] **Step 3: Append to `backend/app/engine/models.py`**

Also add `from enum import Enum` to the imports at the top of the file.

```python
class Strategy(Enum):
    SNOWBALL = "snowball"
    AVALANCHE = "avalanche"
    MINIMUM_ONLY = "minimum_only"


class Outcome(Enum):
    PAID_OFF = "paid_off"
    NEVER_PAYS_OFF = "never_pays_off"


@dataclass(frozen=True)
class DebtMonth:
    """One debt's activity in one month."""

    debt_id: str
    starting_balance: Decimal
    interest_charged: Decimal
    payment_applied: Decimal
    ending_balance: Decimal


@dataclass(frozen=True)
class Month:
    """One month across every active debt. ``index`` is 1-based."""

    index: int
    debts: tuple[DebtMonth, ...]
    total_payment: Decimal
    total_interest: Decimal
    remaining_balance: Decimal


@dataclass(frozen=True)
class Schedule:
    """The full simulation record, plus how the run ended.

    ``simulate`` returns this, so it has to carry the outcome; the summary
    layer above it cannot invent one.
    """

    months: tuple[Month, ...]
    outcome: Outcome
    underwater_debt_ids: tuple[str, ...] = ()


@dataclass(frozen=True)
class MonthlyTotal:
    """A compact per-month row for charting, without the per-debt grid."""

    index: int
    remaining_balance: Decimal
    cumulative_interest: Decimal


@dataclass(frozen=True)
class DebtPayoff:
    debt_id: str
    name: str
    payoff_month: int
    total_interest_paid: Decimal


@dataclass(frozen=True)
class PlanSummary:
    """What crosses the API boundary for one scenario."""

    strategy: Strategy
    outcome: Outcome
    months_to_payoff: int | None
    underwater_debt_ids: tuple[str, ...]
    total_interest_paid: Decimal
    total_paid: Decimal
    debt_payoffs: tuple[DebtPayoff, ...]
    monthly_totals: tuple[MonthlyTotal, ...]


@dataclass(frozen=True)
class PlanComparison:
    """All three scenarios plus every delta the AI layer is allowed to state.

    Verbose on purpose. Every number that could appear in a sentence the model
    writes must already exist as a field here, so the prompt says "describe
    these figures" rather than "work out the difference". Deltas are nullable
    because you cannot subtract from a plan that never pays off.
    """

    snowball: PlanSummary
    avalanche: PlanSummary
    baseline: PlanSummary
    interest_saved_snowball_vs_baseline: Decimal | None
    interest_saved_avalanche_vs_baseline: Decimal | None
    interest_saved_avalanche_vs_snowball: Decimal | None
    months_saved_snowball_vs_baseline: int | None
    months_saved_avalanche_vs_baseline: int | None
    months_saved_avalanche_vs_snowball: int | None
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && .venv/bin/pytest tests/engine/test_models.py -v`
Expected: PASS, 21 tests

- [ ] **Step 5: Commit**

```bash
git add backend/app/engine/models.py backend/tests/engine/test_models.py
git commit -m "feat(engine): add result data model and outcome enums"
```

---

### Task 7: Simulator — accrual and required payments

**Files:**
- Create: `backend/app/engine/simulator.py`
- Test: `backend/tests/engine/test_simulator.py`

**Interfaces:**
- Consumes: `monthly_interest` (Task 3), `Debt`, `Month`, `DebtMonth`, `Schedule`, `Outcome`, `validate_portfolio` (Tasks 2, 6), `to_cents` (Task 1).
- Produces: `MAX_MONTHS: int`, `ZERO: Decimal`, `simulate(debts, extra_payment, order_fn, minimum_rule, rollover=True) -> Schedule`.

This task builds the single-debt path: accrue interest, pay the scheduled minimum truncated to the remaining balance, stop when clear. Budget, surplus and rollover arrive in Task 8; termination detection in Task 9.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/engine/test_simulator.py`:

```python
from decimal import Decimal

from app.engine.minimums import fixed_minimum
from app.engine.models import Debt, Outcome
from app.engine.ordering import snowball_order
from app.engine.simulator import ZERO, simulate


def debt(id_, balance, apr, minimum) -> Debt:
    return Debt(
        id=id_,
        name=f"Card {id_}",
        balance=Decimal(balance),
        apr=Decimal(apr),
        minimum_payment=Decimal(minimum),
    )


def run(debts, extra="0.00", rule=fixed_minimum, rollover=True):
    return simulate(debts, Decimal(extra), snowball_order, rule, rollover)


def test_empty_portfolio_returns_an_empty_schedule():
    schedule = run([])
    assert schedule.months == ()
    assert schedule.outcome is Outcome.PAID_OFF


def test_zero_balance_debts_are_excluded():
    schedule = run([debt("a", "0.00", "20.00", "50.00")])
    assert schedule.months == ()
    assert schedule.outcome is Outcome.PAID_OFF


def test_single_debt_no_interest():
    # $100 at 0% APR, $50/month -> exactly 2 months
    schedule = run([debt("a", "100.00", "0.00", "50.00")])
    assert len(schedule.months) == 2
    assert schedule.outcome is Outcome.PAID_OFF
    assert schedule.months[0].index == 1
    assert schedule.months[-1].remaining_balance == ZERO


def test_single_debt_with_interest_hand_computed():
    # $100 at 12% APR (1%/month), $50/month:
    #   M1: +1.00 -> 101.00, pay 50.00 -> 51.00
    #   M2: +0.51 ->  51.51, pay 50.00 ->  1.51
    #   M3: +0.02 ->   1.53, pay  1.53 ->  0.00   (truncated final payment)
    schedule = run([debt("a", "100.00", "12.00", "50.00")])
    assert len(schedule.months) == 3

    m1, m2, m3 = schedule.months
    assert m1.total_interest == Decimal("1.00")
    assert m1.total_payment == Decimal("50.00")
    assert m1.remaining_balance == Decimal("51.00")

    assert m2.total_interest == Decimal("0.51")
    assert m2.remaining_balance == Decimal("1.51")

    assert m3.total_interest == Decimal("0.02")
    assert m3.total_payment == Decimal("1.53")
    assert m3.remaining_balance == ZERO


def test_final_payment_is_truncated_so_balances_never_go_negative():
    schedule = run([debt("a", "100.00", "12.00", "50.00")])
    for month in schedule.months:
        for row in month.debts:
            assert row.ending_balance >= ZERO


def test_month_rows_record_per_debt_detail():
    schedule = run([debt("a", "100.00", "0.00", "50.00")])
    row = schedule.months[0].debts[0]
    assert row.debt_id == "a"
    assert row.starting_balance == Decimal("100.00")
    assert row.interest_charged == ZERO
    assert row.payment_applied == Decimal("50.00")
    assert row.ending_balance == Decimal("50.00")


def test_extra_payment_is_quantized_on_entry():
    schedule = run([debt("a", "100.00", "0.00", "50.00")], extra="0.004")
    assert schedule.months[0].total_payment == Decimal("50.00")
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/engine/test_simulator.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.engine.simulator'`

- [ ] **Step 3: Write the implementation**

Create `backend/app/engine/simulator.py`:

```python
"""The single month-stepping loop.

Snowball, avalanche, and the minimums-only baseline are all this function with
different seams. Keeping the arithmetic in one place is a correctness property,
not a style preference: three copies would be three independent homes for a
rounding bug, and a near-certainty that a fix lands in only two of them.
"""

from collections.abc import Callable, Mapping, Sequence
from decimal import Decimal

from .interest import monthly_interest
from .models import Debt, DebtMonth, Month, Outcome, Schedule, validate_portfolio
from .money import to_cents

MAX_MONTHS = 1200
ZERO = Decimal("0.00")

OrderFn = Callable[[Sequence[Debt], Mapping[str, Decimal]], tuple[Debt, ...]]
MinimumRule = Callable[[Debt, Decimal], Decimal]


def _build_month(
    index: int,
    active: Sequence[Debt],
    starting: Mapping[str, Decimal],
    interest: Mapping[str, Decimal],
    payments: Mapping[str, Decimal],
    balances: Mapping[str, Decimal],
) -> Month:
    rows = tuple(
        DebtMonth(
            debt_id=d.id,
            starting_balance=starting[d.id],
            interest_charged=interest[d.id],
            payment_applied=payments[d.id],
            ending_balance=balances[d.id],
        )
        for d in active
    )
    return Month(
        index=index,
        debts=rows,
        total_payment=sum((r.payment_applied for r in rows), ZERO),
        total_interest=sum((r.interest_charged for r in rows), ZERO),
        remaining_balance=sum(balances.values(), ZERO),
    )


def simulate(
    debts: Sequence[Debt],
    extra_payment: Decimal,
    order_fn: OrderFn,
    minimum_rule: MinimumRule,
    rollover: bool = True,
) -> Schedule:
    """Step month by month until every debt clears."""
    validate_portfolio(debts, extra_payment)
    extra_payment = to_cents(extra_payment)

    active_debts = [d for d in debts if d.balance > ZERO]
    if not active_debts:
        return Schedule(months=(), outcome=Outcome.PAID_OFF)

    balances: dict[str, Decimal] = {d.id: d.balance for d in active_debts}
    months: list[Month] = []

    for index in range(1, MAX_MONTHS + 1):
        active = [d for d in active_debts if balances[d.id] > ZERO]
        if not active:
            break

        starting = {d.id: balances[d.id] for d in active}

        interest: dict[str, Decimal] = {}
        for d in active:
            charge = monthly_interest(balances[d.id], d.apr)
            interest[d.id] = charge
            balances[d.id] += charge

        scheduled = {d.id: minimum_rule(d, starting[d.id]) for d in active}

        payments: dict[str, Decimal] = {}
        for d in active:
            # Truncate the final payment to what is actually owed, so balances
            # never go negative and total interest stays honest.
            pay = min(scheduled[d.id], balances[d.id])
            payments[d.id] = pay
            balances[d.id] -= pay

        months.append(_build_month(index, active, starting, interest, payments, balances))

    return Schedule(months=tuple(months), outcome=Outcome.PAID_OFF)
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && .venv/bin/pytest tests/engine/test_simulator.py -v`
Expected: PASS, 7 tests

- [ ] **Step 5: Commit**

```bash
git add backend/app/engine/simulator.py backend/tests/engine/test_simulator.py
git commit -m "feat(engine): add month-stepping simulator with truncated final payments"
```

---

### Task 8: Simulator — budget, surplus cascade, and rollover

**Files:**
- Modify: `backend/app/engine/simulator.py`
- Test: `backend/tests/engine/test_simulator.py` (append)

**Interfaces:**
- Consumes: everything from Task 7.
- Produces: no signature change. `simulate` now honours `extra_payment`, cascades surplus in `order_fn` order, and accumulates a rollover pool.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/engine/test_simulator.py`:

```python
def test_extra_payment_goes_to_the_target_debt():
    # $100 at 0% with a $50 minimum and $50 extra clears in one month.
    schedule = run([debt("a", "100.00", "0.00", "50.00")], extra="50.00")
    assert len(schedule.months) == 1
    assert schedule.months[0].total_payment == Decimal("100.00")


def test_rollover_keeps_the_total_outlay_constant():
    # a: $100 @ 0%, min 50    b: $200 @ 0%, min 50    extra: 0
    #   M1: a 100->50,  b 200->150            total paid 100
    #   M2: a  50->0,   b 150->100            total paid 100, a's 50 freed
    #   M3: b 100->50 (min) then -50 (freed)  total paid 100 -> clear
    debts = [debt("a", "100.00", "0.00", "50.00"), debt("b", "200.00", "0.00", "50.00")]
    schedule = run(debts)
    assert len(schedule.months) == 3
    for month in schedule.months:
        assert month.total_payment == Decimal("100.00")


def test_without_rollover_the_freed_minimum_is_not_reused():
    # Same portfolio, rollover off: b keeps paying only its own $50, so it
    # needs a fourth month.
    debts = [debt("a", "100.00", "0.00", "50.00"), debt("b", "200.00", "0.00", "50.00")]
    schedule = run(debts, rollover=False)
    assert len(schedule.months) == 4


def test_truncation_remainder_cascades_within_the_same_month():
    # a: $30 @ 0%, min 50   b: $500 @ 0%, min 50
    # Budget is built from the SCHEDULED minimums (50+50=100), but a can only
    # absorb 30. The spare 20 must reach b in month 1, not evaporate.
    debts = [debt("a", "30.00", "0.00", "50.00"), debt("b", "500.00", "0.00", "50.00")]
    schedule = run(debts)
    month1 = schedule.months[0]
    assert month1.total_payment == Decimal("100.00")
    by_id = {row.debt_id: row for row in month1.debts}
    assert by_id["a"].payment_applied == Decimal("30.00")
    assert by_id["b"].payment_applied == Decimal("70.00")


def test_snowball_and_avalanche_attack_different_debts_first():
    # a: small balance, low APR   b: large balance, high APR
    debts = [debt("a", "500.00", "5.00", "25.00"), debt("b", "2000.00", "25.00", "50.00")]
    snow = simulate(debts, Decimal("200.00"), snowball_order, fixed_minimum)
    aval = simulate(debts, Decimal("200.00"), avalanche_order, fixed_minimum)

    snow_first = {r.debt_id: r.payment_applied for r in snow.months[0].debts}
    aval_first = {r.debt_id: r.payment_applied for r in aval.months[0].debts}
    assert snow_first["a"] > snow_first["b"]
    assert aval_first["b"] > aval_first["a"]


def test_surplus_larger_than_the_whole_portfolio_is_not_overpaid():
    debts = [debt("a", "100.00", "0.00", "50.00")]
    schedule = run(debts, extra="5000.00")
    assert len(schedule.months) == 1
    assert schedule.months[0].total_payment == Decimal("100.00")
    assert schedule.months[0].remaining_balance == ZERO
```

Add `avalanche_order` to the imports at the top of the test file:

```python
from app.engine.ordering import avalanche_order, snowball_order
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/engine/test_simulator.py -v`
Expected: FAIL — `test_extra_payment_goes_to_the_target_debt` asserts 1 month but gets 2; the extra payment is ignored.

- [ ] **Step 3: Replace the body of the monthly loop in `simulate`**

Replace everything from `scheduled = {...}` to the `months.append(...)` line with:

```python
        scheduled = {d.id: minimum_rule(d, starting[d.id]) for d in active}
        required = {d.id: min(scheduled[d.id], balances[d.id]) for d in active}

        # Budget is built from SCHEDULED minimums, not required ones. The gap
        # between them is the final-payment truncation remainder, and routing
        # it through `surplus` is what keeps it from silently evaporating.
        budget = sum(scheduled.values(), ZERO) + extra_payment + freed_pool

        payments: dict[str, Decimal] = {}
        for d in active:
            payments[d.id] = required[d.id]
            balances[d.id] -= required[d.id]

        surplus = budget - sum(required.values(), ZERO)
        if surplus > ZERO:
            for d in order_fn(active, starting):
                if surplus <= ZERO:
                    break
                pay = min(surplus, balances[d.id])
                if pay <= ZERO:
                    continue
                balances[d.id] -= pay
                payments[d.id] += pay
                surplus -= pay

        if rollover:
            for d in active:
                if balances[d.id] <= ZERO:
                    freed_pool += scheduled[d.id]

        months.append(_build_month(index, active, starting, interest, payments, balances))
```

And initialise the pool alongside `months`, before the loop:

```python
    months: list[Month] = []
    freed_pool = ZERO
```

Ordering uses `starting` — each debt's balance at the start of the month, before interest and payments. That is the number a user sees on a statement, and it keeps the order from wobbling with minimum-payment sizes.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && .venv/bin/pytest tests/engine/test_simulator.py -v`
Expected: PASS, 13 tests

- [ ] **Step 5: Commit**

```bash
git add backend/app/engine/simulator.py backend/tests/engine/test_simulator.py
git commit -m "feat(engine): add budget, surplus cascade, and rollover pool"
```

---

### Task 9: Simulator — termination and NEVER_PAYS_OFF

**Files:**
- Modify: `backend/app/engine/simulator.py`
- Test: `backend/tests/engine/test_simulator.py` (append)

**Interfaces:**
- Consumes: everything from Task 8.
- Produces: no signature change. `simulate` now returns `Outcome.NEVER_PAYS_OFF` with populated `underwater_debt_ids` instead of looping forever.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/engine/test_simulator.py`:

```python
def test_negative_amortization_is_a_result_not_an_exception():
    # $1,000 at 24% accrues $20.00/month against a $10.00 minimum. The balance
    # grows forever, and the user needs to be told exactly that.
    schedule = run([debt("a", "1000.00", "24.00", "10.00")])
    assert schedule.outcome is Outcome.NEVER_PAYS_OFF
    assert schedule.underwater_debt_ids == ("a",)


def test_no_progress_is_detected_in_the_first_month():
    schedule = run([debt("a", "1000.00", "24.00", "10.00")])
    assert len(schedule.months) == 1


def test_underwater_run_still_returns_its_partial_schedule():
    schedule = run([debt("a", "1000.00", "24.00", "10.00")])
    assert schedule.months[0].total_interest == Decimal("20.00")
    assert schedule.months[0].total_payment == Decimal("10.00")


def test_extra_payment_can_rescue_an_underwater_debt():
    schedule = run([debt("a", "1000.00", "24.00", "10.00")], extra="500.00")
    assert schedule.outcome is Outcome.PAID_OFF


def test_max_months_backstop_stops_glacial_progress():
    # $100,000 at 20% accrues $1,666.67/month against a $1,666.68 minimum:
    # one cent of progress per month, so it would run for millennia.
    schedule = run([debt("a", "100000.00", "20.00", "1666.68")])
    assert schedule.outcome is Outcome.NEVER_PAYS_OFF
    assert len(schedule.months) == 1200


def test_zero_minimum_and_zero_extra_never_pays_off():
    schedule = run([debt("a", "500.00", "18.00", "0.00")])
    assert schedule.outcome is Outcome.NEVER_PAYS_OFF


def test_a_healthy_run_is_still_paid_off():
    schedule = run([debt("a", "100.00", "12.00", "50.00")])
    assert schedule.outcome is Outcome.PAID_OFF
    assert schedule.underwater_debt_ids == ()
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/engine/test_simulator.py::test_negative_amortization_is_a_result_not_an_exception -v`
Expected: FAIL — the run completes 1200 months and reports `Outcome.PAID_OFF`.

- [ ] **Step 3: Add progress tracking to `simulate`**

Initialise before the loop, next to `freed_pool`:

```python
    previous_total = sum(balances.values(), ZERO)
```

Append after the `months.append(...)` line, at the end of the loop body:

```python
        total_remaining = sum(balances.values(), ZERO)
        if total_remaining <= ZERO:
            break
        if total_remaining >= previous_total:
            # The budget is fixed while interest compounds, so if a month ends
            # no better than it started, no later month can do better either.
            underwater = tuple(
                sorted(d.id for d in active if balances[d.id] >= starting[d.id])
            )
            return Schedule(
                months=tuple(months),
                outcome=Outcome.NEVER_PAYS_OFF,
                underwater_debt_ids=underwater,
            )
        previous_total = total_remaining
```

Then replace the loop's trailing `return` with a `for ... else` backstop. The final shape of the function tail is:

```python
    else:
        # MAX_MONTHS exhausted without clearing: glacial but positive progress.
        underwater = tuple(
            sorted(d.id for d in active_debts if balances[d.id] > ZERO)
        )
        return Schedule(
            months=tuple(months),
            outcome=Outcome.NEVER_PAYS_OFF,
            underwater_debt_ids=underwater,
        )

    return Schedule(months=tuple(months), outcome=Outcome.PAID_OFF)
```

The `else` belongs to the `for` statement: it runs only when the loop finishes all 1200 iterations without hitting a `break`.

- [ ] **Step 4: Run the full simulator suite**

Run: `cd backend && .venv/bin/pytest tests/engine/test_simulator.py -v`
Expected: PASS, 20 tests

- [ ] **Step 5: Commit**

```bash
git add backend/app/engine/simulator.py backend/tests/engine/test_simulator.py
git commit -m "feat(engine): detect negative amortization and cap runaway runs"
```

---

### Task 10: Folding a Schedule into a PlanSummary

**Files:**
- Create: `backend/app/engine/plans.py`
- Test: `backend/tests/engine/test_plans.py`

**Interfaces:**
- Consumes: `Schedule`, `PlanSummary`, `DebtPayoff`, `MonthlyTotal`, `Strategy`, `Outcome`, `Debt` (Tasks 2, 6); `ZERO` (Task 7).
- Produces: `summarize(schedule: Schedule, debts: Sequence[Debt], strategy: Strategy) -> PlanSummary`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/engine/test_plans.py`:

```python
from decimal import Decimal

from app.engine.minimums import fixed_minimum
from app.engine.models import Debt, Outcome, Strategy
from app.engine.ordering import snowball_order
from app.engine.plans import summarize
from app.engine.simulator import ZERO, simulate


def debt(id_, balance, apr, minimum) -> Debt:
    return Debt(
        id=id_,
        name=f"Card {id_}",
        balance=Decimal(balance),
        apr=Decimal(apr),
        minimum_payment=Decimal(minimum),
    )


def summarize_run(debts, extra="0.00", strategy=Strategy.SNOWBALL):
    schedule = simulate(debts, Decimal(extra), snowball_order, fixed_minimum)
    return summarize(schedule, debts, strategy)


def test_summary_reports_months_and_totals():
    # The hand-computed 3-month run from Task 7:
    #   interest 1.00 + 0.51 + 0.02 = 1.53
    #   paid     50.00 + 50.00 + 1.53 = 101.53
    summary = summarize_run([debt("a", "100.00", "12.00", "50.00")])
    assert summary.months_to_payoff == 3
    assert summary.total_interest_paid == Decimal("1.53")
    assert summary.total_paid == Decimal("101.53")
    assert summary.outcome is Outcome.PAID_OFF


def test_total_paid_equals_principal_plus_interest():
    summary = summarize_run([debt("a", "100.00", "12.00", "50.00")])
    assert summary.total_paid == Decimal("100.00") + summary.total_interest_paid


def test_summary_records_the_strategy():
    summary = summarize_run([debt("a", "100.00", "0.00", "50.00")], strategy=Strategy.AVALANCHE)
    assert summary.strategy is Strategy.AVALANCHE


def test_debt_payoffs_carry_name_month_and_interest():
    summary = summarize_run([debt("a", "100.00", "12.00", "50.00")])
    assert len(summary.debt_payoffs) == 1
    payoff = summary.debt_payoffs[0]
    assert payoff.debt_id == "a"
    assert payoff.name == "Card a"
    assert payoff.payoff_month == 3
    assert payoff.total_interest_paid == Decimal("1.53")


def test_debt_payoffs_are_in_the_order_debts_clear():
    debts = [debt("a", "100.00", "0.00", "50.00"), debt("b", "200.00", "0.00", "50.00")]
    summary = summarize_run(debts)
    assert [p.debt_id for p in summary.debt_payoffs] == ["a", "b"]
    assert [p.payoff_month for p in summary.debt_payoffs] == [2, 3]


def test_monthly_totals_accumulate_interest():
    summary = summarize_run([debt("a", "100.00", "12.00", "50.00")])
    assert [t.index for t in summary.monthly_totals] == [1, 2, 3]
    assert [t.cumulative_interest for t in summary.monthly_totals] == [
        Decimal("1.00"),
        Decimal("1.51"),
        Decimal("1.53"),
    ]
    assert [t.remaining_balance for t in summary.monthly_totals] == [
        Decimal("51.00"),
        Decimal("1.51"),
        ZERO,
    ]


def test_empty_portfolio_summarizes_to_zero_months():
    summary = summarize_run([])
    assert summary.months_to_payoff == 0
    assert summary.total_interest_paid == ZERO
    assert summary.debt_payoffs == ()


def test_never_pays_off_reports_null_months_and_underwater_ids():
    summary = summarize_run([debt("a", "1000.00", "24.00", "10.00")])
    assert summary.outcome is Outcome.NEVER_PAYS_OFF
    assert summary.months_to_payoff is None
    assert summary.underwater_debt_ids == ("a",)
    assert summary.debt_payoffs == ()
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/engine/test_plans.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.engine.plans'`

- [ ] **Step 3: Write the implementation**

Create `backend/app/engine/plans.py`:

```python
"""Summarizing schedules and comparing scenarios.

``months_to_payoff`` and ``total_interest_paid`` are not separate
calculations — they are folds over the schedule the simulator already built.
"""

from collections.abc import Sequence
from decimal import Decimal

from .models import (
    Debt,
    DebtPayoff,
    MonthlyTotal,
    Outcome,
    PlanSummary,
    Schedule,
    Strategy,
)
from .simulator import ZERO


def summarize(
    schedule: Schedule, debts: Sequence[Debt], strategy: Strategy
) -> PlanSummary:
    """Fold a full schedule into the object that crosses the API boundary."""
    names = {d.id: d.name for d in debts}

    payoff_month: dict[str, int] = {}
    interest_by_debt: dict[str, Decimal] = {}
    monthly_totals: list[MonthlyTotal] = []
    cumulative = ZERO
    total_interest = ZERO
    total_paid = ZERO

    for month in schedule.months:
        total_interest += month.total_interest
        total_paid += month.total_payment
        cumulative += month.total_interest
        monthly_totals.append(
            MonthlyTotal(
                index=month.index,
                remaining_balance=month.remaining_balance,
                cumulative_interest=cumulative,
            )
        )
        for row in month.debts:
            interest_by_debt[row.debt_id] = (
                interest_by_debt.get(row.debt_id, ZERO) + row.interest_charged
            )
            if row.ending_balance <= ZERO and row.debt_id not in payoff_month:
                payoff_month[row.debt_id] = month.index

    debt_payoffs = tuple(
        DebtPayoff(
            debt_id=debt_id,
            name=names[debt_id],
            payoff_month=month_index,
            total_interest_paid=interest_by_debt[debt_id],
        )
        # Sorted by month, then id, so the order is total and reproducible.
        for debt_id, month_index in sorted(
            payoff_month.items(), key=lambda item: (item[1], item[0])
        )
    )

    paid_off = schedule.outcome is Outcome.PAID_OFF
    return PlanSummary(
        strategy=strategy,
        outcome=schedule.outcome,
        months_to_payoff=len(schedule.months) if paid_off else None,
        underwater_debt_ids=schedule.underwater_debt_ids,
        total_interest_paid=total_interest,
        total_paid=total_paid,
        debt_payoffs=debt_payoffs if paid_off else (),
        monthly_totals=tuple(monthly_totals),
    )
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && .venv/bin/pytest tests/engine/test_plans.py -v`
Expected: PASS, 8 tests

- [ ] **Step 5: Commit**

```bash
git add backend/app/engine/plans.py backend/tests/engine/test_plans.py
git commit -m "feat(engine): summarize schedules into plan summaries"
```

---

### Task 11: compute_plans and the comparison deltas

**Files:**
- Modify: `backend/app/engine/plans.py`
- Modify: `backend/app/engine/__init__.py`
- Test: `backend/tests/engine/test_plans.py` (append)

**Interfaces:**
- Consumes: `summarize` (Task 10), `simulate` (Task 9), both ordering functions (Task 5), both minimum rules (Task 4).
- Produces: `compute_plans(debts: Sequence[Debt], extra_payment: Decimal) -> PlanComparison`; the engine's public exports.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/engine/test_plans.py`:

```python
from app.engine.plans import compute_plans


def test_compute_plans_labels_each_scenario():
    debts = [debt("a", "500.00", "5.00", "25.00"), debt("b", "2000.00", "25.00", "50.00")]
    plans = compute_plans(debts, Decimal("200.00"))
    assert plans.snowball.strategy is Strategy.SNOWBALL
    assert plans.avalanche.strategy is Strategy.AVALANCHE
    assert plans.baseline.strategy is Strategy.MINIMUM_ONLY


def test_avalanche_never_costs_more_interest_than_snowball():
    debts = [debt("a", "500.00", "5.00", "25.00"), debt("b", "2000.00", "25.00", "50.00")]
    plans = compute_plans(debts, Decimal("200.00"))
    assert plans.avalanche.total_interest_paid <= plans.snowball.total_interest_paid


def test_snowball_clears_the_small_debt_first():
    debts = [debt("a", "500.00", "5.00", "25.00"), debt("b", "2000.00", "25.00", "50.00")]
    plans = compute_plans(debts, Decimal("200.00"))
    assert plans.snowball.debt_payoffs[0].debt_id == "a"
    assert plans.avalanche.debt_payoffs[0].debt_id == "b"


def test_baseline_is_slower_and_costlier_than_both_strategies():
    debts = [debt("a", "500.00", "5.00", "25.00"), debt("b", "2000.00", "25.00", "50.00")]
    plans = compute_plans(debts, Decimal("200.00"))
    assert plans.baseline.months_to_payoff > plans.avalanche.months_to_payoff
    assert plans.baseline.total_interest_paid > plans.avalanche.total_interest_paid


def test_deltas_are_the_arithmetic_the_ai_layer_must_not_do():
    debts = [debt("a", "500.00", "5.00", "25.00"), debt("b", "2000.00", "25.00", "50.00")]
    plans = compute_plans(debts, Decimal("200.00"))
    assert plans.interest_saved_avalanche_vs_snowball == (
        plans.snowball.total_interest_paid - plans.avalanche.total_interest_paid
    )
    assert plans.interest_saved_avalanche_vs_baseline == (
        plans.baseline.total_interest_paid - plans.avalanche.total_interest_paid
    )
    assert plans.months_saved_avalanche_vs_baseline == (
        plans.baseline.months_to_payoff - plans.avalanche.months_to_payoff
    )


def test_deltas_are_none_when_the_baseline_never_pays_off():
    # 1% implied minimum against a 2% monthly rate: the baseline is underwater,
    # but a large extra payment still clears both strategies.
    debts = [debt("a", "10000.00", "24.00", "100.00")]
    plans = compute_plans(debts, Decimal("3000.00"))
    assert plans.baseline.outcome is Outcome.NEVER_PAYS_OFF
    assert plans.avalanche.outcome is Outcome.PAID_OFF
    assert plans.interest_saved_avalanche_vs_baseline is None
    assert plans.months_saved_avalanche_vs_baseline is None
    # The strategy-vs-strategy delta is still a real number.
    assert plans.interest_saved_avalanche_vs_snowball is not None


def test_baseline_ignores_the_extra_payment():
    debts = [debt("a", "1000.00", "12.00", "100.00")]
    small = compute_plans(debts, Decimal("0.00"))
    large = compute_plans(debts, Decimal("900.00"))
    assert small.baseline.months_to_payoff == large.baseline.months_to_payoff
    assert small.baseline.total_interest_paid == large.baseline.total_interest_paid


def test_empty_portfolio_produces_three_zero_plans():
    plans = compute_plans([], Decimal("100.00"))
    for summary in (plans.snowball, plans.avalanche, plans.baseline):
        assert summary.months_to_payoff == 0
        assert summary.total_interest_paid == ZERO
    assert plans.interest_saved_avalanche_vs_snowball == ZERO
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/engine/test_plans.py -v`
Expected: FAIL — `ImportError: cannot import name 'compute_plans' from 'app.engine.plans'`

- [ ] **Step 3: Append to `backend/app/engine/plans.py`**

Add these imports to the top of the file:

```python
from .minimums import declining_minimum, fixed_minimum
from .models import PlanComparison
from .ordering import avalanche_order, snowball_order
from .simulator import simulate
```

Then append:

```python
def _interest_delta(worse: PlanSummary, better: PlanSummary) -> Decimal | None:
    """How much interest ``better`` saves against ``worse``.

    ``None`` when either side never pays off: you cannot subtract from a plan
    with no end.
    """
    if worse.outcome is not Outcome.PAID_OFF or better.outcome is not Outcome.PAID_OFF:
        return None
    return worse.total_interest_paid - better.total_interest_paid


def _months_delta(worse: PlanSummary, better: PlanSummary) -> int | None:
    if worse.months_to_payoff is None or better.months_to_payoff is None:
        return None
    return worse.months_to_payoff - better.months_to_payoff


def compute_plans(debts: Sequence[Debt], extra_payment: Decimal) -> PlanComparison:
    """Run all three scenarios and precompute every comparison.

    The deltas exist so the AI layer never performs arithmetic: every number
    that could appear in a generated sentence is already a field here.
    """
    snowball = summarize(
        simulate(debts, extra_payment, snowball_order, fixed_minimum),
        debts,
        Strategy.SNOWBALL,
    )
    avalanche = summarize(
        simulate(debts, extra_payment, avalanche_order, fixed_minimum),
        debts,
        Strategy.AVALANCHE,
    )
    # The baseline takes no extra payment and does not roll over freed
    # minimums: "do nothing differently" means that money is spent elsewhere.
    baseline = summarize(
        simulate(debts, ZERO, snowball_order, declining_minimum, rollover=False),
        debts,
        Strategy.MINIMUM_ONLY,
    )

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
```

- [ ] **Step 4: Write `backend/app/engine/__init__.py`**

```python
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
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend && .venv/bin/pytest tests/engine -v`
Expected: PASS, all suites green

- [ ] **Step 6: Commit**

```bash
git add backend/app/engine/plans.py backend/app/engine/__init__.py backend/tests/engine/test_plans.py
git commit -m "feat(engine): add compute_plans with precomputed comparison deltas"
```

---

### Task 12: Golden fixtures

**Files:**
- Create: `backend/tests/engine/test_golden.py`

**Interfaces:**
- Consumes: `compute_plans`, `simulate`, `summarize`.
- Produces: nothing — tests only.

Two of these tables were computed by hand, cell by cell, and the arithmetic is
shown in the comments so a reviewer can re-check it without running the code.

**On the snowball-vs-avalanche divergence case:** it asserts payoff *order*,
the interest inequality, and conservation rather than a full month-by-month
table. Hand-transcribing 20-plus months of two-debt amortization is precisely
where a transcription error gets frozen as "golden truth", which is worse than
having no golden at all. The arithmetic across long multi-debt runs is covered
instead by Task 13's invariants and Task 14's closed-form oracle, which check
thousands of cases rather than one.

- [ ] **Step 1: Write the tests**

Create `backend/tests/engine/test_golden.py`:

```python
"""Golden fixtures, computed independently of the implementation.

Invariants prove internal consistency; these prove external correctness. An
engine that divided APR by 24 instead of 12 would satisfy every invariant
perfectly while being uniformly wrong — only a hand-computed expected value
catches that.
"""

from decimal import Decimal

from app.engine.minimums import fixed_minimum
from app.engine.models import Debt, Outcome, Strategy
from app.engine.ordering import avalanche_order, snowball_order
from app.engine.plans import compute_plans, summarize
from app.engine.simulator import ZERO, simulate


def debt(id_, balance, apr, minimum) -> Debt:
    return Debt(
        id=id_,
        name=f"Card {id_}",
        balance=Decimal(balance),
        apr=Decimal(apr),
        minimum_payment=Decimal(minimum),
    )


def rows_by_id(month):
    return {row.debt_id: row for row in month.debts}


def test_golden_single_debt_with_interest():
    # $100.00 at 12.00% APR -> 1.00% per month. Minimum $50.00, no extra.
    #
    # month | start  | interest | payment | end
    #   1   | 100.00 |   1.00   |  50.00  | 51.00
    #   2   |  51.00 |   0.51   |  50.00  |  1.51
    #   3   |   1.51 |   0.02   |   1.53  |  0.00
    #
    # interest: 1.00 + 0.51 + 0.02 = 1.53
    # payments: 50.00 + 50.00 + 1.53 = 101.53 = 100.00 + 1.53
    schedule = simulate(
        [debt("a", "100.00", "12.00", "50.00")], ZERO, snowball_order, fixed_minimum
    )
    expected = [
        (Decimal("100.00"), Decimal("1.00"), Decimal("50.00"), Decimal("51.00")),
        (Decimal("51.00"), Decimal("0.51"), Decimal("50.00"), Decimal("1.51")),
        (Decimal("1.51"), Decimal("0.02"), Decimal("1.53"), Decimal("0.00")),
    ]
    assert len(schedule.months) == len(expected)
    for month, (start, interest, payment, end) in zip(schedule.months, expected):
        row = month.debts[0]
        assert (row.starting_balance, row.interest_charged) == (start, interest)
        assert (row.payment_applied, row.ending_balance) == (payment, end)


def test_golden_two_debts_with_rollover():
    # a: $100.00 @ 0%, min $50.00     b: $200.00 @ 0%, min $50.00
    # Constant outlay: 50 + 50 = $100.00 every month.
    #
    # month | a start | a pay | a end | b start | b pay | b end
    #   1   | 100.00  | 50.00 | 50.00 | 200.00  | 50.00 | 150.00
    #   2   |  50.00  | 50.00 |  0.00 | 150.00  | 50.00 | 100.00
    #   3   |    --   |   --  |   --  | 100.00  |100.00 |   0.00
    #
    # In month 3, a is gone and its freed $50 minimum joins b's own $50.
    debts = [debt("a", "100.00", "0.00", "50.00"), debt("b", "200.00", "0.00", "50.00")]
    schedule = simulate(debts, ZERO, snowball_order, fixed_minimum)

    assert len(schedule.months) == 3
    for month in schedule.months:
        assert month.total_payment == Decimal("100.00")
        assert month.total_interest == ZERO

    m1, m2, m3 = schedule.months
    assert rows_by_id(m1)["a"].ending_balance == Decimal("50.00")
    assert rows_by_id(m1)["b"].ending_balance == Decimal("150.00")
    assert rows_by_id(m2)["a"].ending_balance == ZERO
    assert rows_by_id(m2)["b"].ending_balance == Decimal("100.00")
    assert "a" not in rows_by_id(m3)
    assert rows_by_id(m3)["b"].payment_applied == Decimal("100.00")
    assert rows_by_id(m3)["b"].ending_balance == ZERO


def test_golden_negative_amortization():
    # $1,000.00 at 24.00% APR accrues $20.00/month against a $10.00 minimum.
    # Month 1 ends at 1000.00 + 20.00 - 10.00 = 1010.00, above where it began,
    # so no later month can do better.
    schedule = simulate(
        [debt("a", "1000.00", "24.00", "10.00")], ZERO, snowball_order, fixed_minimum
    )
    assert schedule.outcome is Outcome.NEVER_PAYS_OFF
    assert schedule.underwater_debt_ids == ("a",)
    assert len(schedule.months) == 1
    row = schedule.months[0].debts[0]
    assert row.interest_charged == Decimal("20.00")
    assert row.payment_applied == Decimal("10.00")
    assert row.ending_balance == Decimal("1010.00")


def test_golden_strategies_diverge_in_payoff_order():
    # a: small balance, cheap.  b: large balance, expensive.
    # Snowball must clear a first; avalanche must clear b first; and avalanche
    # must not cost more interest.
    debts = [debt("a", "500.00", "5.00", "25.00"), debt("b", "2000.00", "25.00", "50.00")]
    plans = compute_plans(debts, Decimal("200.00"))

    assert [p.debt_id for p in plans.snowball.debt_payoffs] == ["a", "b"]
    assert [p.debt_id for p in plans.avalanche.debt_payoffs] == ["b", "a"]
    assert plans.avalanche.total_interest_paid <= plans.snowball.total_interest_paid
    assert plans.interest_saved_avalanche_vs_snowball >= ZERO


def test_golden_divergent_run_conserves_money():
    debts = [debt("a", "500.00", "5.00", "25.00"), debt("b", "2000.00", "25.00", "50.00")]
    for order_fn, strategy in (
        (snowball_order, Strategy.SNOWBALL),
        (avalanche_order, Strategy.AVALANCHE),
    ):
        schedule = simulate(debts, Decimal("200.00"), order_fn, fixed_minimum)
        summary = summarize(schedule, debts, strategy)
        assert summary.total_paid == Decimal("2500.00") + summary.total_interest_paid
```

- [ ] **Step 2: Run the tests**

Run: `cd backend && .venv/bin/pytest tests/engine/test_golden.py -v`
Expected: PASS, 5 tests

- [ ] **Step 3: Commit**

```bash
git add backend/tests/engine/test_golden.py
git commit -m "test(engine): add hand-computed golden fixtures"
```

---

### Task 13: Property-based invariants

**Files:**
- Create: `backend/tests/engine/test_properties.py`

**Interfaces:**
- Consumes: `compute_plans`, `simulate`, both seams.
- Produces: nothing — tests only.

- [ ] **Step 1: Write the tests**

Create `backend/tests/engine/test_properties.py`:

```python
"""Invariants that must hold for every input.

These prove internal consistency. They cannot catch a wrong premise — see
test_golden.py for that, and test_oracle.py for an independent derivation.
"""

import random
from decimal import Decimal

from hypothesis import given, settings
from hypothesis import strategies as st

from app.engine.minimums import declining_minimum, fixed_minimum
from app.engine.models import Debt, Outcome
from app.engine.ordering import avalanche_order, snowball_order
from app.engine.plans import compute_plans
from app.engine.simulator import ZERO, simulate

SLOW = settings(max_examples=100, deadline=None)


@st.composite
def portfolios(draw):
    count = draw(st.integers(min_value=1, max_value=5))
    debts = []
    for i in range(count):
        debts.append(
            Debt(
                id=f"d{i}",
                name=f"Debt {i}",
                balance=draw(
                    st.decimals(
                        min_value=Decimal("1.00"),
                        max_value=Decimal("50000.00"),
                        places=2,
                    )
                ),
                apr=draw(
                    st.decimals(
                        min_value=Decimal("0.00"),
                        max_value=Decimal("35.00"),
                        places=2,
                    )
                ),
                minimum_payment=draw(
                    st.decimals(
                        min_value=Decimal("0.00"),
                        max_value=Decimal("500.00"),
                        places=2,
                    )
                ),
            )
        )
    extra = draw(
        st.decimals(min_value=Decimal("0.00"), max_value=Decimal("2000.00"), places=2)
    )
    return debts, extra


def totals(schedule):
    paid = sum((m.total_payment for m in schedule.months), ZERO)
    interest = sum((m.total_interest for m in schedule.months), ZERO)
    remaining = schedule.months[-1].remaining_balance if schedule.months else ZERO
    return paid, interest, remaining


@given(portfolios())
@SLOW
def test_money_is_conserved(portfolio):
    # Stated with the remainder so it holds for NEVER_PAYS_OFF runs too.
    debts, extra = portfolio
    schedule = simulate(debts, extra, avalanche_order, fixed_minimum)
    paid, interest, remaining = totals(schedule)
    assert paid + remaining == sum((d.balance for d in debts), ZERO) + interest


@given(portfolios())
@SLOW
def test_balances_are_never_negative(portfolio):
    debts, extra = portfolio
    schedule = simulate(debts, extra, snowball_order, fixed_minimum)
    for month in schedule.months:
        for row in month.debts:
            assert row.ending_balance >= ZERO


@given(portfolios())
@SLOW
def test_every_amount_is_an_exact_cent_value(portfolio):
    debts, extra = portfolio
    schedule = simulate(debts, extra, snowball_order, fixed_minimum)
    for month in schedule.months:
        for row in month.debts:
            for amount in (
                row.starting_balance,
                row.interest_charged,
                row.payment_applied,
                row.ending_balance,
            ):
                assert amount == amount.quantize(Decimal("0.01"))


@given(portfolios())
@SLOW
def test_total_outlay_is_constant_under_rollover(portfolio):
    debts, extra = portfolio
    schedule = simulate(debts, extra, snowball_order, fixed_minimum)
    if schedule.outcome is not Outcome.PAID_OFF or len(schedule.months) < 2:
        return
    expected = sum((d.minimum_payment for d in debts if d.balance > ZERO), ZERO) + extra
    for month in schedule.months[:-1]:
        assert month.total_payment == expected


@given(portfolios())
@SLOW
def test_total_balance_strictly_decreases_when_paid_off(portfolio):
    debts, extra = portfolio
    schedule = simulate(debts, extra, avalanche_order, fixed_minimum)
    if schedule.outcome is not Outcome.PAID_OFF:
        return
    previous = sum((d.balance for d in debts), ZERO)
    for month in schedule.months:
        assert month.remaining_balance < previous
        previous = month.remaining_balance


@given(portfolios())
@SLOW
def test_avalanche_never_costs_more_interest_than_snowball(portfolio):
    debts, extra = portfolio
    plans = compute_plans(debts, extra)
    if Outcome.NEVER_PAYS_OFF in (plans.avalanche.outcome, plans.snowball.outcome):
        return
    # One cent of tolerance: avalanche is optimal in the continuous case, but
    # cent-rounding lets a near-tie invert by a penny.
    assert plans.avalanche.total_interest_paid <= (
        plans.snowball.total_interest_paid + Decimal("0.01")
    )


@given(portfolios())
@SLOW
def test_strategies_beat_the_baseline(portfolio):
    debts, extra = portfolio
    plans = compute_plans(debts, extra)
    if plans.baseline.outcome is not Outcome.PAID_OFF:
        return
    for plan in (plans.snowball, plans.avalanche):
        if plan.outcome is not Outcome.PAID_OFF:
            continue
        assert plan.months_to_payoff <= plans.baseline.months_to_payoff
        assert plan.total_interest_paid <= plans.baseline.total_interest_paid + Decimal("0.01")


@given(portfolios(), st.integers(min_value=0, max_value=10_000))
@SLOW
def test_input_order_does_not_change_the_result(portfolio, seed):
    # The executable guard for the stable-sort determinism bug: without the
    # trailing id tiebreak in ordering.py, this fails on tied debts.
    debts, extra = portfolio
    shuffled = list(debts)
    random.Random(seed).shuffle(shuffled)
    assert compute_plans(debts, extra) == compute_plans(shuffled, extra)


@given(portfolios())
@SLOW
def test_baseline_never_rolls_over_or_uses_the_extra(portfolio):
    debts, extra = portfolio
    with_extra = simulate(debts, extra, snowball_order, declining_minimum, rollover=False)
    without = simulate(debts, ZERO, snowball_order, declining_minimum, rollover=False)
    assert len(with_extra.months) == len(without.months)


@given(portfolios())
@SLOW
def test_simulate_always_terminates_within_the_cap(portfolio):
    debts, extra = portfolio
    schedule = simulate(debts, extra, snowball_order, fixed_minimum)
    assert len(schedule.months) <= 1200
```

- [ ] **Step 2: Run the tests**

Run: `cd backend && .venv/bin/pytest tests/engine/test_properties.py -v`
Expected: PASS, 10 tests

- [ ] **Step 3: Commit**

```bash
git add backend/tests/engine/test_properties.py
git commit -m "test(engine): add property-based invariants including order determinism"
```

---

### Task 14: Closed-form oracle

**Files:**
- Create: `backend/tests/engine/test_oracle.py`

**Interfaces:**
- Consumes: `simulate`, `fixed_minimum`, `snowball_order`, `to_cents`.
- Produces: nothing — tests only.

This is the one place `float` is allowed, deliberately: the point is to check
the simulator against mathematics derived a completely different way.

- [ ] **Step 1: Write the test**

Create `backend/tests/engine/test_oracle.py`:

```python
"""An independent oracle for the single-debt case.

The closed-form amortization formula is derived algebraically, with no
stepping loop anywhere in it. If a month-by-month simulation and an equation
agree across thousands of randomized cases, the monthly accrual model itself
is right — which is the thing golden fixtures can only check at a few points.
"""

import math
from decimal import Decimal

from hypothesis import assume, given, settings
from hypothesis import strategies as st

from app.engine.minimums import fixed_minimum
from app.engine.models import Debt, Outcome
from app.engine.money import to_cents
from app.engine.ordering import snowball_order
from app.engine.simulator import ZERO, simulate


@given(
    balance=st.decimals(
        min_value=Decimal("100.00"), max_value=Decimal("50000.00"), places=2
    ),
    apr=st.decimals(min_value=Decimal("1.00"), max_value=Decimal("35.00"), places=2),
    payment_fraction=st.decimals(
        min_value=Decimal("0.05"), max_value=Decimal("0.50"), places=4
    ),
)
@settings(max_examples=300, deadline=None)
def test_single_debt_matches_the_closed_form(balance, apr, payment_fraction):
    payment = to_cents(balance * payment_fraction)

    rate = float(apr) / 100.0 / 12.0
    principal = float(balance)
    installment = float(payment)

    # The formula only applies while the payment outruns the interest.
    assume(installment > principal * rate * 1.05)

    #   n = -log(1 - r*B/P) / log(1 + r)
    expected_months = -math.log(1 - rate * principal / installment) / math.log(1 + rate)

    schedule = simulate(
        [Debt("a", "Card a", balance, apr, payment)],
        ZERO,
        snowball_order,
        fixed_minimum,
    )

    assert schedule.outcome is Outcome.PAID_OFF
    # One month of slack absorbs cent-level rounding in the simulator.
    assert abs(len(schedule.months) - math.ceil(expected_months)) <= 1


@given(
    balance=st.decimals(
        min_value=Decimal("100.00"), max_value=Decimal("10000.00"), places=2
    ),
    payment=st.decimals(
        min_value=Decimal("25.00"), max_value=Decimal("500.00"), places=2
    ),
)
@settings(max_examples=100, deadline=None)
def test_zero_apr_takes_exactly_ceil_balance_over_payment(balance, payment):
    # With no interest the answer needs no calculus at all.
    schedule = simulate(
        [Debt("a", "Card a", balance, Decimal("0.00"), payment)],
        ZERO,
        snowball_order,
        fixed_minimum,
    )
    expected = math.ceil(balance / payment)
    assert len(schedule.months) == expected
```

- [ ] **Step 2: Run the test**

Run: `cd backend && .venv/bin/pytest tests/engine/test_oracle.py -v`
Expected: PASS, 2 tests

- [ ] **Step 3: Commit**

```bash
git add backend/tests/engine/test_oracle.py
git commit -m "test(engine): cross-check the simulator against the closed-form solution"
```

---

### Task 15: Enforce coverage and wire up CI

**Files:**
- Modify: `backend/pyproject.toml`
- Create: `.github/workflows/backend.yml`

**Interfaces:**
- Consumes: the full test suite.
- Produces: a failing build when engine coverage drops below 100%.

- [ ] **Step 1: Add coverage enforcement to `backend/pyproject.toml`**

Replace the `[tool.pytest.ini_options]` and `[tool.coverage.run]` blocks with:

```toml
[tool.pytest.ini_options]
testpaths = ["tests"]
pythonpath = ["."]
addopts = "--cov=app.engine --cov-report=term-missing --cov-fail-under=100"

[tool.coverage.run]
source = ["app/engine"]
branch = true

[tool.coverage.report]
show_missing = true
exclude_lines = ["if TYPE_CHECKING:"]
```

- [ ] **Step 2: Run the full suite and confirm coverage passes**

Run: `cd backend && .venv/bin/pytest`
Expected: PASS, with `TOTAL ... 100%`. If any line is uncovered, add a test for it — do not add a `# pragma: no cover`.

- [ ] **Step 3: Create `.github/workflows/backend.yml`**

```yaml
name: backend

on:
  push:
    branches: [main]
  pull_request:

jobs:
  engine:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: backend
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - name: Install
        run: pip install -e ".[dev]"
      - name: Test with coverage gate
        run: pytest
```

- [ ] **Step 4: Verify the gate actually bites**

Temporarily add an unreachable branch to `backend/app/engine/money.py`:

```python
def _unused(value: Decimal) -> Decimal:
    return value
```

Run: `cd backend && .venv/bin/pytest`
Expected: FAIL with `Coverage failure: total of 99% is less than fail-under=100`

Then delete `_unused` and re-run to confirm PASS. A coverage gate nobody has
seen fail is a coverage gate nobody knows is wired up.

- [ ] **Step 5: Commit**

```bash
git add backend/pyproject.toml .github/workflows/backend.yml
git commit -m "ci(engine): enforce 100% engine coverage in CI"
```

---

## Self-Review

**Spec coverage.** Every section maps to a task:

| Spec section | Task |
|---|---|
| §3.1 monthly accrual, swappable seam | 3 |
| §3.2 fixed and declining minimums, zero-minimum rule | 4 |
| §3.3 rollover as its own axis | 8 |
| §3.4 Decimal, ROUND_HALF_UP, no global context | 1, 2 |
| §3.5 truncated final payments, within-month cascade | 7, 8 |
| §3.6 no dates, 1-based indices | 7 (indices), API layer (dates, out of scope) |
| §4 module layout and four seams | 1–11 |
| §5 data model, comparison deltas, output layering | 2, 6, 10, 11 |
| §6 monthly loop, termination, never-pays-off as result | 7, 8, 9 |
| §7 validation table, total ordering | 2, 5, 7, 9 |
| §8 four test layers, coverage, no mocks | 12, 13, 14, 15 |
| §9 consumer-facing consequences | Documented; no engine work |
| §10 deferred features | Deliberately not built |

**One deliberate omission.** Spec §6 mentions a "cheap pre-flight" that flags a
doomed debt before the loop starts, when its implied percentage sits below its
monthly rate. This plan does not implement it. The no-progress check already
catches that case in month 1 — a single loop iteration, microseconds — so a
pre-flight would be a *second* implementation of the same decision, in a
codebase whose central argument is that the arithmetic should have exactly one
home. Two detectors that must agree is a worse failure mode than one detector
that runs one iteration longer. **Amend spec §6 to record this** before or
during implementation.

**Placeholder scan.** No "TBD", no "add error handling", no "similar to Task
N". Every code step carries runnable code; every test step carries real
assertions with expected values.

**Type consistency.** Verified across tasks: `to_cents` (1) is used unchanged
in 2, 3, 4, 14. `Debt` (2) is consumed by 4, 5, 7, 10. `order_fn(debts,
balances)` is defined in 5 and called with `starting` in 8. `minimum_rule(debt,
balance)` is defined in 4 and called in 7. `Schedule(months, outcome,
underwater_debt_ids)` is defined in 6, constructed in 7 and 9, consumed in 10.
`summarize(schedule, debts, strategy)` is defined in 10 and called in 11.
`ZERO` is defined in 7 and imported by 10, 12, 13, 14.
