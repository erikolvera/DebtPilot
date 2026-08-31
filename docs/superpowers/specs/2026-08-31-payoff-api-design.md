# Payoff plan API — design

**Date:** 2026-08-31
**Status:** Approved, ready for implementation planning
**Scope:** A stateless HTTP layer over the debt engine. No database, no auth,
no AI layer, no UI.
**Depends on:** `docs/superpowers/specs/2026-08-30-debt-engine-design.md`
(the engine, complete and merged)

## 1. Purpose

Expose the debt engine over HTTP so a frontend can compute and display real
payoff plans. One endpoint does the work: the client posts a list of debts, an
extra monthly payment, and a start month; the response carries all three
scenarios plus every precomputed comparison.

The layer is deliberately stateless. Debts arrive in the request body rather
than from a database, which means this slice has exactly one dependency — the
engine — and needs no Postgres, no Supabase Auth, and no secrets at all.

## 2. Non-goals

Named explicitly, because "the API layer" in `CLAUDE.md` bundles three
independent subsystems and only the first is in scope here.

- Persistence. No `debts` or `payoff_plans` tables, no migrations, no RLS.
- Authentication. No user accounts, no JWT verification.
- The AI layer. `/explain` and `/ask` need prompt and grounding design of
  their own.
- Rate limiting and API keys. The endpoint is bounded by a request-size cap
  (section 6), which is the denial-of-service control this slice needs.

Each is a separate spec. Building the wire format first is what tells us what
actually needs persisting — including whether `payoff_plans`, which currently
stores one strategy per row, matches a response that returns three scenarios.

## 3. Settled decisions

Five decisions were made during design. Do not relitigate them during
implementation; if one proves wrong, amend this document first.

### 3.1 Money crosses the wire as strings

Every monetary field is a JSON string (`"1234.56"`), in requests and
responses alike.

JSON has no decimal type. `JSON.parse("1234.56")` yields an IEEE-754 double,
and `1234.56` is not exactly representable, so accepting bare JSON numbers
would reintroduce floats at the boundary of an engine whose central discipline
is that floats are never acceptable. In practice Pydantic would quantize the
value back and the error would never surface — which is exactly what makes it
worth deciding deliberately: the safety would be coming from a downstream
rounding step, not from the wire format being correct.

This is enforced, not merely documented. A reusable annotated type rejects
non-string input:

```python
def _reject_non_string(v: Any) -> Any:
    if not isinstance(v, str):
        raise ValueError('money must be a JSON string, e.g. "1234.56"')
    return v

Money = Annotated[Decimal, BeforeValidator(_reject_non_string)]
```

A client sending `1234.56` gets a 422 naming the field and the fix. Pydantic v2
serializes `Decimal` to a JSON string on the way out, so responses need no
special handling.

### 3.2 The client supplies the start month, and it is required

`start_month` is a required request field in `YYYY-MM` form.

The engine is date-free so it has no hidden clock input. If the API instead
read `date.today()`, that hidden input would simply move up one layer: the
identical request would return different values depending on when it ran, and
every test would need time frozen.

Required rather than optional-with-a-default is the load-bearing part. An
optional field defaulting to the server clock is not a middle ground — nearly
every caller takes the default, so the impure behavior is what ships, plus an
extra code path. Optional purity is not purity.

It is also more correct. The Next.js client knows the user's local date; a
server in UTC does not. A user in Auckland on September 1st hits a server that
still reads August 31st and gets a plan starting a month early.

The format is `YYYY-MM`, not a full date, because the engine's granularity is
months. Accepting `2026-09-14` would invite the question of whether the day
matters. It does not, and the type should say so.

### 3.3 Response shape: scenarios keyed, deltas grouped

```json
{ "start_month": "2026-09",
  "scenarios": { "snowball": {}, "avalanche": {}, "baseline": {} },
  "comparison": { }
}
```

Two consumers pull in opposite directions. The frontend wants something
convenient to render; the AI layer needs every number it is permitted to state
present as a field, because the architecture rule forbids it from computing
even a subtraction. The rule wins: a delta the response omits is a delta the
model will compute in prose, which is the exact failure the engine/AI split
exists to prevent. All six deltas appear, nullable exactly where the engine
makes them nullable, and grouping them under `comparison` means the prompt can
be handed that object wholesale.

