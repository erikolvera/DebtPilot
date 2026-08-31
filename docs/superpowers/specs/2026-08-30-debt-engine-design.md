# Debt payoff engine — design

**Date:** 2026-08-30
**Status:** Approved, ready for implementation planning
**Scope:** The deterministic debt payoff engine only. No API, no persistence,
no AI layer, no UI.

## 1. Purpose

The engine computes every number the product shows a user: balances, interest,
months to payoff, and total interest paid, for three scenarios — snowball,
avalanche, and a minimums-only baseline. It is a pure Python package with no
framework dependencies, no network calls, no clock access, and no knowledge
that users or databases exist.

It is built first and in isolation because a wrong number here is a real
financial mistake for a user, not a cosmetic bug. Everything downstream — the
API, the AI guidance layer, the UI — consumes its output and adds no
arithmetic of its own.

## 2. Non-goals

- Daily interest compounding (the accrual seam allows it later).
- Calendar dates. The engine speaks in month indices; the API converts.
- Persistence, serialization, or Pydantic schemas.
- Solving for a required extra payment. See section 10.
- Debt types other than credit cards. The model is general enough that adding
  them requires no engine change.

## 3. Settled decisions

Six decisions were made during design. Do not relitigate them during
implementation. If one proves wrong, amend this document and `CLAUDE.md`
first.

### 3.1 Monthly accrual, interest before payment

One simulation step is one month. Interest for the month is
`balance * (apr / 100 / 12)`, charged first, then the payment posts.

This is the standard consumer-calculator model. It slightly understates
interest versus real daily compounding: at a 24% APR, monthly compounding
yields a 26.82% effective annual rate against 27.12% for daily. The
consequence is a product requirement, not just an engine note — user-facing
copy must say "estimated" rather than implying to-the-penny precision.

The calculation lives alone in `interest.py` so daily compounding can replace
it without touching the simulation loop.

### 3.2 Fixed minimums for strategies, declining minimums for the baseline

Snowball and avalanche use the stored `minimum_payment` unchanged. This is
safe because the total monthly outlay is held constant for the whole payoff,
so a shrinking real-world minimum would only free cash that the model already
directs at the target debt.

The minimums-only baseline instead recomputes each month as
`max(floor, implied_pct * balance)`, where `floor = min($25, stored_minimum)`
and `implied_pct` is derived once at month zero as
`stored_minimum / starting_balance`. This requires no additional user input,
which matters because users do not know their card's minimum payment formula.

If `stored_minimum` is zero, the declining minimum is zero as well. More
generally, the floor is $25 or the user's own stored minimum, whichever is
smaller, so it can never exceed what the user actually pays. The floor must
not manufacture a payment the user never had, and letting it do so would
contradict section 7, where a zero minimum is explicitly left to the
no-progress check.

The baseline exists because it is the only scenario that answers "why should I
bother?" — and modeling its minimums as fixed would make it wildly too
optimistic, understating the exact gap the product exists to show.

### 3.3 Rollover is a separate axis

Snowball and avalanche keep a cleared debt's minimum in the budget and aim it
at the next debt. The baseline must not: "do nothing differently" means that
freed money is spent elsewhere. This is a `rollover: bool` parameter on
`simulate`, not a property of the minimum-payment rule.

### 3.4 Decimal money, quantized at every step

`Decimal` throughout, quantized to cents at every step, with `ROUND_HALF_UP`
passed explicitly at each call site. Floats are not acceptable anywhere in the
engine.

Rationale for quantizing at each step rather than carrying full precision:
real lenders round interest to the cent monthly, so per-step quantization
reproduces actual account behavior rather than introducing error. It also
eliminates a bug class outright — every balance is an exact cent value, so
"paid off" is exactly `balance == 0` with no epsilon comparison and no
sub-cent remainder keeping a debt alive for a phantom month.

The global decimal context must never be mutated. `getcontext().rounding = ...`
is process-wide state, and a library must not change rounding behavior for the
rest of the backend.

### 3.5 Final payments are truncated

The last payment against a debt is exactly its remaining balance, never the
full scheduled amount. The freed remainder cascades to the next debt in the
same month. Without this, balances go negative and `total_interest_paid` is
quietly wrong.

The cascade applies under `rollover=False` as well. Strictly, "no rollover"
argues against it, but suppressing it requires a special case in the hot path
to reclaim roughly $250 across a 340-month, 5-debt baseline whose total runs
to six figures. Not worth the branch.

### 3.6 No dates in the engine

The engine speaks only in 1-based month indices. This keeps it a pure function
with no hidden clock input, which is what makes the determinism requirement
enforceable: the same arguments produce the same output forever, and a test
written today cannot start failing in March.

