# Persistence and auth — design

**Date:** 2026-08-31
**Status:** Approved, ready for implementation planning
**Scope:** Supabase Auth, a `debts` table with row-level security, debts CRUD
on the FastAPI backend, and an authenticated payoff endpoint reading stored
debts.
**Depends on:**
`docs/superpowers/specs/2026-08-30-debt-engine-design.md` (the engine) and
`docs/superpowers/specs/2026-08-31-payoff-api-design.md` (the stateless API),
both complete and merged.

## 1. Purpose

Give a signed-in user somewhere to keep their debts, so payoff plans stop
being a calculator and become an account. Users authenticate with Supabase
Auth, manage their debts through the backend, and get a plan computed from
what they have stored.

## 2. Non-goals

- **Saved payoff plans.** Deliberately deferred. Persisting a plan means first
  deciding what a saved plan *is* — the strategy the user picked, or the whole
  three-scenario comparison — and the `payoff_plans` draft in `CLAUDE.md`
  stores one strategy per row while the endpoint returns three. That question
  is better answered by watching how the UI wants to use saved plans than by
  guessing now. Plans recompute in under a millisecond, so nothing forces the
  issue.
- **A profile table.** `auth.users` is enough for this slice.
- **The AI guidance endpoints**, and the frontend.

## 3. Settled decisions

Four decisions were made during design. Do not relitigate them during
implementation; if one proves wrong, amend this document first.

### 3.1 The backend owns data access

The frontend talks to FastAPI, and FastAPI talks to Postgres. Debts are not
written directly from the browser through the Supabase client.

Supabase-direct CRUD was seriously considered — it is the reason to pick
Supabase at all, and it would be perhaps a third of the work. It was rejected
on a single argument: **validation would live in two places.** This project
has a real, non-obvious money contract — strings on the wire, `Decimal`
internally, a `numeric(10,2)` ceiling, cent quantization on ingest — and it
currently lives in exactly one file. A browser writing straight to Postgres
bypasses all of it, so those rules would have to be re-expressed as database
constraints and re-implemented in TypeScript.

A second argument reinforces it: the authenticated payoff endpoint must read
debts server-side, so the backend needs database access regardless. Once it
has it, a second write path through the browser means two paths with different
validation — the worst of both designs.

### 3.2 Authorization is enforced twice: RLS and an explicit filter

Every query carries `where user_id = :user_id`, **and** row-level security
policies enforce the same rule inside Postgres.

Neither alone is sufficient. An explicit filter with no backstop means one
forgotten clause is a data breach, and nothing catches it — the code path
looks identical when it is wrong. RLS alone makes every query's behavior
depend on session state invisible at the call site, and gives up the index
clarity of a literal filter.

The trap this avoids is specific and quiet: **enabling RLS does not protect a
backend that connects as the table owner.** Postgres exempts the owner from
its own policies, so a design that says "we use Supabase, RLS is on" can still
leak every row. Section 4 closes that with `FORCE ROW LEVEL SECURITY`.

Retrofit cost drove the timing. Adding RLS now is a migration and a
per-request dependency; adding it after other tables, other queries, and a
frontend exist means auditing every access path at once.

### 3.3 The stateless payoff endpoint stays exactly as it is

`POST /v1/payoff-plans` keeps taking debts in the request body. A second,
authenticated endpoint reads stored debts instead.

That endpoint has quietly become the **anonymous try-before-you-sign-up
path**, which is not a nice-to-have for a debt product: asking someone for
card balances before showing them any value is a real trust and conversion
barrier. It is also already built, tested, published in the OpenAPI schema,
and had two Critical defects fixed in it.

Making `debts` optional — body if present, database if absent — was rejected
for the reason the `start_month` decision established: an optional field that
changes where data comes from is not a middle ground. It is one endpoint with
two auth models and two data sources, where the request body silently selects
which, and the branch is invisible at the call site.

The duplication is small because both endpoints call `compute_plans` and hand
the result to the same `to_response` mapper.

### 3.4 SQLAlchemy Core with Supabase CLI migrations

Direct Postgres access through SQLAlchemy Core — not the ORM — running
synchronously to match the existing `def` handlers. Migrations are plain SQL
under `supabase/migrations/`, applied by the Supabase CLI.