`scenarios` has three explicitly named fields rather than a
`dict[str, ScenarioOut]`, which OpenAPI would type as an open map, losing the
generated client's guarantee that exactly these three always exist.

An array of scenarios was considered and rejected: `scenarios.avalanche` is
typed and direct, while an array forces
`.find(s => s.strategy === "avalanche")` and a possibly-undefined result at
every call site.

### 3.4 snake_case end to end

Field names match the engine's exactly. The frontend's types are generated
from the OpenAPI schema rather than hand-written, so no one types these names
by hand, and one convention end to end beats a translation layer that can
silently drop a field.

### 3.5 An explicit mapper, not automatic serialization

Pydantic schemas are written by hand and a mapper converts engine dataclasses
into them. Pydantic's `from_attributes` reading the dataclasses directly was
considered and rejected, as was moving Pydantic into the engine.

The two type sets are not duplication. They are an internal representation and
a published contract that happen to look alike today. Couple them and renaming
an engine field becomes a silent breaking API change, shipped without anyone
reviewing it as one. The second copy is what makes such a rename appear as a
diff in a file whose entire job is recording what was promised. It also keeps
the engine's "no framework imports" guarantee intact, per `CLAUDE.md`.

The mapper is where the one genuinely new piece of logic lives: converting
month indices to calendar months.

## 4. Architecture

```
backend/app/
  engine/                   (untouched)
  api/
    main.py                 app factory, CORS, exception handlers
    schemas.py              Pydantic request and response models
    dates.py                YYYY-MM arithmetic
    mappers.py              PlanComparison -> response model
    routers/
      payoff_plans.py       POST /v1/payoff-plans
backend/tests/api/
```

The route handler validates, calls the engine, and maps. Nothing else; it
should land near ten lines, which is the right size for plumbing.

On the default path it calls `compute_plans`. On the `detail=full` path it
calls `compute_schedules` and `summarize_schedules` instead, which run the same
three scenarios but keep the per-debt grids that `compute_plans` discards.
Either path simulates three times, never six. Those two functions were added to
the engine for this purpose: `PlanSummary` carries `monthly_totals` but not the
per-debt rows, so the detailed response could not otherwise be built.

Route handlers are declared `def`, not `async def`. The engine is CPU-bound
pure Python, so a plain `def` makes FastAPI run it in a threadpool instead of
blocking the event loop. At sub-100ms this is nearly academic, but it is free,
and `async def` wrapped around blocking CPU work is the classic FastAPI
performance bug.

## 5. Endpoints

### `POST /v1/payoff-plans`

Accepts a portfolio, returns all three scenarios and the comparison.

The optional query parameter `detail` is typed `Literal["full"] | None`.
Omitted, each scenario's `schedule` is `null`; `detail=full` populates it with
the per-debt month-by-month grid. Any other value is a 422 rather than a
silently ignored typo — `?detail=fill` must not quietly return a summary.

The default omits that schedule. A minimums-only baseline can run past 300
months, so serializing all three full schedules would produce a
multi-hundred-kilobyte response the UI mostly discards.

### `GET /health`

Returns `{"status": "ok"}`. Render's health checks need it, and it is the
fastest way to distinguish "the deploy is broken" from "the engine is broken."

### Versioning

All application routes sit under `/v1` from the first commit. It costs one
line now; retrofitting it after a frontend ships costs a coordinated deploy of
both halves.

## 6. Request schema

```python
class DebtIn(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=120)
    balance: Money = Field(ge=0)
    apr: Money = Field(ge=0, le=Decimal("999.99"))
    minimum_payment: Money = Field(ge=0)

class PayoffPlanRequest(BaseModel):
    debts: list[DebtIn] = Field(max_length=50)
    extra_monthly_payment: Money = Field(ge=0)
    start_month: str = Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")
```

`id` is client-supplied and required: it is how a client matches results back
to its own rows, and the response references debts by it.

An empty `debts` list is valid and yields three zero-month scenarios, matching
the engine, where "no debts yet" is the normal state of a new account rather
than an error.

The 50-debt cap is a denial-of-service bound, not a product limit. Fifty debts
across 1200 months and three scenarios is roughly 180,000 iterations,
comfortably under 100ms.

