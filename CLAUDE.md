# Debt relief planner

A web app that lets users enter their debts (credit cards to start, other loan
types later) and get a payoff plan comparing the snowball and avalanche
methods, with AI-generated guidance layered on top of deterministic math.

Rename this file's title and the project itself once you've settled on a name.

## Tech stack

- Frontend: Next.js (App Router), TypeScript, Tailwind CSS
- Backend: FastAPI (Python)
- Database: PostgreSQL (Supabase-hosted, so auth and the database live in one place)
- Auth: Supabase Auth
- LLM: Google Gemini, called through a provider interface so it can be swapped
  out later without touching the rest of the app
- Deployment: Vercel (frontend), Render (backend)

## Core architecture rule

The debt engine and the AI layer are separate. This is not optional.

- The debt engine (plain Python, no LLM calls) computes every number:
  balances, interest, months to payoff, total interest paid, for both
  snowball and avalanche. This code must be deterministic and covered by
  unit tests, since a wrong number here is a real financial mistake for a
  user, not a cosmetic bug.
- The AI layer never performs financial calculations. It only receives
  already-computed numbers from the debt engine and turns them into
  plain-language explanations, recommendations, and answers to follow-up
  questions. If a new feature would require the model to calculate
  anything, route the calculation through the debt engine first and pass
  the result to the model instead.
- Concrete test of that rule: **every number that could appear in a
  sentence the AI writes must already exist as a field on the engine's
  result object.** Comparisons like "avalanche saves you $3,140 and 7
  months versus snowball" are subtraction, so those deltas are computed by
  the engine and passed in. The prompt says "describe these figures," never
  "work out the difference."

## Debt payoff strategies

- Avalanche: minimum payments on every debt, extra payment goes to the
  highest-APR debt first. Minimizes total interest paid.
- Snowball: minimum payments on every debt, extra payment goes to the
  smallest-balance debt first. Not interest-optimal, but tends to keep
  people motivated through early wins.
- Minimums-only baseline: no extra payment, and minimums decline as
  balances fall. This is the "do nothing differently" comparison that makes
  the other two meaningful. It is computed and displayed, but not persisted.
- Default behavior: compute all three for any given extra monthly payment
  and show the user the outcomes (total interest, payoff date) rather than
  silently picking one for them.

## Debt engine design (settled)

These decisions are made. Don't relitigate them while implementing; if one
turns out to be wrong, change it here first.

**Interest accrual.** Monthly periods. One step = one month. Interest for
the month is `balance * (apr / 100 / 12)`, charged first, then the payment
posts. This is the standard consumer-calculator model. It slightly
understates interest versus real daily compounding (26.82% vs 27.12%
effective at a 24% APR), so user-facing copy says "estimated" rather than
implying to-the-penny precision. The calculation lives alone in
`interest.py` so daily compounding can replace it later without touching
the simulation loop.

**Minimum payments.** Fixed for snowball and avalanche. This is safe
because the total monthly outlay is held constant at
`sum(minimums at t=0) + extra` for the whole payoff, so a shrinking minimum
just frees cash for the target debt. The minimums-only baseline instead
recomputes each month as `max(min($25, stored_minimum), implied_pct * balance)`,
where `implied_pct` is derived at t=0 as `stored_minimum / starting_balance`. No
extra user input required. If `stored_minimum` is zero, the declining minimum
is zero too. More generally, the floor is $25 or the user's own stored
minimum, whichever is smaller — it must not manufacture a payment the user
never had.

**Negative amortization is a result, not an exception.** If a debt's minimum
is less than its monthly interest, the balance grows forever. That is a
legitimate answer to a valid question, not a failure. A user whose avalanche
plan clears in four years but who would never escape on minimums alone needs
to be told exactly that, and raising would fail the whole request and show
them nothing. So `PlanSummary.outcome` carries `NEVER_PAYS_OFF`,
`months_to_payoff` is `None`, and `underwater_debt_ids` names the debts whose
interest outruns their payment. The engine must never hang.