The API layer converts indices to calendar dates, using two conventions:
- Month 1 is the first month a payment is made, not the current month.
- `payoff_date = start_month + (months_to_payoff - 1)`. The `- 1` is the
  off-by-one worth pinning down in a test.
- `payoff_date` is the first day of the month the final payment lands in.

## 4. Architecture

One parameterized simulator with four seams. Snowball and avalanche differ by
exactly one sort key, so the arithmetic has exactly one home. Duplicating the
loop per strategy would create three independent places for a rounding bug to
live and a near-certainty that a fix lands in only two of them.

```python
simulate(debts, extra_payment, order_fn, minimum_rule, rollover=True) -> Schedule

snowball  = simulate(debts, extra, order_by_smallest_balance, fixed_minimum)
avalanche = simulate(debts, extra, order_by_highest_apr,      fixed_minimum)
baseline  = simulate(debts, 0, order_by_smallest_balance, declining_minimum,
                     rollover=False)
```

### Module layout

```
backend/app/engine/
  models.py      Debt, DebtMonth, Month, Schedule, DebtPayoff,
                 PlanSummary, PlanComparison, Outcome, Strategy
  interest.py    monthly_interest(balance, apr)      <- accrual seam
  minimums.py    fixed_minimum / declining_minimum   <- minimum-rule seam
  ordering.py    snowball_order / avalanche_order    <- strategy seam
  simulator.py   simulate(...) -> Schedule           <- the single month loop
  plans.py       compute_plans(debts, extra) -> PlanComparison
  errors.py      InvalidDebt
```

## 5. Data model

Frozen dataclasses, tuples rather than lists. A computed plan is a value;
nothing downstream should be able to mutate a result it was handed. No
Pydantic and no FastAPI imports inside the package — Pydantic lives at the API
boundary, which keeps the engine testable with no app context.

### Input

```python
@dataclass(frozen=True)
class Debt:
    id: str
    name: str
    balance: Decimal          # exact cents, >= 0
    apr: Decimal              # percent, e.g. Decimal("24.99")
    minimum_payment: Decimal  # exact cents, >= 0
```

Deliberately no `user_id`, `type`, or timestamps. The engine does not know
users exist. APR is stored as a percent to match `numeric(5,2)`; the `/100`
conversion happens only in `interest.py`.

### Simulation record

```python
@dataclass(frozen=True)
class DebtMonth:
    debt_id: str
    starting_balance: Decimal
    interest_charged: Decimal
    payment_applied: Decimal
    ending_balance: Decimal

@dataclass(frozen=True)
class Month:
    index: int                      # 1-based; month 1 = first payment
    debts: tuple[DebtMonth, ...]
    total_payment: Decimal
    total_interest: Decimal
    remaining_balance: Decimal

@dataclass(frozen=True)
class Schedule:
    months: tuple[Month, ...]
    outcome: Outcome
    underwater_debt_ids: tuple[str, ...]   # empty unless NEVER_PAYS_OFF
```

`simulate` returns a `Schedule`, so the schedule itself must carry how the run
ended. `plans.py` folds a `Schedule` into a `PlanSummary`: `months_to_payoff`
is `len(months)` (or `None`), `total_interest_paid` is the sum over months,
and `debt_payoffs` is read off the month each debt's balance first reaches
zero.

### Summary

```python
class Strategy(Enum):
    SNOWBALL = "snowball"
    AVALANCHE = "avalanche"
    MINIMUM_ONLY = "minimum_only"

class Outcome(Enum):
    PAID_OFF = "paid_off"
    NEVER_PAYS_OFF = "never_pays_off"

@dataclass(frozen=True)
class MonthlyTotal:
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
    strategy: Strategy
    outcome: Outcome
    months_to_payoff: int | None            # None when NEVER_PAYS_OFF
    underwater_debt_ids: tuple[str, ...]
    total_interest_paid: Decimal
    total_paid: Decimal
    debt_payoffs: tuple[DebtPayoff, ...]    # in the order they clear
    monthly_totals: tuple[MonthlyTotal, ...]
```

`total_paid` is principal plus interest — the sum of every `payment_applied`
across the run, not the budgeted amount.

### Comparison