Core gives real SQL with typed results and no session semantics to reason
about, which suits a codebase where explicitness has been the winning bet
throughout. Keeping migrations in the Supabase CLI's own location means the
dashboard and the repository cannot disagree about what the schema is.

`supabase-py` talking to PostgREST was the main alternative: RLS would apply
automatically with no session-variable machinery. It was rejected because
queries go through a filter DSL rather than SQL, and because it puts an HTTP
hop between the backend and its own database.

## 4. Schema

Two corrections to the draft schema in `CLAUDE.md`, both made here.

**No `users` table.** Supabase Auth owns `auth.users`. Mirroring it creates a
second source of truth for identity and a synchronization problem that does
not otherwise exist. `debts.user_id` references `auth.users(id)` directly. A
`public.profiles` table can be added later if profile data is ever needed;
that change is additive.

**No `statement_day`.** It was in the draft to anticipate daily compounding,
which the engine explicitly defers. A nullable column nothing reads drifts out
of sync with reality. Adding it is one migration on the day `interest.py`
needs it.

```sql
create table public.debts (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  name            text not null check (length(trim(name)) between 1 and 120),
  type            text not null default 'credit_card',
  balance         numeric(10,2) not null check (balance >= 0),
  apr             numeric(5,2)  not null check (apr >= 0),
  minimum_payment numeric(10,2) not null check (minimum_payment >= 0),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index debts_user_id_idx on public.debts (user_id);

alter table public.debts enable row level security;
alter table public.debts force  row level security;

create policy debts_select on public.debts for select
  using (user_id = auth.uid());
create policy debts_insert on public.debts for insert
  with check (user_id = auth.uid());
create policy debts_update on public.debts for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy debts_delete on public.debts for delete
  using (user_id = auth.uid());
```

`updated_at` is maintained by a trigger on update.

**`FORCE ROW LEVEL SECURITY` is the line that makes section 3.2 real.**
Without it, a backend connecting on Supabase's default connection string is
the table owner and is exempt from every policy above. There is no error and
no warning; the queries work perfectly and protect nothing.

**`UPDATE` needs both `USING` and `WITH CHECK`.** `USING` decides which rows
may be touched; `WITH CHECK` decides what they may become. With only `USING`,
a user could update a row they legitimately own and reassign its `user_id` to
someone else — handing away their own row, or planting one in another
account.

**The `CHECK` constraints deliberately duplicate Pydantic and the engine.**
Unlike the validation overlap in the API spec, which was a judgment call, this
layer is free: it is declarative, it cannot drift into a different opinion
about what "non-negative" means, and it is the only layer that still applies
when a row is written by psql or by a migration. `numeric(10,2)` and
`numeric(5,2)` line up exactly with the API's `Decimal("99999999.99")` and
`Decimal("999.99")` ceilings.

## 5. Auth

### 5.1 Verifying the token

Supabase signs JWTs asymmetrically (ES256) and publishes a JWKS endpoint.
Tokens are verified locally against cached keys: no network round trip per
request, and no dependency on Supabase being reachable to serve one.

```python
_jwks = PyJWKClient(f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json", cache_keys=True)

def verify_token(token: str) -> str:
    key = _jwks.get_signing_key_from_jwt(token).key
    claims = jwt.decode(
        token, key, algorithms=["ES256"],
        audience="authenticated",
        issuer=f"{SUPABASE_URL}/auth/v1",
    )
    return claims["sub"]
```

Every argument is load-bearing. Pinning `algorithms` blocks
algorithm-confusion attacks. `audience` and `issuer` stop a token minted for a
different Supabase project from being accepted here.

**Never pass `options={"verify_signature": False}`.** It is a one-line
authentication bypass, and it appears in tutorials as a convenience for
reading claims.

The verifier's key source comes from settings, so tests sign their own tokens
with a test key and never reach the network.

### 5.2 The request-scoped transaction

```python
@contextmanager
def user_scoped_connection(user_id: str) -> Iterator[Connection]:
    """A transaction in which RLS policies see this user as auth.uid()."""
    with engine.begin() as conn:
        conn.execute(
            text("select set_config('request.jwt.claims', :claims, true)"),
            {"claims": json.dumps({"sub": user_id})},
        )
        yield conn
```

Two details in that call are security-critical.

**`set_config` rather than `SET LOCAL`.** `SET LOCAL` cannot take a bind
parameter, so the obvious implementation interpolates JWT claims into a SQL
string — a SQL injection hole in the one line whose purpose is enforcing
security. `set_config` is an ordinary function call and parameterizes
properly.