The upper bound on `apr` matches the eventual `numeric(5,2)` column. It is
written `Decimal("999.99")` rather than a float literal: a bare `999.99` in a
constraint would be the one float in a specification that bans them.

### On the deliberate validation overlap

The `ge=0` constraints duplicate checks the engine already performs via
`InvalidDebt`. This is intentional, and the reason is error quality: Pydantic
produces `body.debts.2.balance: Input should be greater than or equal to 0`,
which a form can attach to the right input, whereas the engine's exception
yields one message with no field path.

The engine remains the authority. It still runs, and it still catches what
Pydantic cannot see, such as duplicate ids. Pydantic is a better-mannered
first pass over a strict subset of the same rules.

The overlap is four non-negativity checks, the simplest predicate that exists,
so drift between the two is not a realistic risk. The risk worth guarding is
different and is covered in section 11: an input the engine rejects must
always surface as a 422, never an unhandled 500.

## 7. Response schema

```python
class DebtPayoffOut(BaseModel):
    debt_id: str
    name: str
    months_to_payoff: int
    payoff_month: str                   # "2027-05"
    total_interest_paid: Money

class MonthlyTotalOut(BaseModel):
    month_number: int                   # 1-based; 1 is start_month
    month: str                          # "2026-09"
    remaining_balance: Money
    cumulative_interest: Money

class DebtMonthOut(BaseModel):          # detail=full only
    debt_id: str
    starting_balance: Money
    interest_charged: Money
    payment_applied: Money
    ending_balance: Money

class MonthOut(BaseModel):              # detail=full only
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
    payoff_month: str | None            # null when never_pays_off
    underwater_debt_ids: list[str]
    total_interest_paid: Money
    total_paid: Money
    debt_payoffs: list[DebtPayoffOut]
    monthly_totals: list[MonthlyTotalOut]
    schedule: list[MonthOut] | None     # populated only when detail=full

class ScenariosOut(BaseModel):
    snowball: ScenarioOut
    avalanche: ScenarioOut
    baseline: ScenarioOut

class ComparisonOut(BaseModel):
    interest_saved_snowball_vs_baseline: Money | None
    interest_saved_avalanche_vs_baseline: Money | None
    interest_saved_avalanche_vs_snowball: Money | None
    months_saved_snowball_vs_baseline: int | None
    months_saved_avalanche_vs_baseline: int | None
    months_saved_avalanche_vs_snowball: int | None

class PayoffPlanResponse(BaseModel):
    start_month: str
    scenarios: ScenariosOut
    comparison: ComparisonOut
```

`start_month` is echoed back. It costs nothing and makes a stored or logged
response self-describing: a payoff month can be interpreted without the
original request.

### Naming: two numbers, one vocabulary

The engine's `payoff_month` is an integer index; the client wants a calendar
month. Reusing one name across that boundary is how "paid off in month 17"
eventually renders as a date in 1970.

Both appear, sharing the vocabulary already used at scenario level:
`months_to_payoff` for the count, `payoff_month` for the calendar label, at
both scenario and per-debt level. "Paid off in 9 months" is a string the UI
will want, and the count is also what correlates a payoff with a specific row
in a `detail=full` schedule.

The word "index" never appears in the public contract. Schedule and
`monthly_totals` rows use `month_number` for the same reason: it pairs
naturally with `month`, and the response speaks one vocabulary —
`months_to_payoff`, `payoff_month`, `month_number`, `month`.

## 8. Date conversion

`app/api/dates.py`:

```python
def parse_month(value: str) -> tuple[int, int]:
    """Parse "2026-09" into (2026, 9). Raises ValueError on anything else."""

def shift_month(year: int, month: int, offset: int) -> tuple[int, int]:
    total = year * 12 + (month - 1) + offset
    return total // 12, total % 12 + 1

def month_label(start_month: str, index: int) -> str:
    """Calendar label for 1-based month `index`. Month 1 IS start_month."""
    year, month = shift_month(*parse_month(start_month), index - 1)
    return f"{year:04d}-{month:02d}"
```

Because the engine has no concept of days, this is pure integer arithmetic,
which erases an entire category of bugs by construction: no leap years, no
"January 31st plus one month," no daylight saving, no timezones. Converting to
an absolute month count also removes the year rollover as a special case, and
year rollover is where date arithmetic usually breaks.