```python
@dataclass(frozen=True)
class PlanComparison:
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

Verbose on purpose. This is the object handed to the AI layer, and it encodes
a hard architectural constraint: **every number that could appear in a
sentence the AI writes must already exist as a field here.** A claim like
"avalanche saves you $3,140 and 7 months" is subtraction, and an LLM doing
subtraction on dollar figures in a prompt is exactly where a confident wrong
number is born. The prompt says "describe these figures," never "work out the
difference."

Deltas are nullable because you cannot subtract from a plan that never pays
off.

### Output layering

The engine always builds the full `Schedule`. It is effectively free — a
5-debt, 30-year run is roughly 1,800 trivial arithmetic operations, under a
millisecond — and it makes any month of any debt assertable in tests, which is
what you want in financially load-bearing code.

The API serializes `PlanSummary` plus `monthly_totals` by default, and the
full per-debt grid only on `?detail=full`. This matters because a
minimums-only baseline can run past 300 months: serializing all three
schedules in full would produce a multi-hundred-kilobyte response the UI
mostly discards.

## 6. The monthly loop

```
1. active = debts with balance > 0        -> if empty, done
2. accrue:   interest = quantize(balance * apr/100/12);  balance += interest
3. scheduled[d] = minimum_rule(d)                 # owed on paper
   required[d]  = min(scheduled[d], balance[d])   # actually payable
4. budget = sum(scheduled) + extra + freed_pool
5. apply required[d] to each active debt
6. surplus = budget - sum(required)
   for d in order_fn(active):             # cascades onward if a debt clears
       pay = min(surplus, balance[d]); apply; surplus -= pay