**The third argument must be `true`.** That scopes the setting to the
transaction, so it is discarded at COMMIT. Set session-wide, the next request
reusing that pooled connection inherits the previous user's identity. Under
Supabase's transaction pooler this is not hypothetical: it is one user reading
another's debts, from a one-character difference.

Queries must run on this connection, inside this transaction. A query that
opens its own connection receives no claims, `auth.uid()` returns null, and
RLS returns zero rows — a safe failure, but a confusing one, so section 8
pins it with a test.

### 5.3 Failure modes

| Condition | Status |
|---|---|
| Missing or malformed `Authorization` header | 401 |
| Expired token, bad signature, wrong audience or issuer | 401 |
| Valid token, user has no debts | **200** with `[]` |

The last row follows the same principle as `never_pays_off` returning 200: an
empty portfolio is the normal state of a new account, not an error.

One implementation detail is required to make the first row true:
FastAPI's `HTTPBearer` returns **403** when the header is missing, not 401.
The dependency must be constructed with `auto_error=False` and raise 401
itself, or the shipped behavior will contradict this table. A test asserts
401 specifically, so the default cannot creep back in.

## 6. Endpoints

| Route | Returns |
|---|---|
| `POST /v1/debts` | 201 and `DebtOut` |
| `GET /v1/debts` | 200 and `list[DebtOut]` |
| `PATCH /v1/debts/{id}` | 200 and `DebtOut` |
| `DELETE /v1/debts/{id}` | 204 |
| `GET /v1/me/payoff-plan?extra_monthly_payment=&start_month=&detail=` | 200 and `PayoffPlanResponse` |

**A missing or foreign debt id returns 404, never 403.** Under RLS, touching
another user's row affects zero rows; the repository cannot distinguish "does
not exist" from "is not yours," and should not try. A 403 would confirm that a
given id exists in someone else's account.

**An empty `PATCH` body is a 422.** Sending `{}` is a client bug, not a
request to change nothing.

**`extra_monthly_payment` is a query parameter on the authenticated payoff
route, so it arrives as a string by definition.** The `Money` validator still
applies and still parses it to `Decimal`, but its reject-bare-numbers
guarantee is trivially satisfied there rather than doing real work — the
protection that matters on this route is the `ge=0` and ceiling bounds. Worth
knowing so nobody reads the shared type as carrying more weight than it does
here.

**The 20-debt cap moves to insert.** `POST /v1/debts` counts the user's
existing rows in the same transaction and returns 422 at the limit.

That last one carries a bound forward rather than inventing one. The API
spec's 20-debt cap bounded the *request body*; on the authenticated path
debts come from the database, so nothing would stop a user from storing 500
debts across 500 successful inserts and then reproducing exactly the
resource-exhaustion problem that cap was added to close. Enforcing it at
insert means the payoff endpoint inherits the bound, and the user learns
about the limit when they hit it rather than when their plan fails.

## 7. Layout and validation

```
backend/app/api/
  auth.py                 verify_token, current_user_id dependency
  db.py                   engine, user_scoped_connection
  repositories/debts.py   every query, each taking user_id explicitly
  routers/debts.py        CRUD
  routers/payoff_plans.py existing stateless route + the authenticated one
  schemas.py              existing + DebtCreate / DebtUpdate / DebtOut
```

The authenticated payoff route sits beside the stateless one rather than in a
separate module: same domain, same mapper, and adjacency makes it obvious the
two must produce identical response shapes.

### Repository

```python
def list_debts(conn: Connection, user_id: str) -> list[DebtRow]: ...
def create_debt(conn: Connection, user_id: str, data: DebtCreate) -> DebtRow: ...
def update_debt(conn, user_id: str, debt_id: str, changes: DebtUpdate) -> DebtRow | None: ...
def delete_debt(conn, user_id: str, debt_id: str) -> bool: ...
```

Every function takes `user_id` as a required argument and writes
`where user_id = :user_id` into its SQL. One module means one file to audit,
and a filter missing there returns zero rows rather than everyone's.

### Schemas

`DebtCreate` and `DebtUpdate` reuse the existing `Money` type, so the
string-only rule and the money ceiling apply identically on this path.
`DebtUpdate` has all fields optional. `DebtOut` adds `id`, `created_at`, and
`updated_at`.