The `index - 1` implements the spec convention that month 1 is the first month
a payment is made, and it now lives in one function rather than at three call
sites. Fourteen months from `2026-09` gives `2027-10`.

`month_label` is only ever called with an index of 1 or greater, and the
mapper is responsible for enforcing that:

- A `never_pays_off` scenario has `months_to_payoff` of `None`, so the mapper
  emits `payoff_month: null` without consulting this module. There is no
  "date of never" to invent.
- An **empty portfolio** has `months_to_payoff` of `0`, and `month_label(start, 0)`
  would compute an offset of `-1` and name the month *before* `start_month`.
  The mapper emits `payoff_month: null` for a zero-month scenario too: nothing
  was owed, so no month is the payoff month.

So `payoff_month` is non-null exactly when `months_to_payoff` is 1 or more.

The 1200-month horizon is simply the year 2126 — plain integers, nothing to
overflow.

## 9. Errors

| Condition | Status | Source |
|---|---|---|
| Malformed JSON, wrong types, out-of-range values | 422 | `RequestValidationError` |
| Money sent as a JSON number | 422 | the `Money` validator |
| Bad `start_month` format | 422 | field pattern |
| Duplicate debt ids, negative extra payment | 422 | `InvalidDebt` handler |
| Portfolio never pays off | **200** | a normal result body |
| Anything unhandled | 500 | logged, generic body |

**A portfolio that never pays off returns 200.** It is a correct answer to a
valid question. Returning 4xx or 5xx would route it into every HTTP client's
error path, swallowing the single most important thing the product can tell
that user and rendering an error toast where a plan belongs. The governing
rule: HTTP status describes whether the request was answerable, never whether
the answer was good news.

The `InvalidDebt` handler emits FastAPI's own error envelope so clients write
one error parser rather than two:

```python
@app.exception_handler(InvalidDebt)
async def handle_invalid_debt(request: Request, exc: InvalidDebt) -> JSONResponse:
    return JSONResponse(422, {"detail": [{"type": "invalid_debt", "msg": str(exc)}]})
```

## 10. Configuration and deployment

CORS origins come from an `ALLOWED_ORIGINS` environment variable, comma
separated, defaulting to `http://localhost:3000`. It must not be hardcoded:
every Vercel preview deployment gets its own origin.

This slice requires no secrets. There is no database and no model provider
yet, so `.env.example` gains exactly one non-secret line. That property is
worth preserving as long as it lasts.

## 11. Test strategy

Five files, mirroring the engine's layered approach.

| File | What it proves | Needs |
|---|---|---|
| `test_dates.py` | month arithmetic and its edges | nothing |
| `test_schemas.py` | numbers-as-money rejected, ranges, patterns | Pydantic |
| `test_mappers.py` | `PlanComparison` to response, field by field | engine |
| `test_routes.py` | happy path, each 422, `detail=full` | `TestClient` |
| `test_contract.py` | the two invariants below | `TestClient` |

`test_dates.py` covers: index 1 equals `start_month`; `2026-12` at index 2
gives `2027-01`; `2026-01` at index 12 gives `2026-12` with no premature
rollover; `2026-09` at index 1200 gives `2126-08`; and `2026-13`, `26-09`,
`2026-9`, and the empty string are all rejected.

The two contract tests matter most:

- **Every input the engine rejects yields 422, never 500.** This is what makes
  the deliberate validation overlap in section 6 safe: if Pydantic and the
  engine ever disagree, the result is a well-formed 422 rather than a server
  error.
- **A response's numbers equal the engine's own output exactly.** Run a golden
  portfolio through both `compute_plans()` and the HTTP endpoint and assert the
  money strings match. This catches a mapper that silently drops a field or
  rounds a delta, which is the one bug class this layer can uniquely
  introduce.

The coverage gate rises from `--cov=app.engine` to `--cov=app`, still at 100%.
The API layer is thin plumbing, so an untested branch in it has no excuse, and
a gate covering only half the codebase erodes as soon as a second module
appears.

## 12. Deferred

- Persistence, authentication, and row-level security.
- The AI guidance endpoints.
- Rate limiting and API keys.
- Caching. Responses are a pure function of the request, so they are
  cacheable, but nothing yet needs it.