7. cleared debts add their scheduled minimum to freed_pool  (if rollover)
```

**Budget is computed from `scheduled`, not `required`.** This is the subtle
line. The difference between the two is precisely the final-payment truncation
remainder: in the month a $2,000 card has only $340 left against a $50
minimum, that spare money lands in `surplus` and cascades within the same
month. Compute the budget from `required` instead and it silently evaporates,
stretching every payoff by a fraction of a month per debt.

For snowball and avalanche this formula holds the total monthly outlay exactly
constant at `sum(initial minimums) + extra` for the entire run. The invariant
is therefore a consequence of the formula rather than a rule to remember, and
it is the single best assertion in the test suite.

### Termination

A hang is the worst possible failure mode here, so there are two mechanisms:

1. **No-progress check.** If a month ends with total balance at or above where
   it started, no later month can do better — the budget is fixed while
   interest compounds. Emit `NEVER_PAYS_OFF` with the offending debt ids.
2. **Hard cap.** `MAX_MONTHS = 1200` (100 years) as a backstop, producing the
   same outcome.

A cheap pre-flight covers the obvious case: under `declining_minimum`, a debt
is doomed from month zero when its implied percentage is below its monthly
rate, since both sides scale linearly with balance and the ratio never moves.

### Never-pays-off is a result, not an exception

Negative amortization is a legitimate answer to a valid question, not a
failure. A user whose avalanche plan clears in four years but who would never
escape on minimums alone needs to be told exactly that — and if the baseline
raised, the whole request would fail and they would see nothing, despite the
engine having just computed the most important sentence the product could say
to them.

`errors.py` therefore contains only `InvalidDebt`, which is a genuine "I
cannot answer your question" case.

## 7. Validation and edge cases

`InvalidDebt` is raised for negative `balance`, `apr`, or `minimum_payment`; a
negative `extra_payment`; and duplicate debt ids, which would corrupt
per-debt keying.

Everything else is accepted and handled:

| Input | Behavior |
|---|---|
| Sub-cent precision (`100.005`) | Quantized on ingest, not rejected |
| `balance == 0` | Accepted, excluded from simulation — a zeroed card is legitimate |
| `minimum_payment == 0` on a live balance | Accepted; the no-progress check catches it |
| `minimum_payment > balance` | Fine; truncation already covers it |
| Empty debt list | Empty `Schedule`, `months_to_payoff = 0`. Not an error — "no debts yet" is the normal state of a new account, and raising forces every caller to special-case it |
| 0% APR promo card | Accrues nothing, sorts last under avalanche |
| Every debt at 0% APR | Strategies tie, all deltas are zero. The AI layer must say they are equivalent rather than invent a preference |
| Extra payment exceeds total debt | Everything clears in month 1; unspent surplus is simply not paid, and `total_paid` reflects reality |
| $0.01 balance | Accrued interest quantizes to `0.00`, so no immortal fractional debt |

### Ordering must be total, not merely stable

- **Avalanche:** highest APR, then smallest balance, then `id`
- **Snowball:** smallest balance, then highest APR, then `id`

The trailing `id` tiebreak is not pedantry. Python's sort is stable, so
without it the ordering silently inherits input order, and the same debts
submitted in a different sequence produce a different per-debt payoff order.
Totals would match, but the plan shown to the user would flip between requests
for no visible reason — a determinism violation that unit tests built on a
fixed list structurally cannot catch.

## 8. Test strategy

Implementation is test-driven: red, green, refactor, with engine tests written
before any consumer of the engine exists.

The guiding distinction: **invariants prove internal consistency; golden
fixtures prove external correctness.** An engine that divides APR by 24
instead of 12 satisfies every invariant flawlessly — money still balances,
totals stay constant, avalanche still beats snowball — while every number is
uniformly wrong. Property tests cannot catch that class of bug, because the
error is in the premise rather than the bookkeeping. Both layers are required.

### Layer 1 — Invariants, property-based via Hypothesis

Generate random portfolios; assert what must hold for every input.

| Invariant | Catches |
|---|---|
| `sum(payments) + final remaining balance == sum(initial balances) + sum(interest)` | Nearly every arithmetic bug; no dollar created or destroyed. Stated with the remainder so it holds for `NEVER_PAYS_OFF` runs too |
| Under `rollover=True`, each month's `total_payment` equals `sum(initial minimums) + extra`, except the last | Budget and rollover errors |
| Total remaining balance strictly decreases each month when `PAID_OFF` | Stalls and phantom months |
| No balance is ever negative | Missing final-payment truncation |
| Every balance is an exact cent multiple | Rounding leaks |
| `avalanche.total_interest <= snowball.total_interest` | Ordering wired backwards |
| When all three runs are `PAID_OFF`, both strategies land at or below baseline in interest and months | Baseline misconfiguration |
| Shuffling the input list produces identical output | The stable-sort determinism bug in section 7 |

Note: per-debt balances are *not* monotonically decreasing. Under fixed
minimums, a low-priority debt whose minimum is below its interest will grow
while the target debt is attacked. Only the total is monotonic.

Note: `avalanche <= snowball` is mathematically true in the continuous case,
but cent-rounding makes near-ties theoretically capable of inverting by a
penny. If it flakes, apply a one-cent tolerance rather than dropping the
property.

### Layer 2 — Golden fixtures

Three scenarios minimum, each computed independently — by spreadsheet or by
hand, never by running the engine and pasting its output — with the full
month-by-month table asserted cell by cell:

1. Single debt, single strategy: the arithmetic baseline.
2. Three debts where snowball and avalanche visibly diverge in payoff order.
3. A negative-amortization portfolio returning `NEVER_PAYS_OFF`.

Independence is the whole point. A fixture generated from the implementation
only proves the code has not changed, not that it was ever right; it locks in
bugs rather than catching them.

### Layer 3 — An independent oracle

For a single debt at a fixed payment, a closed form exists:

```
n = -log(1 - r*B/P) / log(1 + r)        where r = apr/100/12, and P > r*B
```

It is derived by entirely different mathematics from the simulation loop.
Assert the simulator lands within one month of it across a randomized sweep of
balances, APRs, and payments. Agreement between a stepping loop and an
algebraic formula across thousands of cases validates the monthly accrual
model itself — the thing golden fixtures verify at only three points.

### Layer 4 — Seams and edge cases

Small and fast. Every row of the section 7 table gets a named test. The three
seam modules are trivial pure functions; `ordering` is just sorting and needs
no simulation at all.

### Layout and standards

```
backend/tests/engine/
  test_interest.py     test_minimums.py    test_ordering.py
  test_simulator.py    test_plans.py
  test_properties.py   test_golden.py      fixtures/
```

- **100% line coverage on `app/engine/`, enforced in CI.** Normally a vanity
  metric; here the package is small, pure, and financially load-bearing, so it
  is both achievable and meaningful.
- **No mocks.** Pure functions with injected seams need none. If a test seems
  to want one, the boundary is wrong.

## 9. Consumer-facing consequences

Three engine decisions impose requirements outside the engine, recorded here
so they are not lost:

1. Monthly accrual understates interest slightly, so plan figures must be
   presented as estimates.
2. The minimums-only baseline is computed on every request but never written
   to `payoff_plans`. It is derived context for display and for the AI prompt,
   not a plan the user chose — which keeps that table's `strategy` column at
   two values.
3. `NEVER_PAYS_OFF` is a normal response the API and UI must render, not an
   error state.

## 10. Deferred to a later MVP

- **"How much extra would I need?"** When snowball and avalanche also never
  pay off, the natural follow-up is the minimum extra monthly payment that
  clears the debts. That is a solve rather than a simulation, needing a
  different algorithm — most likely a binary search over `simulate`. Out of
  scope for the first version, and the obvious next engine feature.
- Daily interest compounding, dropped in behind the `interest.py` seam.
- Debt types beyond credit cards: auto, student, and personal loans.