**Money.** `Decimal` everywhere, quantized to cents at every step, with
`ROUND_HALF_UP` set explicitly (Python's default is `ROUND_HALF_EVEN`).
Floats are not acceptable anywhere in the engine. Because every balance is
an exact cent value, "paid off" is exactly `balance == 0` with no epsilon
comparison. The final payment on a debt is truncated to the remaining
balance, and the freed remainder rolls to the next debt in the same month.

**No dates in the engine.** The engine speaks only in 1-based month
indices, which keeps it a pure function with no hidden clock input and
makes every test a fixed table of numbers. The API layer converts indices
to calendar dates. Conventions: month 1 is the first month a payment is
made (not the current month), and
`payoff_date = start_month + (months_to_payoff - 1)`.

**One parameterized simulator, four seams.** Snowball and avalanche differ by
exactly one sort key, so the arithmetic has exactly one home:

```python
simulate(debts, extra_payment, order_fn, minimum_rule, rollover=True) -> Schedule

snowball  = simulate(debts, extra, order_by_smallest_balance, fixed_minimum)
avalanche = simulate(debts, extra, order_by_highest_apr,      fixed_minimum)
baseline  = simulate(debts, 0, order_by_smallest_balance, declining_minimum,
                     rollover=False)
```

Rollover is its own axis, not a property of the minimum rule. Snowball and
avalanche keep a cleared debt's minimum in the budget and aim it at the next
debt. The baseline must not: "do nothing differently" means that freed money
gets spent elsewhere, and rolling it over would compute a baseline far too
optimistic, understating the exact gap the product exists to show.

**The monthly loop.**

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
7. newly cleared debts add their minimum to freed_pool   (only if rollover)
```

Budget is computed from `scheduled`, not `required`. The difference between
them is the final-payment truncation remainder: in the month a $2,000 card has
only $340 left against a $50 minimum, that spare money lands in `surplus` and
cascades to the next debt within the same month. Compute the budget from
`required` instead and it silently evaporates, stretching every payoff by a
fraction of a month per debt. This cascade applies under `rollover=False` too;
suppressing it would need a special case in the hot path to reclaim roughly
$250 across a 340-month baseline.

For snowball and avalanche this formula holds the total outlay exactly
constant at `sum(initial minimums) + extra` for the whole run, which makes
that invariant a consequence of the formula rather than something to remember.

**Termination.** Two mechanisms, since a hang is the worst possible failure
here. First, a sound early exit: a total-balance stall alone proves nothing —
a high-APR debt can pay down while a low-APR one grows, and the first freed
minimum can still rescue the rest — so the engine exits early only when the
total stalled AND every active debt's interest exceeds its scheduled minimum
plus all distributable surplus (extra plus freed pool), making rescue
impossible under any allocation. Second, a hard `MAX_MONTHS = 1200` backstop,
whose underwater ids name only debts whose interest outran their payment in
the final simulated month. Both produce the `NEVER_PAYS_OFF` outcome.

**Engine data model.** Frozen dataclasses, tuples not lists, no Pydantic and
no FastAPI imports inside the engine package.

- `Debt` — `id`, `name`, `balance`, `apr` (percent, e.g. `Decimal("24.99")`),
  `minimum_payment`. Deliberately no `user_id`, `type`, or timestamps; the
  engine does not know users exist.
- `DebtMonth` — `debt_id`, `starting_balance`, `interest_charged`,
  `payment_applied`, `ending_balance`.
- `Month` — `index`, `debts`, `total_payment`, `total_interest`,
  `remaining_balance`.
- `Schedule` — `months`, plus `outcome` and `underwater_debt_ids`. `simulate`
  returns a `Schedule`, so it must carry how the run ended; `plans.py` folds
  one into a `PlanSummary`.
- `DebtPayoff` — `debt_id`, `name`, `payoff_month`, `total_interest_paid`.
- `Outcome` — enum, `PAID_OFF` | `NEVER_PAYS_OFF`.
- `PlanSummary` — `strategy`, `outcome`, `months_to_payoff` (`None` when
  `NEVER_PAYS_OFF`), `underwater_debt_ids`, `total_interest_paid`,
  `total_paid`, `debt_payoffs` (in payoff order), `monthly_totals` (a
  compact `index` / `remaining` / `cumulative_interest` array for charting).
- `PlanComparison` — the three `PlanSummary` objects plus precomputed
  interest-saved and months-saved deltas for each pairing, each nullable,
  since you cannot subtract from a plan that never pays off. Verbose on
  purpose; this is the object handed to the AI layer.

**Output layering.** The engine always builds the full schedule, since it
is free and makes any month assertable in tests. The API returns the
summary plus `monthly_totals` by default, and the full per-debt grid only
on `?detail=full`. This matters because a minimums-only baseline can run
300+ months, so serializing all three schedules in full would be a
multi-hundred-kilobyte response the UI mostly discards.

## Engine validation and edge cases

`InvalidDebt` is raised for a negative `balance`, `apr`, or
`minimum_payment`; a negative `extra_payment`; and duplicate debt ids.
Everything else is accepted and handled:

- Sub-cent precision is quantized on ingest, not rejected.
- `balance == 0` is accepted and excluded from the simulation.
- `minimum_payment == 0` on a live balance is accepted; the no-progress
  check catches it.
- `minimum_payment > balance` is fine; final-payment truncation covers it.
- An empty debt list returns an empty `Schedule` with `months_to_payoff = 0`.
  This is not an error. "No debts yet" is the normal state of a new account,
  and raising would force every caller to special-case it.
- A 0% APR promo card accrues nothing and sorts last under avalanche. If
  every debt is 0%, both strategies tie and all deltas are zero; the AI layer
  must say they are equivalent rather than invent a preference.
- An extra payment larger than the total debt clears everything in month 1.
  The unspent surplus is simply not paid, and `total_paid` reflects reality.
- A $0.01 balance accrues interest that quantizes to `0.00`, so there is no
  immortal fractional debt. This falls out of quantizing at every step.

**Ordering must be total, not merely stable.** Avalanche sorts by highest
APR, then smallest balance, then `id`. Snowball sorts by smallest balance,
then highest APR, then `id`. The trailing `id` tiebreak is not pedantry:
Python's sort is stable, so without it the ordering silently inherits input
order, and the same debts submitted in a different sequence would produce a
different per-debt payoff order. Totals would match, but the plan shown to
the user would flip between requests for no visible reason. Unit tests built
on a fixed list never catch this.

## Deferred to a later MVP

- **"How much extra would I need?"** When snowball and avalanche also never
  pay off, the natural follow-up is the minimum extra monthly payment that
  makes the debts clear. That is a solve, not a simulation, so it needs a
  different algorithm (most likely a binary search over `simulate`). Out of
  scope for the first version, but the obvious next engine feature.
- Daily interest compounding, dropped in behind the existing `interest.py`
  seam.
- Debt types beyond credit cards: auto, student, and personal loans.

## Database schema (rough draft, refine as the app grows)

**users**
- id (uuid, PK)
- email (text, unique)
- created_at (timestamp)

**debts**
Named `debts` rather than `credit_cards` so it can extend to other loan
types later without a rename.
- id (uuid, PK)
- user_id (uuid, FK -> users.id)
- name (text)
- type (text, default 'credit_card')
- balance (numeric(10,2))
- apr (numeric(5,2))
- minimum_payment (numeric(10,2))
- statement_day (int, nullable)
- created_at, updated_at (timestamp)

**payoff_plans**
- id (uuid, PK)
- user_id (uuid, FK)
- strategy (text: 'snowball' | 'avalanche')
- extra_monthly_payment (numeric(10,2))
- total_interest_paid (numeric(10,2))
- months_to_payoff (int)
- payoff_date (date)
- created_at (timestamp)

The minimums-only baseline is computed on every request but never written
to `payoff_plans`; it is derived context for display and for the AI prompt,
not a plan the user chose. That keeps the `strategy` column's two values
correct as written.

**ai_insights**
- id (uuid, PK)
- payoff_plan_id (uuid, FK -> payoff_plans.id)
- content (text)
- created_at (timestamp)

Per-debt, month-by-month payoff schedules don't need their own table for
the MVP. Compute them on demand from the debt engine rather than storing
them; add a table later only if you find yourself recomputing the same
schedule repeatedly. A full 5-debt, 30-year run is under a millisecond, so
caching it would be storing a derived value to save nothing.

## API endpoints (rough draft)

Debts
- POST /debts
- GET /debts
- PATCH /debts/{id}
- DELETE /debts/{id}

Payoff plans
- POST /v1/payoff-plans — built. Stateless: debts arrive in the request body.
  Returns snowball, avalanche, and the minimums-only baseline, plus the six
  precomputed comparison deltas. `?detail=full` adds the per-debt
  month-by-month grid. Money is a JSON string in both directions; a bare
  number is a 422. `start_month` (YYYY-MM) is required — the API reads no
  clock, so a response is a pure function of its request.
- A portfolio that never pays off is a 200, not an error.
- GET /payoff-plans, GET /payoff-plans/{id} — deferred until persistence exists.

AI guidance
- POST /payoff-plans/{id}/explain, generates a natural-language
  explanation and recommendation from the plan's already-computed numbers
- POST /payoff-plans/{id}/ask, a scoped follow-up question, grounded only
  in that plan's data

## Project structure

```
/frontend   Next.js + TypeScript app
/backend    FastAPI app
```

The engine is a framework-free package inside the backend:

```
/backend/app/engine/
  models.py      Debt, DebtMonth, Month, Schedule, PlanSummary, PlanComparison
  interest.py    monthly_interest(balance, apr)      <- swappable accrual seam
  minimums.py    fixed_minimum / declining_minimum   <- minimum-payment rule seam
  ordering.py    snowball_order / avalanche_order    <- strategy seam
  simulator.py   simulate(...) -> Schedule           <- the single month loop
  plans.py       compute_plans(debts, extra) -> PlanComparison
  errors.py      InvalidDebt   (never-pays-off is a result, not an exception)
```

## Conventions

- TypeScript: strict mode on, no implicit any.
- Python: type hints everywhere, Pydantic models for all request and
  response schemas. Pydantic lives at the API boundary only; the engine
  uses plain frozen dataclasses so it can be tested with no app context.
- Money is always `Decimal`, never `float`. Quantize to cents at every
  step, `ROUND_HALF_UP` set explicitly.
- Never mutate the global decimal context (`getcontext().rounding = ...`).
  Quantize explicitly at each call site. Global context is process-wide
  mutable state, and a library must not silently change rounding behavior
  for the rest of the backend.
- Write unit tests for the debt engine calculations before wiring up any
  UI or AI layer; that logic has to be correct first.
- Keep the LLM provider behind a small interface (e.g. a single
  `generate_guidance()` function) so switching providers later is a small
  change, not a rewrite.
- FastAPI and Pydantic live only under `app/api/`. The engine imports no
  framework, and route handlers are `def`, not `async def`, because the
  engine is CPU-bound and FastAPI runs sync handlers in a threadpool.
- Never hardcode API keys or database URLs. Use environment variables and
  keep a `.env.example` file up to date.
