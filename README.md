# DebtPilot

A debt payoff planner. You enter your debts; it computes exactly what the
snowball and avalanche strategies would cost you, compares both against doing
nothing, and explains the result in plain language.

**Status:** the debt engine is complete and tested. The API, database, and UI
are not built yet.

## The architecture rule

The engine and the AI layer are separate, and this is not optional.

The **debt engine** is plain Python with no LLM calls. It computes every
number: balances, interest, months to payoff, total interest paid. It is
deterministic and covered by unit tests, because a wrong number here is a real
financial mistake for someone, not a cosmetic bug.

The **AI layer** never calculates anything. It receives already-computed
figures and turns them into explanations. The engine's `PlanComparison` object
therefore carries every comparison the model might mention — including the
subtractions, like "avalanche saves you $3,140 and 7 months" — so the prompt
only ever says *describe these figures*, never *work out the difference*.

## What the engine does

Three scenarios from one simulator, for any extra monthly payment:

| Scenario | Extra payment | Order | Minimums | Rollover |
|---|---|---|---|---|
| **Avalanche** | yes | highest APR first | fixed | yes |
| **Snowball** | yes | smallest balance first | fixed | yes |
| **Minimums only** | no | — | declining | no |

The third is the "do nothing differently" baseline. It is what makes the other
two mean anything, and it is the one figure a user cannot estimate alone.

Design decisions worth knowing before reading the code:

- **Monthly accrual**, interest charged before the payment posts. Slightly
  understates real daily compounding, so plan figures are presented as
  estimates.
- **`Decimal` quantized to cents at every step**, `ROUND_HALF_UP` passed
  explicitly. Never floats. Every balance is an exact cent value, so "paid
  off" is exactly `== 0` with no epsilon comparison.
- **No dates inside the engine** — month indices only, which keeps it a pure
  function with no hidden clock and makes every test a fixed table of numbers.
- **Never-paying-off is a result, not an exception.** A user whose avalanche
  plan clears in four years but who would never escape on minimums alone needs
  to be told exactly that; raising would fail the request and show them
  nothing.

Full design: [`docs/superpowers/specs/2026-08-30-debt-engine-design.md`](docs/superpowers/specs/2026-08-30-debt-engine-design.md).

## Layout

```
backend/app/engine/
  money.py       cent quantization           interest.py    accrual seam
  models.py      frozen dataclasses          minimums.py    payment-rule seam
  errors.py      InvalidDebt                 ordering.py    strategy seam
  simulator.py   the single month loop
  plans.py       summaries and comparisons
```

`interest`, `minimums`, and `ordering` are injected into `simulate()`, so the
three scenarios are one loop with different seams — the arithmetic has exactly
one home. Swapping monthly accrual for daily compounding later means replacing
one file, not rewriting the simulator.

## Running the tests

```bash
cd backend
python3 -m venv .venv && .venv/bin/pip install -e ".[dev]"
.venv/bin/pytest
```

109 tests, and the suite fails below 100% line and branch coverage of
`app/engine`. Four layers, each hunting a different class of bug:

- **Unit tests** per seam.
- **Golden fixtures** — hand-computed tables. These catch a wrong *premise*
  (dividing APR by 24 instead of 12 satisfies every invariant while making
  every number wrong).
- **Property invariants** (Hypothesis) — money conservation, constant outlay,
  avalanche never costing more than snowball, and identical results under
  input shuffling. These catch inconsistency across thousands of portfolios.
- **A closed-form oracle** — the algebraic amortization formula, derived
  independently of the loop, agreeing with it within one month.

Both real bugs found during development were caught by these layers rather
than by review: a payment floor that inflated sub-$25 minimums, and an
unsound termination check that declared some paying-off portfolios hopeless.

## Running the API

```bash
cd backend
.venv/bin/uvicorn app.api.main:app --reload
```

Interactive docs at `http://127.0.0.1:8000/docs`; health check at `/health`.

`POST /v1/payoff-plans` takes a portfolio and returns all three scenarios plus
every precomputed comparison. Add `?detail=full` for the per-debt
month-by-month schedule. Detailed responses can be large — a minimums-only
baseline runs for hundreds of months — so each scenario's schedule is cut off
past `MAX_SCHEDULE_ROWS` per-debt rows, with `schedule_truncated: true`
saying so; the summary numbers and comparison deltas are never truncated.

Money is a JSON **string** in both directions. JSON has no decimal type, so
accepting bare numbers would reintroduce floats at the boundary of a
Decimal-only engine — a number where a string belongs is a 422, not a silent
coercion. `start_month` (`YYYY-MM`) is required rather than defaulted from the
server clock, which keeps a response a pure function of its request.

```bash
curl -X POST http://127.0.0.1:8000/v1/payoff-plans \
  -H 'content-type: application/json' \
  -d '{"debts":[{"id":"a","name":"Visa","balance":"2000.00","apr":"24.99","minimum_payment":"50.00"}],
       "extra_monthly_payment":"200.00","start_month":"2026-09"}'
```

A portfolio that never pays off comes back as a 200 with
`"outcome": "never_pays_off"`, not an error. HTTP status describes whether the
request was answerable, never whether the answer was good news.

### Authenticated endpoints

Signed-in users manage their debts through the API rather than writing to
Postgres directly, so the money rules live in one place.

```
POST   /v1/debts             create        GET /v1/debts        list
PATCH  /v1/debts/{id}        partial edit  DELETE /v1/debts/{id}
GET    /v1/me/payoff-plan?extra_monthly_payment=200.00&start_month=2026-09
```

All require a Supabase `Authorization: Bearer <jwt>` header. A user may store
up to 20 debts, enforced at insert so the payoff route inherits the bound.
A debt that does not exist — or belongs to someone else — returns 404 rather
than 403, so the API never confirms a row exists in another account.

Isolation is enforced twice: every query filters on `user_id`, and row-level
security policies enforce the same rule inside Postgres. **The mechanism that
does the work is the database role.** The application connects as `app_user`,
created by the migration with `nosuperuser` and `nobypassrls`; Supabase's
default `postgres` role has `rolbypassrls = true` and would ignore every
policy while every test still passed. `FORCE ROW LEVEL SECURITY` is also set,
which closes the table-owner path, though it is currently redundant because
the owner is that same bypassing role — it starts mattering if ownership ever
moves.

Local development needs Docker running and the Supabase CLI:

```bash
cd backend && supabase start   # prints the DB URL; connect as app_user
```

## Roadmap

- [x] Debt engine
- [x] Payoff plan API — stateless `POST /v1/payoff-plans`
- [x] Debts CRUD with persistence (Supabase Auth, Postgres, row-level security)
- [ ] Supabase Postgres + auth
- [ ] AI guidance layer (Gemini, behind a provider interface)
- [ ] Next.js frontend