`type` is optional on `DebtCreate` and defaults to `'credit_card'`, matching
the column default. The engine ignores it; it exists so the table can carry
auto and student loans later without a migration.

**`name` must be stripped and re-checked in Pydantic, not only in the
database.** The column's constraint is `length(trim(name)) between 1 and 120`,
but Pydantic's `min_length=1` accepts `"   "` — which then violates the CHECK
and surfaces as an unhandled `IntegrityError`, a 500. This is the same shape
as the oversized-`Decimal` defect the API review caught: an input that passes
validation and crashes deeper. `DebtCreate.name` therefore strips whitespace
before length validation, so the two layers agree on what "empty" means and
the 500 is unreachable.

`DebtCreate` is **not** the existing `DebtIn`. `DebtIn` carries a
client-supplied `id`, because the stateless endpoint needs the caller to
correlate results with its own records. `DebtCreate` has no `id` — the
database generates it — and no `user_id`, which comes from the verified token
and never from the body. Accepting `user_id` from a request body is how a
caller writes into someone else's account.

## 8. Test strategy

**Row-level security cannot be tested without a real Postgres.** Every other
layer of this project is testable in-process; this one is not. A mocked
database, a SQLite substitute, or a repository unit test against a fake
connection all pass identically whether the policies are correct, wrong, or
absent, because they exercise the SQL string rather than the engine that
enforces it. That shapes the strategy rather than being accommodated by it.

| File | Needs | Proves |
|---|---|---|
| `test_auth.py` | nothing | token verification and every rejection path |
| `test_schemas_debts.py` | nothing | `DebtCreate` / `DebtUpdate` validation |
| `test_repositories.py` | Postgres | CRUD round-trips |
| `test_rls.py` | Postgres | cross-user isolation |
| `test_routes_debts.py` | Postgres | 401s, the insert cap, status codes |
| `test_parity.py` | Postgres | the two payoff endpoints agree |

Tests run against the **Supabase CLI local stack** rather than a bare Postgres
container, because it ships the real `auth` schema and the real `auth.uid()`.
A bare container would require hand-writing an `auth.uid()` mirror, and a
mirror of the function that enforces authorization is exactly the thing that
must not drift. It is slower in CI; that is the right price.

### The tests that matter most

**Cross-user isolation.** Two users, each with debts. User A must not read,
update, or delete user B's rows, asserted for all four verbs rather than
`SELECT` alone. `UPDATE` gets its own case for the reason in section 4:
`WITH CHECK` is what prevents A from reassigning `user_id` on a row A
legitimately owns.

**The claims dependency is load-bearing.** A query run on a connection where
`set_config` was never called must return zero rows. This pins the failure as
fail-safe and catches a later refactor that opens its own connection outside
the transaction.

**Parity.** The same debts, submitted to the stateless endpoint versus stored
and read by the authenticated one, must produce identical response bodies.
This is the analog of the engine-parity contract test in the API spec, and it
is what stops the two payoff paths from drifting.

### Prove the isolation test is not vacuous

Mutation-verify it deliberately: drop the RLS policies, confirm `test_rls.py`
fails, restore them. Then do it again by removing **only**
`FORCE ROW LEVEL SECURITY`.

The second exercise is the important one. With `FORCE` removed the policies
still exist, the dashboard still shows them enabled, and every test that does
not specifically probe owner-connection behavior still passes. A suite that
stays green when `FORCE` is gone is not testing what it claims to.

This repeats a lesson the API review taught: coverage reported 100% on a
mapper whose `monthly_totals` values were never compared against anything.
Coverage says a line ran; only mutation says it mattered.

### CI and coverage

The workflow gains a Supabase start step. The coverage gate stays at 100% over
`app`, which is a useful forcing function: if the database tests are skipped
in CI, coverage drops and the build fails, so this layer cannot quietly become
untested.

## 9. Configuration

**This slice needs secrets, and the previous one did not.** `DATABASE_URL`
contains a password, and `SUPABASE_URL` identifies the project. `.env.example`
gains real entries, `.gitignore` already covers `.env`, and Render needs both
configured. The API slice's zero-secret property is over; it is worth stating
so nobody assumes otherwise.

## 10. Deferred

- Saved payoff plans, and the `payoff_plans` schema question.
- A profile table.
- The AI guidance endpoints.
- Rate limiting per user.
