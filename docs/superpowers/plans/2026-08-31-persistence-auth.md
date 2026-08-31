# Persistence and Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a signed-in user somewhere to keep their debts — Supabase Auth, a `debts` table protected by row-level security, CRUD endpoints, and a payoff endpoint that reads stored debts.

**Architecture:** The backend owns data access; the browser never writes to Postgres directly. Authorization is enforced twice — an explicit `user_id` filter in every query, and RLS policies inside Postgres that apply even to the table owner. Each request opens one transaction, stamps the verified user's id into `request.jwt.claims`, and runs its queries there, so `auth.uid()` resolves inside the policies.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy Core (sync), psycopg 3, PyJWT with cryptography, Supabase (Postgres + Auth), Supabase CLI for migrations and the local test stack.

**Spec:** `docs/superpowers/specs/2026-08-31-persistence-auth-design.md`

## Global Constraints

Every task's requirements implicitly include this section.

- **`FORCE ROW LEVEL SECURITY` is mandatory** on `public.debts`. Postgres exempts a table's owner from its own policies, so without it RLS on Supabase's default connection protects nothing — silently.
- **Per-request claims use `set_config('request.jwt.claims', :claims, true)`**, never `SET LOCAL`. `SET LOCAL` cannot take a bind parameter, and the third argument `true` scopes the setting to the transaction — session scope leaks the previous user's identity across a pooled connection.
- **Never `jwt.decode(..., options={"verify_signature": False})`.** Always pin `algorithms=["ES256"]`, `audience="authenticated"`, and `issuer`.
- Every repository function takes `user_id` as a required argument and writes `where user_id = :user_id` into its SQL.
- `user_id` comes from the verified token, never from a request body or query parameter.
- A missing or foreign debt id returns **404, never 403**.
- A missing or malformed `Authorization` header returns **401** — `HTTPBearer` must be constructed with `auto_error=False`, since its default is 403.
- Money is `Decimal`, a JSON string on the wire, bounded by `Decimal("99999999.99")` (`Decimal("999.99")` for APR).
- Maximum 20 debts per user, enforced on insert inside the same transaction that counts.
- No framework imports inside `backend/app/engine/`.
- Route handlers are `def`, not `async def`.
- 100% line and branch coverage across `app`, enforced. No `# pragma: no cover`.
- Commit after every task.

## Prerequisites (Task 1 establishes these)

- **The Supabase CLI is not installed.** Task 1 installs it with Homebrew.
- **The Docker daemon is not running.** Docker Desktop is at `/Applications/Docker.app`; `supabase start` needs the daemon up.

If either cannot be made to work, stop and report BLOCKED rather than substituting a bare Postgres container — the spec rejected that deliberately, because it would require hand-writing an `auth.uid()` mirror, and a mirror of the function enforcing authorization is the last thing that should drift.

## Refinements to the Spec

1. **Tests need rows in `auth.users`.** `debts.user_id` references it, so a test user must exist before any debt row can. GoTrue is not involved — the fixture inserts directly with SQL. The exact NOT NULL column set varies by Supabase version, so Task 1 verifies the insert against the actual local schema and adapts if columns differ.
2. **The JWKS fetch is stubbed in tests, and nothing else is.** `PyJWKClient` performs an HTTP GET the suite must not do. Tests substitute only that fetch: the ES256 keypair is real, the signing is real, `jwt.decode` is real, and every claim check runs for real. This is the one stub in the project and it sits exactly on the network boundary.
3. **`get_engine` and the JWKS client are `lru_cache`d, not module globals.** Both need resetting between tests that change environment variables; `cache_clear()` is a defined API where a global needs a bespoke reset function.

## File Structure

```
backend/
  supabase/
    config.toml                      created by `supabase init`
    migrations/0001_debts.sql        table, index, RLS, policies, trigger
  app/api/
    db.py                            engine, user_scoped_connection
    auth.py                          verify_token, current_user_id
    repositories/debts.py            every query, each taking user_id
    routers/debts.py                 CRUD endpoints
    routers/payoff_plans.py          existing + the authenticated route
    schemas.py                       existing + DebtCreate/DebtUpdate/DebtOut
  tests/api/
    conftest.py                      db fixtures, test users, token signing
    test_schema.py                   the migration's shape and policies
    test_db.py                       engine and claims scoping
    test_rls.py                      cross-user isolation
    test_auth.py                     token verification, no database
    test_schemas_debts.py            request model validation, no database
    test_repositories.py             CRUD round-trips
    test_routes_debts.py             endpoints, status codes, the cap
    test_parity.py                   both payoff endpoints agree
```

Dependency direction stays one-way:

```
db, auth  ->  repositories  ->  routers  ->  main
```

---

### Task 1: Local Supabase, the migration, and test fixtures

**Files:**
- Modify: `backend/pyproject.toml`
- Create: `backend/supabase/migrations/0001_debts.sql`
- Create: `backend/tests/api/conftest.py`
- Test: `backend/tests/api/test_schema.py`

**Interfaces:**
- Consumes: nothing.
- Produces: a running local Supabase; `public.debts`; pytest fixtures `db_engine`, `db_conn`, `user_a`, `user_b`, `clean_debts`.

- [ ] **Step 1: Install the Supabase CLI and start Docker**

```bash
brew install supabase/tap/supabase
open -a Docker
until docker info >/dev/null 2>&1; do sleep 3; done; echo "docker ready"
```

- [ ] **Step 2: Initialise and start the local stack**

```bash
cd backend
supabase init
supabase start
```

`supabase start` prints a `DB URL` (typically `postgresql://postgres:postgres@127.0.0.1:54322/postgres`) and an `API URL` (typically `http://127.0.0.1:54321`). Record both. If it fails, report BLOCKED with its output rather than working around it.

- [ ] **Step 3: Add dependencies to `backend/pyproject.toml`**

```toml
dependencies = [
  "fastapi>=0.115",
  "uvicorn[standard]>=0.32",
  "sqlalchemy>=2.0",
  "psycopg[binary]>=3.2",
  "pyjwt[crypto]>=2.9",
]
```

Then `cd backend && .venv/bin/pip install -e ".[dev]"`.

- [ ] **Step 4: Write the migration**

Create `backend/supabase/migrations/0001_debts.sql`:

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

-- ENABLE turns policies on; FORCE makes them apply to the table's owner too.
-- Without FORCE, a backend connecting on Supabase's default credentials is the
-- owner and is exempt from every policy below: no error, no warning, and the
-- queries work perfectly while protecting nothing.
alter table public.debts enable row level security;
alter table public.debts force  row level security;

create policy debts_select on public.debts for select
  using (user_id = auth.uid());

create policy debts_insert on public.debts for insert
  with check (user_id = auth.uid());

-- USING decides which rows may be touched; WITH CHECK decides what they may
-- become. Without WITH CHECK, a user could update a row they own and reassign
-- its user_id to someone else.
create policy debts_update on public.debts for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy debts_delete on public.debts for delete
  using (user_id = auth.uid());

create or replace function public.set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger debts_set_updated_at
  before update on public.debts
  for each row execute function public.set_updated_at();
```

- [ ] **Step 5: Apply it**

```bash
cd backend && supabase db reset
```

`db reset` rebuilds the local database from `migrations/`, which proves the migration works from scratch rather than from whatever state the database happens to be in.

- [ ] **Step 6: Write the fixtures**

Create `backend/tests/api/conftest.py`:

```python
"""Database fixtures for the tests that need a real Postgres.

Row-level security cannot be tested against a mock: a fake connection
exercises the SQL string, not the engine that enforces the policies. These
fixtures point at the local Supabase stack, which ships the real `auth`
schema and the real `auth.uid()`.
"""

import os
import uuid
from collections.abc import Iterator

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Connection, Engine

LOCAL_DB_URL = "postgresql+psycopg://postgres:postgres@127.0.0.1:54322/postgres"


@pytest.fixture(scope="session")
def db_engine() -> Engine:
    return create_engine(os.environ.get("DATABASE_URL", LOCAL_DB_URL), future=True)


@pytest.fixture
def db_conn(db_engine: Engine) -> Iterator[Connection]:
    with db_engine.begin() as conn:
        yield conn


def _make_user(conn: Connection) -> str:
    """Insert a bare row into auth.users so debts.user_id has something to reference.

    GoTrue is not involved: these tests are about authorization in the
    database, not about the sign-up flow.
    """
    user_id = str(uuid.uuid4())
    conn.execute(
        text(
            """
            insert into auth.users
              (id, instance_id, aud, role, email, encrypted_password,
               created_at, updated_at)
            values
              (:id, '00000000-0000-0000-0000-000000000000', 'authenticated',
               'authenticated', :email, '', now(), now())
            """
        ),
        {"id": user_id, "email": f"{user_id}@example.test"},
    )
    return user_id


@pytest.fixture
def user_a(db_conn: Connection) -> str:
    return _make_user(db_conn)


@pytest.fixture
def user_b(db_conn: Connection) -> str:
    return _make_user(db_conn)


@pytest.fixture(autouse=True)
def clean_debts(db_engine: Engine) -> Iterator[None]:
    yield
    with db_engine.begin() as conn:
        conn.execute(text("delete from public.debts"))
        conn.execute(text("delete from auth.users where email like '%@example.test'"))
```

**If the `auth.users` insert fails** because this Supabase version requires different NOT NULL columns, inspect the real column set (`psql "$DB_URL" -c '\d auth.users'`), add the missing ones with sensible empty values, and note the change in your report. Do not disable the foreign key.

- [ ] **Step 7: Write the schema tests**

Create `backend/tests/api/test_schema.py`:

```python
"""The migration's shape, asserted against the live database.

These fail if the migration is edited in a way that silently removes a
protection, which is exactly the class of change that has no other symptom.
"""

from sqlalchemy import text


def test_debts_table_exists(db_conn):
    count = db_conn.execute(
        text("select count(*) from information_schema.tables "
             "where table_schema='public' and table_name='debts'")
    ).scalar_one()
    assert count == 1


def test_row_level_security_is_enabled_and_forced(db_conn):
    # relforcerowsecurity is the one that matters: without it the table's owner
    # bypasses every policy, and nothing else in the suite would notice.
    enabled, forced = db_conn.execute(
        text("select relrowsecurity, relforcerowsecurity "
             "from pg_class where oid = 'public.debts'::regclass")
    ).one()
    assert enabled is True
    assert forced is True


def test_all_four_policies_exist(db_conn):
    names = set(
        db_conn.execute(
            text("select policyname from pg_policies "
                 "where schemaname='public' and tablename='debts'")
        ).scalars()
    )
    assert names == {"debts_select", "debts_insert", "debts_update", "debts_delete"}


def test_update_policy_has_both_using_and_with_check(db_conn):
    using, check = db_conn.execute(
        text("select qual, with_check from pg_policies "
             "where tablename='debts' and policyname='debts_update'")
    ).one()
    assert using is not None
    assert check is not None


def test_money_columns_match_the_api_ceilings(db_conn):
    cols = dict(
        db_conn.execute(
            text("select column_name, numeric_precision from information_schema.columns "
                 "where table_schema='public' and table_name='debts' "
                 "and data_type='numeric'")
        ).all()
    )
    assert cols["balance"] == 10
    assert cols["minimum_payment"] == 10
    assert cols["apr"] == 5


def test_user_id_cascades_on_user_delete(db_conn):
    rule = db_conn.execute(
        text("""
            select rc.delete_rule
            from information_schema.table_constraints tc
            join information_schema.referential_constraints rc
              on tc.constraint_name = rc.constraint_name
            where tc.table_name = 'debts' and tc.constraint_type = 'FOREIGN KEY'
        """)
    ).scalar_one()
    assert rule == "CASCADE"
```

- [ ] **Step 8: Run the tests**

Run: `cd backend && DATABASE_URL=postgresql+psycopg://postgres:postgres@127.0.0.1:54322/postgres .venv/bin/pytest tests/api/test_schema.py -v --no-cov`
Expected: PASS, 6 tests. `--no-cov` because this task adds no application code, so the 100% gate has nothing to measure yet.

- [ ] **Step 9: Commit**

```bash
git add backend/pyproject.toml backend/supabase backend/tests/api/conftest.py backend/tests/api/test_schema.py
git commit -m "feat(db): add debts table with forced row-level security"
```

`supabase init` may create `backend/supabase/.gitignore` and `config.toml`. Commit `config.toml` and `migrations/`; let its `.gitignore` exclude local volumes.

---

### Task 2: The database module

**Files:**
- Create: `backend/app/api/db.py`
- Test: `backend/tests/api/test_db.py`

**Interfaces:**
- Consumes: fixtures from Task 1.
- Produces: `database_url() -> str`, `get_engine() -> Engine`, `user_scoped_connection(user_id: str) -> Iterator[Connection]`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/api/test_db.py`:

```python
import json

import pytest
from sqlalchemy import text

from app.api.db import database_url, get_engine, user_scoped_connection


@pytest.fixture(autouse=True)
def _reset_engine_cache():
    get_engine.cache_clear()
    yield
    get_engine.cache_clear()


def test_database_url_comes_from_the_environment(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://x/y")
    assert database_url() == "postgresql+psycopg://x/y"


def test_missing_database_url_raises_rather_than_defaulting(monkeypatch):
    # Silently defaulting to a local database in production would be worse
    # than refusing to start.
    monkeypatch.delenv("DATABASE_URL", raising=False)
    with pytest.raises(RuntimeError, match="DATABASE_URL"):
        database_url()


def test_engine_is_cached(monkeypatch):
    monkeypatch.setenv(
        "DATABASE_URL",
        "postgresql+psycopg://postgres:postgres@127.0.0.1:54322/postgres",
    )
    assert get_engine() is get_engine()


def test_user_scoped_connection_sets_the_claims(user_a):
    with user_scoped_connection(user_a) as conn:
        claims = conn.execute(
            text("select current_setting('request.jwt.claims', true)")
        ).scalar_one()
        assert json.loads(claims)["sub"] == user_a


def test_auth_uid_resolves_inside_the_transaction(user_a):
    with user_scoped_connection(user_a) as conn:
        assert str(conn.execute(text("select auth.uid()")).scalar_one()) == user_a


def test_claims_do_not_leak_to_a_later_connection(user_a):
    with user_scoped_connection(user_a) as conn:
        assert conn.execute(text("select auth.uid()")).scalar_one() is not None
    # A fresh transaction must start with no identity. Had set_config been
    # called with is_local=false, a pooled connection would carry the previous
    # user's id into this one.
    with get_engine().begin() as conn:
        assert conn.execute(text("select auth.uid()")).scalar_one() is None
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/api/test_db.py -v --no-cov`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.api.db'`

- [ ] **Step 3: Write the implementation**

Create `backend/app/api/db.py`:

```python
"""Database access, scoped to one user per transaction.

Every query in this application runs inside `user_scoped_connection`, which
stamps the verified user's id into `request.jwt.claims` so the row-level
security policies on `public.debts` can resolve `auth.uid()`.
"""

import json
import os
from collections.abc import Iterator
from contextlib import contextmanager
from functools import lru_cache

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Connection, Engine


def database_url() -> str:
    """The Postgres URL. Raises rather than defaulting.

    A default would let a misconfigured production process start up pointed at
    nothing, which is worse than refusing to start.
    """
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL is not set")
    return url


@lru_cache(maxsize=1)
def get_engine() -> Engine:
    """One engine per process. `cache_clear()` resets it for tests."""
    return create_engine(database_url(), pool_pre_ping=True, future=True)


@contextmanager
def user_scoped_connection(user_id: str) -> Iterator[Connection]:
    """A transaction in which RLS policies see `user_id` as `auth.uid()`.

    Two details here are security-critical.

    `set_config` rather than `SET LOCAL`, because SET LOCAL cannot take a bind
    parameter: the obvious alternative interpolates claims into a SQL string,
    putting an injection hole in the line whose job is enforcing security.

    The third argument `true` scopes the setting to this transaction, so it is
    discarded at COMMIT. Session scope would leak this user's identity to
    whatever request next reuses the pooled connection.
    """
    with get_engine().begin() as conn:
        conn.execute(
            text("select set_config('request.jwt.claims', :claims, true)"),
            {"claims": json.dumps({"sub": user_id})},
        )
        yield conn
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && DATABASE_URL=postgresql+psycopg://postgres:postgres@127.0.0.1:54322/postgres .venv/bin/pytest tests/api/test_db.py -v --no-cov`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/db.py backend/tests/api/test_db.py
git commit -m "feat(db): add user-scoped connections that set RLS claims"
```

---

### Task 3: Cross-user isolation

**Files:**
- Test: `backend/tests/api/test_rls.py`

**Interfaces:**
- Consumes: `user_scoped_connection` (Task 2), fixtures (Task 1).
- Produces: nothing — tests only.

This is the most consequential task in the plan. Everything else here can fail in a way that raises an error; this can fail in a way that produces a support ticket six months later.

- [ ] **Step 1: Write the tests**

Create `backend/tests/api/test_rls.py`:

```python
"""Cross-user isolation, enforced by Postgres rather than by application code.

These run through `user_scoped_connection` -- the same path production uses --
rather than against raw SQL, so they exercise the real mechanism.
"""

from decimal import Decimal

import pytest
from sqlalchemy import text

from app.api.db import get_engine, user_scoped_connection

INSERT = text(
    """
    insert into public.debts (user_id, name, balance, apr, minimum_payment)
    values (:user_id, :name, :balance, :apr, :minimum_payment)
    returning id
    """
)


def _insert_debt(user_id: str, name: str = "Visa") -> str:
    with user_scoped_connection(user_id) as conn:
        return str(
            conn.execute(
                INSERT,
                {
                    "user_id": user_id,
                    "name": name,
                    "balance": Decimal("1000.00"),
                    "apr": Decimal("24.99"),
                    "minimum_payment": Decimal("50.00"),
                },
            ).scalar_one()
        )


def test_a_user_sees_their_own_debt(user_a):
    _insert_debt(user_a, "A's card")
    with user_scoped_connection(user_a) as conn:
        names = list(conn.execute(text("select name from public.debts")).scalars())
    assert names == ["A's card"]


def test_a_user_cannot_select_another_users_debt(user_a, user_b):
    _insert_debt(user_a, "A's card")
    with user_scoped_connection(user_b) as conn:
        rows = list(conn.execute(text("select id from public.debts")).scalars())
    assert rows == []


def test_a_user_cannot_update_another_users_debt(user_a, user_b):
    debt_id = _insert_debt(user_a)
    with user_scoped_connection(user_b) as conn:
        result = conn.execute(
            text("update public.debts set name = 'stolen' where id = :id"),
            {"id": debt_id},
        )
        assert result.rowcount == 0
    with user_scoped_connection(user_a) as conn:
        assert conn.execute(text("select name from public.debts")).scalar_one() == "Visa"


def test_a_user_cannot_delete_another_users_debt(user_a, user_b):
    debt_id = _insert_debt(user_a)
    with user_scoped_connection(user_b) as conn:
        assert conn.execute(
            text("delete from public.debts where id = :id"), {"id": debt_id}
        ).rowcount == 0
    with user_scoped_connection(user_a) as conn:
        assert conn.execute(text("select count(*) from public.debts")).scalar_one() == 1


def test_a_user_cannot_insert_a_debt_owned_by_someone_else(user_a, user_b):
    # The insert policy's WITH CHECK is what stops this.
    with user_scoped_connection(user_a) as conn:
        with pytest.raises(Exception) as exc:
            conn.execute(
                INSERT,
                {
                    "user_id": user_b,
                    "name": "planted",
                    "balance": Decimal("1.00"),
                    "apr": Decimal("1.00"),
                    "minimum_payment": Decimal("1.00"),
                },
            )
        assert "row-level security" in str(exc.value).lower()


def test_a_user_cannot_reassign_their_debt_to_another_user(user_a, user_b):
    # The update policy's WITH CHECK is what stops this. With only USING, a
    # user could hand their own row to someone else's account.
    debt_id = _insert_debt(user_a)
    with user_scoped_connection(user_a) as conn:
        with pytest.raises(Exception) as exc:
            conn.execute(
                text("update public.debts set user_id = :other where id = :id"),
                {"other": user_b, "id": debt_id},
            )
        assert "row-level security" in str(exc.value).lower()


def test_a_connection_without_claims_sees_nothing(user_a):
    # Proves the claims dependency is load-bearing: a query that opens its own
    # connection outside user_scoped_connection fails safe rather than
    # returning every row.
    _insert_debt(user_a)
    with get_engine().begin() as conn:
        assert conn.execute(text("select count(*) from public.debts")).scalar_one() == 0
```

- [ ] **Step 2: Run the tests**

Run: `cd backend && DATABASE_URL=postgresql+psycopg://postgres:postgres@127.0.0.1:54322/postgres .venv/bin/pytest tests/api/test_rls.py -v --no-cov`
Expected: PASS, 7 tests

- [ ] **Step 3: Prove the tests are not vacuous — mutation check**

Earlier in this project, 100% coverage proved nothing about a mapper whose values were never compared. Apply the same discipline. Run each mutation, confirm the suite goes red, then restore.

**Mutation A — remove a policy:**

```bash
cd backend
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  -c "drop policy debts_select on public.debts;"
.venv/bin/pytest tests/api/test_rls.py -q --no-cov   # MUST fail
supabase db reset                                     # restore
```

**Mutation B — remove FORCE only:**

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  -c "alter table public.debts no force row level security;"
.venv/bin/pytest tests/api/test_rls.py -q --no-cov   # MUST fail
supabase db reset
```

Mutation B is the important one: with `FORCE` gone the policies still exist and the dashboard still shows RLS enabled, so a suite that stays green here is not testing what it claims to. Record both outcomes in your report; if either mutation leaves the suite green, that is a finding, not a formality.

- [ ] **Step 4: Commit**

```bash
git add backend/tests/api/test_rls.py
git commit -m "test(db): pin cross-user isolation at the database level"
```

---

### Task 4: Token verification

**Files:**
- Create: `backend/app/api/auth.py`
- Test: `backend/tests/api/test_auth.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `supabase_url() -> str`, `jwk_client() -> PyJWKClient`, `verify_token(token: str) -> str`, `current_user_id(...) -> str` (a FastAPI dependency).

No database. The suite signs its own ES256 tokens and substitutes only the JWKS network fetch.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/api/test_auth.py`:

```python
"""Token verification, with real cryptography and no network.

The only thing stubbed is the JWKS fetch, which is an HTTP GET. The keypair,
the signing, `jwt.decode`, and every claim check are real -- so these tests
exercise the actual rejection logic rather than a mock of it.
"""

import time
import uuid

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import HTTPException

from app.api import auth

ISSUER = "https://test.supabase.co/auth/v1"


@pytest.fixture(autouse=True)
def _configure(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://test.supabase.co")
    auth.jwk_client.cache_clear()
    yield
    auth.jwk_client.cache_clear()


@pytest.fixture(scope="module")
def signing_key():
    return ec.generate_private_key(ec.SECP256R1())


@pytest.fixture(autouse=True)
def _stub_jwks(monkeypatch, signing_key):
    """Substitute the JWKS HTTP fetch, and nothing else."""

    class _Key:
        key = signing_key.public_key()

    class _Client:
        def get_signing_key_from_jwt(self, token):
            return _Key()

    monkeypatch.setattr(auth, "jwk_client", lambda: _Client())


def make_token(signing_key, **overrides) -> str:
    claims = {
        "sub": str(uuid.uuid4()),
        "aud": "authenticated",
        "iss": ISSUER,
        "exp": int(time.time()) + 3600,
    }
    claims.update(overrides)
    return jwt.encode(claims, signing_key, algorithm="ES256")


def test_a_valid_token_yields_the_subject(signing_key):
    user_id = str(uuid.uuid4())
    assert auth.verify_token(make_token(signing_key, sub=user_id)) == user_id


def test_an_expired_token_is_rejected(signing_key):
    token = make_token(signing_key, exp=int(time.time()) - 1)
    with pytest.raises(HTTPException) as exc:
        auth.verify_token(token)
    assert exc.value.status_code == 401


def test_a_token_for_another_audience_is_rejected(signing_key):
    with pytest.raises(HTTPException) as exc:
        auth.verify_token(make_token(signing_key, aud="anon"))
    assert exc.value.status_code == 401


def test_a_token_from_another_issuer_is_rejected(signing_key):
    # A token minted by a different Supabase project must not work here.
    with pytest.raises(HTTPException) as exc:
        auth.verify_token(make_token(signing_key, iss="https://evil.supabase.co/auth/v1"))
    assert exc.value.status_code == 401


def test_a_token_signed_by_a_different_key_is_rejected(signing_key):
    other = ec.generate_private_key(ec.SECP256R1())
    forged = jwt.encode(
        {"sub": "x", "aud": "authenticated", "iss": ISSUER, "exp": int(time.time()) + 60},
        other,
        algorithm="ES256",
    )
    with pytest.raises(HTTPException) as exc:
        auth.verify_token(forged)
    assert exc.value.status_code == 401


def test_garbage_is_rejected():
    with pytest.raises(HTTPException) as exc:
        auth.verify_token("not-a-jwt")
    assert exc.value.status_code == 401


def test_a_token_without_a_subject_is_rejected(signing_key):
    # A signature-valid token with no `sub` would otherwise produce a None
    # user id and silently scope every query to nobody.
    token = jwt.encode(
        {"aud": "authenticated", "iss": ISSUER, "exp": int(time.time()) + 60},
        signing_key,
        algorithm="ES256",
    )
    with pytest.raises(HTTPException) as exc:
        auth.verify_token(token)
    assert exc.value.status_code == 401


def test_missing_credentials_are_a_401_not_a_403():
    # FastAPI's HTTPBearer returns 403 by default when the header is absent.
    # The spec says 401, so the dependency must use auto_error=False.
    with pytest.raises(HTTPException) as exc:
        auth.current_user_id(credentials=None)
    assert exc.value.status_code == 401


def test_valid_credentials_pass_through(signing_key):
    from fastapi.security import HTTPAuthorizationCredentials

    user_id = str(uuid.uuid4())
    creds = HTTPAuthorizationCredentials(
        scheme="Bearer", credentials=make_token(signing_key, sub=user_id)
    )
    assert auth.current_user_id(credentials=creds) == user_id


def test_supabase_url_must_be_configured(monkeypatch):
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    with pytest.raises(RuntimeError, match="SUPABASE_URL"):
        auth.supabase_url()
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/api/test_auth.py -v --no-cov`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.api.auth'`

- [ ] **Step 3: Write the implementation**

Create `backend/app/api/auth.py`:

```python
"""Supabase JWT verification.

Tokens are verified locally against cached JWKS: no network round trip per
request, and no dependency on Supabase being reachable to serve one.
"""

import os
from functools import lru_cache

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient

# auto_error=False is required: HTTPBearer's default raises 403 when the
# header is missing, and the contract for this API is 401.
_bearer = HTTPBearer(auto_error=False)


def supabase_url() -> str:
    url = os.environ.get("SUPABASE_URL")
    if not url:
        raise RuntimeError("SUPABASE_URL is not set")
    return url.rstrip("/")


@lru_cache(maxsize=1)
def jwk_client() -> PyJWKClient:
    """Cached JWKS client. `cache_clear()` resets it for tests."""
    return PyJWKClient(
        f"{supabase_url()}/auth/v1/.well-known/jwks.json", cache_keys=True
    )


def verify_token(token: str) -> str:
    """Return the subject of a valid Supabase token, or raise 401.

    Every argument to `jwt.decode` is load-bearing. Pinning `algorithms`
    blocks algorithm-confusion attacks; `audience` and `issuer` stop a token
    minted for a different Supabase project from being accepted here.
    """
    issuer = f"{supabase_url()}/auth/v1"
    try:
        key = jwk_client().get_signing_key_from_jwt(token).key
        claims = jwt.decode(
            token,
            key,
            algorithms=["ES256"],
            audience="authenticated",
            issuer=issuer,
        )
    except Exception as exc:  # PyJWT raises several unrelated types
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid token"
        ) from exc

    subject = claims.get("sub")
    if not subject:
        # A signature-valid token with no subject would scope every query to
        # nobody, which is a silent failure rather than a loud one.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="token has no subject"
        )
    return str(subject)


def current_user_id(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> str:
    """FastAPI dependency yielding the verified user's id."""
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="not authenticated"
        )
    return verify_token(credentials.credentials)
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && .venv/bin/pytest tests/api/test_auth.py -v --no-cov`
Expected: PASS, 10 tests

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/auth.py backend/tests/api/test_auth.py
git commit -m "feat(auth): verify Supabase tokens against cached JWKS"
```

---

### Task 5: Debt request and response schemas

**Files:**
- Modify: `backend/app/api/schemas.py` (append)
- Test: `backend/tests/api/test_schemas_debts.py`

**Interfaces:**
- Consumes: `Money` from the existing schemas module.
- Produces: `DebtCreate`, `DebtUpdate`, `DebtOut`, `MAX_DEBTS_PER_USER`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/api/test_schemas_debts.py`:

```python
from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.api.schemas import DebtCreate, DebtOut, DebtUpdate


def payload(**overrides) -> dict:
    body = {
        "name": "Visa",
        "balance": "1000.00",
        "apr": "24.99",
        "minimum_payment": "50.00",
    }
    body.update(overrides)
    return body


def test_valid_payload_parses_to_decimals():
    debt = DebtCreate(**payload())
    assert debt.balance == Decimal("1000.00")
    assert debt.type == "credit_card"


def test_money_as_a_json_number_is_rejected():
    with pytest.raises(ValidationError, match="JSON string"):
        DebtCreate(**payload(balance=1000.00))


def test_money_above_the_ceiling_is_rejected():
    # Matches numeric(10,2); without it an oversized Decimal reaches the
    # database and surfaces as a 500 rather than a 422.
    with pytest.raises(ValidationError):
        DebtCreate(**payload(balance="1e1000"))


def test_whitespace_only_name_is_rejected():
    # The column's CHECK is length(trim(name)) >= 1. Pydantic's min_length
    # alone accepts "   ", which would violate the constraint and surface as
    # an unhandled IntegrityError.
    with pytest.raises(ValidationError):
        DebtCreate(**payload(name="   "))


def test_name_is_stripped():
    assert DebtCreate(**payload(name="  Visa  ")).name == "Visa"


def test_user_id_cannot_be_supplied_by_the_client():
    # user_id comes from the verified token. Accepting it from a body is how
    # a caller writes into someone else's account.
    with pytest.raises(ValidationError):
        DebtCreate(**payload(user_id="00000000-0000-0000-0000-000000000000"))


def test_id_cannot_be_supplied_by_the_client():
    with pytest.raises(ValidationError):
        DebtCreate(**payload(id="00000000-0000-0000-0000-000000000000"))


def test_update_allows_partial_payloads():
    assert DebtUpdate(balance="500.00").name is None


def test_update_rejects_an_entirely_empty_payload():
    # Sending {} is a client bug, not a request to change nothing.
    with pytest.raises(ValidationError, match="at least one field"):
        DebtUpdate()


def test_update_rejects_unknown_fields():
    with pytest.raises(ValidationError):
        DebtUpdate(blance="500.00")


def test_debt_out_serializes_money_as_strings():
    import json
    from datetime import datetime, timezone

    out = DebtOut(
        id="11111111-1111-1111-1111-111111111111",
        name="Visa",
        type="credit_card",
        balance=Decimal("1000.00"),
        apr=Decimal("24.99"),
        minimum_payment=Decimal("50.00"),
        created_at=datetime(2026, 8, 31, tzinfo=timezone.utc),
        updated_at=datetime(2026, 8, 31, tzinfo=timezone.utc),
    )
    body = json.loads(out.model_dump_json())
    assert body["balance"] == "1000.00"
    assert body["apr"] == "24.99"
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/api/test_schemas_debts.py -v --no-cov`
Expected: FAIL — `ImportError: cannot import name 'DebtCreate' from 'app.api.schemas'`

- [ ] **Step 3: Append to `backend/app/api/schemas.py`**

Add `datetime` to the imports (`from datetime import datetime`) and `model_validator` to the pydantic import, then append:

```python
MAX_DEBTS_PER_USER = 20


def _non_blank(value: str) -> str:
    """Strip, then require content.

    The column's CHECK is `length(trim(name)) between 1 and 120`. Pydantic's
    `min_length` alone accepts "   ", which passes validation and then
    violates the constraint as an unhandled IntegrityError -- a 500 from a
    well-formed request. Stripping here keeps the two layers agreeing on what
    "empty" means.
    """
    stripped = value.strip()
    if not stripped:
        raise ValueError("must not be blank")
    return stripped


NonBlankName = Annotated[
    str, BeforeValidator(_non_blank), Field(min_length=1, max_length=120)
]


class DebtCreate(BaseModel):
    """A new debt. No `id` (the database generates it) and no `user_id`
    (it comes from the verified token, never from the body)."""

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
    id: str
    name: str
    type: str
    balance: Money
    apr: Money
    minimum_payment: Money
    created_at: datetime
    updated_at: datetime
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && .venv/bin/pytest tests/api/test_schemas_debts.py -v --no-cov`
Expected: PASS, 11 tests

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/schemas.py backend/tests/api/test_schemas_debts.py
git commit -m "feat(api): add debt request and response schemas"
```

---

### Task 6: The debts repository

**Files:**
- Create: `backend/app/api/repositories/__init__.py`, `backend/app/api/repositories/debts.py`
- Test: `backend/tests/api/test_repositories.py`

**Interfaces:**
- Consumes: `user_scoped_connection` (Task 2), `DebtCreate` / `DebtUpdate` / `MAX_DEBTS_PER_USER` (Task 5).
- Produces: `count_debts`, `list_debts`, `get_debt`, `create_debt`, `update_debt`, `delete_debt`, and `DebtLimitReached`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/api/test_repositories.py`:

```python
from decimal import Decimal

import pytest

from app.api.db import user_scoped_connection
from app.api.repositories import debts as repo
from app.api.schemas import DebtCreate, DebtUpdate


def make(name="Visa", balance="1000.00") -> DebtCreate:
    return DebtCreate(
        name=name, balance=balance, apr="24.99", minimum_payment="50.00"
    )


def test_create_returns_the_stored_row(user_a):
    with user_scoped_connection(user_a) as conn:
        row = repo.create_debt(conn, user_a, make())
    assert row.name == "Visa"
    assert row.balance == Decimal("1000.00")
    assert row.id


def test_list_returns_only_this_users_debts(user_a, user_b):
    with user_scoped_connection(user_a) as conn:
        repo.create_debt(conn, user_a, make("A card"))
    with user_scoped_connection(user_b) as conn:
        repo.create_debt(conn, user_b, make("B card"))
        assert [d.name for d in repo.list_debts(conn, user_b)] == ["B card"]


def test_list_is_ordered_by_creation(user_a):
    with user_scoped_connection(user_a) as conn:
        for name in ("first", "second", "third"):
            repo.create_debt(conn, user_a, make(name))
        assert [d.name for d in repo.list_debts(conn, user_a)] == [
            "first", "second", "third"
        ]


def test_get_returns_none_for_another_users_debt(user_a, user_b):
    with user_scoped_connection(user_a) as conn:
        debt_id = repo.create_debt(conn, user_a, make()).id
    with user_scoped_connection(user_b) as conn:
        assert repo.get_debt(conn, user_b, debt_id) is None


def test_update_applies_only_the_supplied_fields(user_a):
    with user_scoped_connection(user_a) as conn:
        debt_id = repo.create_debt(conn, user_a, make()).id
        updated = repo.update_debt(
            conn, user_a, debt_id, DebtUpdate(balance="500.00")
        )
    assert updated.balance == Decimal("500.00")
    assert updated.name == "Visa"


def test_update_returns_none_for_another_users_debt(user_a, user_b):
    with user_scoped_connection(user_a) as conn:
        debt_id = repo.create_debt(conn, user_a, make()).id
    with user_scoped_connection(user_b) as conn:
        assert repo.update_debt(conn, user_b, debt_id, DebtUpdate(name="x")) is None


def test_update_touches_updated_at(user_a):
    with user_scoped_connection(user_a) as conn:
        created = repo.create_debt(conn, user_a, make())
        updated = repo.update_debt(
            conn, user_a, created.id, DebtUpdate(name="Renamed")
        )
    assert updated.updated_at >= created.updated_at


def test_delete_reports_whether_a_row_went(user_a):
    with user_scoped_connection(user_a) as conn:
        debt_id = repo.create_debt(conn, user_a, make()).id
        assert repo.delete_debt(conn, user_a, debt_id) is True
        assert repo.delete_debt(conn, user_a, debt_id) is False


def test_delete_returns_false_for_another_users_debt(user_a, user_b):
    with user_scoped_connection(user_a) as conn:
        debt_id = repo.create_debt(conn, user_a, make()).id
    with user_scoped_connection(user_b) as conn:
        assert repo.delete_debt(conn, user_b, debt_id) is False


def test_count_is_per_user(user_a, user_b):
    with user_scoped_connection(user_a) as conn:
        repo.create_debt(conn, user_a, make())
        repo.create_debt(conn, user_a, make())
        assert repo.count_debts(conn, user_a) == 2
    with user_scoped_connection(user_b) as conn:
        assert repo.count_debts(conn, user_b) == 0


def test_creating_past_the_cap_raises(user_a):
    # The cap lives at insert so the payoff endpoint inherits the bound: debts
    # come from the database there, so a body-level limit would not apply.
    with user_scoped_connection(user_a) as conn:
        for i in range(repo.MAX_DEBTS_PER_USER):
            repo.create_debt(conn, user_a, make(f"card {i}"))
        with pytest.raises(repo.DebtLimitReached):
            repo.create_debt(conn, user_a, make("one too many"))
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/api/test_repositories.py -v --no-cov`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.api.repositories'`

- [ ] **Step 3: Write the implementation**

Create an empty `backend/app/api/repositories/__init__.py`, then `backend/app/api/repositories/debts.py`:

```python
"""Every query against `public.debts`, in one auditable place.

Each function takes `user_id` as a required argument and writes
`where user_id = :user_id` into its SQL. That is the belt; the RLS policies
are the braces. One module means one file to audit, and a filter missing here
returns zero rows rather than everyone's.
"""

from collections.abc import Sequence

from sqlalchemy import text
from sqlalchemy.engine import Connection, Row

from ..schemas import MAX_DEBTS_PER_USER, DebtCreate, DebtUpdate

_COLUMNS = "id, name, type, balance, apr, minimum_payment, created_at, updated_at"

UPDATABLE_FIELDS = ("name", "type", "balance", "apr", "minimum_payment")


class DebtLimitReached(Exception):
    """Raised when a user already holds MAX_DEBTS_PER_USER debts."""


def count_debts(conn: Connection, user_id: str) -> int:
    return conn.execute(
        text("select count(*) from public.debts where user_id = :user_id"),
        {"user_id": user_id},
    ).scalar_one()


def list_debts(conn: Connection, user_id: str) -> Sequence[Row]:
    return conn.execute(
        text(
            f"select {_COLUMNS} from public.debts "
            "where user_id = :user_id order by created_at, id"
        ),
        {"user_id": user_id},
    ).all()


def get_debt(conn: Connection, user_id: str, debt_id: str) -> Row | None:
    return conn.execute(
        text(f"select {_COLUMNS} from public.debts "
             "where user_id = :user_id and id = :id"),
        {"user_id": user_id, "id": debt_id},
    ).one_or_none()


def create_debt(conn: Connection, user_id: str, data: DebtCreate) -> Row:
    """Insert one debt, enforcing the per-user cap in the same transaction.

    Counting and inserting together is what makes the cap meaningful: two
    concurrent requests cannot both observe a count below the limit and both
    insert, because the transaction serializes them.
    """
    if count_debts(conn, user_id) >= MAX_DEBTS_PER_USER:
        raise DebtLimitReached(
            f"a user may store at most {MAX_DEBTS_PER_USER} debts"
        )
    return conn.execute(
        text(
            f"""
            insert into public.debts
              (user_id, name, type, balance, apr, minimum_payment)
            values
              (:user_id, :name, :type, :balance, :apr, :minimum_payment)
            returning {_COLUMNS}
            """
        ),
        {"user_id": user_id, **data.model_dump()},
    ).one()


def update_debt(
    conn: Connection, user_id: str, debt_id: str, changes: DebtUpdate
) -> Row | None:
    """Apply the supplied fields. Returns None when nothing matched.

    None covers both "no such debt" and "not yours" -- the caller must not
    distinguish them, because a 403 would confirm a row exists in someone
    else's account.
    """
    supplied = changes.model_dump(exclude_none=True)
    assignments = ", ".join(f"{field} = :{field}" for field in UPDATABLE_FIELDS
                            if field in supplied)
    return conn.execute(
        text(
            f"update public.debts set {assignments} "
            "where user_id = :user_id and id = :id "
            f"returning {_COLUMNS}"
        ),
        {"user_id": user_id, "id": debt_id, **supplied},
    ).one_or_none()


def delete_debt(conn: Connection, user_id: str, debt_id: str) -> bool:
    result = conn.execute(
        text("delete from public.debts where user_id = :user_id and id = :id"),
        {"user_id": user_id, "id": debt_id},
    )
    return result.rowcount == 1
```

Note `assignments` is built only from the fixed `UPDATABLE_FIELDS` tuple intersected with what the caller supplied, so no user-controlled string ever reaches the SQL text — the values are bound parameters.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && DATABASE_URL=postgresql+psycopg://postgres:postgres@127.0.0.1:54322/postgres .venv/bin/pytest tests/api/test_repositories.py -v --no-cov`
Expected: PASS, 11 tests

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/repositories backend/tests/api/test_repositories.py
git commit -m "feat(api): add the debts repository with a per-user cap"
```

---

### Task 7: The debts CRUD endpoints

**Files:**
- Create: `backend/app/api/routers/debts.py`
- Modify: `backend/app/api/main.py` (wire the router, add a `DebtLimitReached` handler)
- Test: `backend/tests/api/test_routes_debts.py`

**Interfaces:**
- Consumes: `current_user_id` (Task 4), `user_scoped_connection` (Task 2), the repository (Task 6), `DebtCreate`/`DebtUpdate`/`DebtOut` (Task 5).
- Produces: `router: APIRouter` with the four CRUD routes, mounted at `/v1`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/api/test_routes_debts.py`:

```python
"""The CRUD endpoints, exercised through HTTP against the real database.

Auth is overridden with FastAPI's dependency_overrides rather than by minting
tokens: token verification is already covered in test_auth.py, and these tests
are about routing, status codes, and isolation.
"""

import pytest
from fastapi.testclient import TestClient

from app.api.auth import current_user_id
from app.api.main import create_app


def client_for(user_id: str) -> TestClient:
    app = create_app()
    app.dependency_overrides[current_user_id] = lambda: user_id
    return TestClient(app)


def payload(**overrides) -> dict:
    body = {
        "name": "Visa",
        "balance": "1000.00",
        "apr": "24.99",
        "minimum_payment": "50.00",
    }
    body.update(overrides)
    return body


def test_create_returns_201_and_the_debt(user_a):
    response = client_for(user_a).post("/v1/debts", json=payload())
    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "Visa"
    assert body["balance"] == "1000.00"
    assert body["id"]


def test_list_returns_only_this_users_debts(user_a, user_b):
    client_for(user_a).post("/v1/debts", json=payload(name="A card"))
    client_for(user_b).post("/v1/debts", json=payload(name="B card"))
    body = client_for(user_b).get("/v1/debts").json()
    assert [d["name"] for d in body] == ["B card"]


def test_list_is_empty_for_a_new_account(user_a):
    response = client_for(user_a).get("/v1/debts")
    assert response.status_code == 200
    assert response.json() == []


def test_patch_updates_supplied_fields_only(user_a):
    client = client_for(user_a)
    debt_id = client.post("/v1/debts", json=payload()).json()["id"]
    body = client.patch(f"/v1/debts/{debt_id}", json={"balance": "500.00"}).json()
    assert body["balance"] == "500.00"
    assert body["name"] == "Visa"


def test_patch_with_an_empty_body_is_a_422(user_a):
    client = client_for(user_a)
    debt_id = client.post("/v1/debts", json=payload()).json()["id"]
    assert client.patch(f"/v1/debts/{debt_id}", json={}).status_code == 422


def test_delete_returns_204(user_a):
    client = client_for(user_a)
    debt_id = client.post("/v1/debts", json=payload()).json()["id"]
    assert client.delete(f"/v1/debts/{debt_id}").status_code == 204
    assert client.get("/v1/debts").json() == []


def test_another_users_debt_is_404_not_403(user_a, user_b):
    # 403 would confirm the row exists in someone else's account.
    debt_id = client_for(user_a).post("/v1/debts", json=payload()).json()["id"]
    other = client_for(user_b)
    assert other.patch(f"/v1/debts/{debt_id}", json={"name": "x"}).status_code == 404
    assert other.delete(f"/v1/debts/{debt_id}").status_code == 404


def test_an_unknown_debt_is_404(user_a):
    missing = "11111111-1111-1111-1111-111111111111"
    client = client_for(user_a)
    assert client.patch(f"/v1/debts/{missing}", json={"name": "x"}).status_code == 404
    assert client.delete(f"/v1/debts/{missing}").status_code == 404


def test_requests_without_a_token_are_401(user_a):
    # No dependency override here: the real auth dependency runs.
    anonymous = TestClient(create_app())
    assert anonymous.get("/v1/debts").status_code == 401
    assert anonymous.post("/v1/debts", json=payload()).status_code == 401


def test_money_as_a_json_number_is_a_422(user_a):
    response = client_for(user_a).post("/v1/debts", json=payload(balance=1000.00))
    assert response.status_code == 422
    assert "JSON string" in response.text


def test_a_blank_name_is_a_422_not_a_500(user_a):
    # The column CHECK would reject this too, but as an IntegrityError -- a
    # 500 from a well-formed request.
    assert client_for(user_a).post("/v1/debts", json=payload(name="   ")).status_code == 422


def test_a_client_supplied_user_id_is_rejected(user_a, user_b):
    body = payload()
    body["user_id"] = user_b
    assert client_for(user_a).post("/v1/debts", json=body).status_code == 422


def test_the_twenty_first_debt_is_a_422(user_a):
    client = client_for(user_a)
    for i in range(20):
        assert client.post("/v1/debts", json=payload(name=f"card {i}")).status_code == 201
    response = client.post("/v1/debts", json=payload(name="too many"))
    assert response.status_code == 422
    assert response.json()["detail"][0]["type"] == "debt_limit_reached"
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/api/test_routes_debts.py -v --no-cov`
Expected: FAIL — 404s everywhere, because `/v1/debts` does not exist yet.

- [ ] **Step 3: Write the router**

Create `backend/app/api/routers/debts.py`:

```python
"""Debts CRUD.

Every handler resolves the user from the verified token, opens one
user-scoped transaction, and delegates to the repository.
"""

from fastapi import APIRouter, Depends, HTTPException, Response, status

from ..auth import current_user_id
from ..db import user_scoped_connection
from ..repositories import debts as repo
from ..schemas import DebtCreate, DebtOut, DebtUpdate

router = APIRouter()

NOT_FOUND = "debt not found"


@router.post("/debts", response_model=DebtOut, status_code=status.HTTP_201_CREATED)
def create_debt(data: DebtCreate, user_id: str = Depends(current_user_id)) -> DebtOut:
    with user_scoped_connection(user_id) as conn:
        row = repo.create_debt(conn, user_id, data)
    return DebtOut.model_validate(row._mapping)


@router.get("/debts", response_model=list[DebtOut])
def list_debts(user_id: str = Depends(current_user_id)) -> list[DebtOut]:
    with user_scoped_connection(user_id) as conn:
        rows = repo.list_debts(conn, user_id)
    return [DebtOut.model_validate(row._mapping) for row in rows]


@router.patch("/debts/{debt_id}", response_model=DebtOut)
def update_debt(
    debt_id: str, changes: DebtUpdate, user_id: str = Depends(current_user_id)
) -> DebtOut:
    with user_scoped_connection(user_id) as conn:
        row = repo.update_debt(conn, user_id, debt_id, changes)
    if row is None:
        # 404 for both "no such debt" and "not yours": distinguishing them
        # would confirm the row exists in another account.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND)
    return DebtOut.model_validate(row._mapping)


@router.delete("/debts/{debt_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_debt(debt_id: str, user_id: str = Depends(current_user_id)) -> Response:
    with user_scoped_connection(user_id) as conn:
        deleted = repo.delete_debt(conn, user_id, debt_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
```

`DebtOut` needs `model_config = ConfigDict(from_attributes=True)` to accept a row mapping; add it to that class in `schemas.py`. Note this is response-side only — the hand-written mapper for payoff plans remains hand-written, because that one converts *engine* types across a published boundary. A database row and `DebtOut` are the same shape by construction, since both are generated from the same migration.

- [ ] **Step 4: Wire it into `backend/app/api/main.py`**

Add the imports:

```python
from .repositories.debts import DebtLimitReached
from .routers import debts as debts_router
```

Add a handler beside `handle_invalid_debt`:

```python
def handle_debt_limit(request: Request, exc: Exception) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content={
            "detail": [
                {"type": "debt_limit_reached", "loc": ["body"], "msg": str(exc)}
            ]
        },
    )
```

And inside `create_app()`, register both:

```python
    app.add_exception_handler(DebtLimitReached, handle_debt_limit)
    app.include_router(debts_router.router, prefix="/v1")
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend && DATABASE_URL=postgresql+psycopg://postgres:postgres@127.0.0.1:54322/postgres .venv/bin/pytest tests/api/test_routes_debts.py -v --no-cov`
Expected: PASS, 13 tests

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/routers/debts.py backend/app/api/main.py backend/app/api/schemas.py backend/tests/api/test_routes_debts.py
git commit -m "feat(api): add debts CRUD endpoints"
```

---

### Task 8: The authenticated payoff endpoint

**Files:**
- Modify: `backend/app/api/routers/payoff_plans.py`
- Test: `backend/tests/api/test_parity.py`

**Interfaces:**
- Consumes: `current_user_id`, `user_scoped_connection`, `repo.list_debts`, `to_response`, `compute_plans`, `compute_schedules`, `summarize_schedules`.
- Produces: `GET /v1/me/payoff-plan`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/api/test_parity.py`:

```python
"""The two payoff endpoints must agree.

One reads debts from the request body, the other from the database. They
share compute_plans and to_response, and this is what stops them drifting.
"""

from fastapi.testclient import TestClient

from app.api.auth import current_user_id
from app.api.main import create_app

PORTFOLIO = [
    {"name": "Store card", "balance": "500.00", "apr": "5.00", "minimum_payment": "25.00"},
    {"name": "Visa", "balance": "2000.00", "apr": "25.00", "minimum_payment": "50.00"},
]


def client_for(user_id: str) -> TestClient:
    app = create_app()
    app.dependency_overrides[current_user_id] = lambda: user_id
    return TestClient(app)


def seed(client: TestClient) -> list[str]:
    return [client.post("/v1/debts", json=d).json()["id"] for d in PORTFOLIO]


def test_authenticated_plan_matches_the_stateless_one(user_a):
    client = client_for(user_a)
    ids = seed(client)

    stored = client.get(
        "/v1/me/payoff-plan",
        params={"extra_monthly_payment": "200.00", "start_month": "2026-09"},
    )
    assert stored.status_code == 200

    stateless = client.post(
        "/v1/payoff-plans",
        json={
            "debts": [{"id": i, **d} for i, d in zip(ids, PORTFOLIO, strict=True)],
            "extra_monthly_payment": "200.00",
            "start_month": "2026-09",
        },
    )
    assert stateless.status_code == 200
    assert stored.json() == stateless.json()


def test_detail_full_works_on_the_authenticated_route(user_a):
    client = client_for(user_a)
    seed(client)
    body = client.get(
        "/v1/me/payoff-plan",
        params={
            "extra_monthly_payment": "200.00",
            "start_month": "2026-09",
            "detail": "full",
        },
    ).json()
    schedule = body["scenarios"]["avalanche"]["schedule"]
    assert schedule is not None
    assert schedule[0]["month"] == "2026-09"


def test_an_account_with_no_debts_returns_zero_month_scenarios(user_a):
    body = client_for(user_a).get(
        "/v1/me/payoff-plan",
        params={"extra_monthly_payment": "200.00", "start_month": "2026-09"},
    ).json()
    assert body["scenarios"]["avalanche"]["months_to_payoff"] == 0
    assert body["scenarios"]["avalanche"]["payoff_month"] is None


def test_one_users_plan_ignores_another_users_debts(user_a, user_b):
    seed(client_for(user_a))
    body = client_for(user_b).get(
        "/v1/me/payoff-plan",
        params={"extra_monthly_payment": "200.00", "start_month": "2026-09"},
    ).json()
    assert body["scenarios"]["avalanche"]["months_to_payoff"] == 0


def test_the_route_requires_a_token():
    anonymous = TestClient(create_app())
    assert anonymous.get(
        "/v1/me/payoff-plan",
        params={"extra_monthly_payment": "200.00", "start_month": "2026-09"},
    ).status_code == 401


def test_a_malformed_start_month_is_a_422(user_a):
    assert client_for(user_a).get(
        "/v1/me/payoff-plan",
        params={"extra_monthly_payment": "200.00", "start_month": "2026-13"},
    ).status_code == 422


def test_a_negative_extra_payment_is_a_422(user_a):
    assert client_for(user_a).get(
        "/v1/me/payoff-plan",
        params={"extra_monthly_payment": "-1.00", "start_month": "2026-09"},
    ).status_code == 422
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/api/test_parity.py -v --no-cov`
Expected: FAIL — 404, because `/v1/me/payoff-plan` does not exist.

- [ ] **Step 3: Add the route to `backend/app/api/routers/payoff_plans.py`**

Add these imports at the top of the file:

```python
from fastapi import Depends
from pydantic import Field

from ..auth import current_user_id
from ..db import user_scoped_connection
from ..repositories import debts as debts_repo
from ..dates import MONTH_PATTERN
from ..schemas import Money
```

Then append the route:

```python
@router.get("/me/payoff-plan", response_model=PayoffPlanResponse)
def my_payoff_plan(
    extra_monthly_payment: Money = Query(ge=0, le=Decimal("99999999.99")),
    start_month: str = Query(pattern=MONTH_PATTERN),
    detail: Literal["full"] | None = Query(
        default=None,
        description="Pass 'full' to include the per-debt month-by-month schedule.",
    ),
    user_id: str = Depends(current_user_id),
) -> PayoffPlanResponse:
    """The signed-in user's plan, computed from their stored debts.

    Money arrives as a query parameter here, so it is a string by definition:
    the Money type still parses it to Decimal, but its reject-bare-numbers
    guarantee is trivially satisfied. The bounds are what do the work.
    """
    with user_scoped_connection(user_id) as conn:
        rows = debts_repo.list_debts(conn, user_id)

    debts = [
        Debt(
            id=str(row.id),
            name=row.name,
            balance=row.balance,
            apr=row.apr,
            minimum_payment=row.minimum_payment,
        )
        for row in rows
    ]

    if detail == "full":
        schedules = compute_schedules(debts, extra_monthly_payment)
        comparison = summarize_schedules(schedules, debts)
    else:
        schedules = None
        comparison = compute_plans(debts, extra_monthly_payment)

    return to_response(comparison, start_month, schedules)
```

`Decimal` must be imported in this module if it is not already (`from decimal import Decimal`).

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && DATABASE_URL=postgresql+psycopg://postgres:postgres@127.0.0.1:54322/postgres .venv/bin/pytest tests/api/test_parity.py -v --no-cov`
Expected: PASS, 7 tests

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/routers/payoff_plans.py backend/tests/api/test_parity.py
git commit -m "feat(api): add GET /v1/me/payoff-plan reading stored debts"
```

---

### Task 9: CI, configuration, and documentation

**Files:**
- Modify: `.github/workflows/backend.yml`
- Create: `backend/.env.example` (replace the existing one)
- Modify: `README.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: the full suite.
- Produces: a CI run that starts Supabase, applies the migration, and enforces 100% coverage across `app`.

- [ ] **Step 1: Update `backend/.env.example`**

```bash
# Comma-separated CORS origins for the API. Every Vercel preview deployment
# gets its own origin, so this must not be hardcoded in the app.
ALLOWED_ORIGINS=http://localhost:3000

# Supabase project URL. Used to fetch JWKS and to check the `iss` claim.
SUPABASE_URL=https://your-project.supabase.co

# Postgres connection. Contains a password: never commit a real value.
# Local Supabase prints this as "DB URL" when you run `supabase start`.
DATABASE_URL=postgresql+psycopg://postgres:postgres@127.0.0.1:54322/postgres
```

- [ ] **Step 2: Update the workflow**

Replace `.github/workflows/backend.yml` with:

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
    env:
      SUPABASE_URL: https://test.supabase.co
      DATABASE_URL: postgresql+psycopg://postgres:postgres@127.0.0.1:54322/postgres
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - uses: supabase/setup-cli@v1
        with:
          version: latest
      - name: Start Supabase
        run: supabase start
      - name: Install
        run: pip install -e ".[dev]"
      - name: Test with coverage gate
        run: pytest
```

`supabase start` applies everything in `migrations/` on a fresh database, so no separate migrate step is needed.

- [ ] **Step 3: Run the whole suite with the gate**

Run: `cd backend && SUPABASE_URL=https://test.supabase.co DATABASE_URL=postgresql+psycopg://postgres:postgres@127.0.0.1:54322/postgres .venv/bin/pytest`
Expected: PASS at 100% coverage across `app`. If a line or branch is uncovered, add a test for it — never a `# pragma: no cover`. The likely gaps are the `DebtLimitReached` handler and the `detail == "full"` branch on the new route; Tasks 7 and 8 cover both, so an uncovered line here means a test was skipped.

- [ ] **Step 4: Document the endpoints in `README.md`**

Under the existing "Running the API" section, add:

````markdown
### Authenticated endpoints

Signed-in users manage their debts through the API rather than writing to
Postgres directly, so the money rules live in one place.

```
POST   /v1/debts             create        GET /v1/debts        list
PATCH  /v1/debts/{id}        partial edit  DELETE /v1/debts/{id}
GET    /v1/me/payoff-plan?extra_monthly_payment=200.00&start_month=2026-09
```

All require a Supabase `Authorization: Bearer <jwt>` header. A user may store
up to 20 debts. Requests for a debt that does not exist — or belongs to
someone else — return 404 rather than 403, so the API never confirms that a
row exists in another account.

Isolation is enforced twice: every query filters on `user_id`, and row-level
security policies in Postgres enforce the same rule with
`FORCE ROW LEVEL SECURITY`, which applies them to the table's owner as well.

Local development needs Docker running and the Supabase CLI:

```bash
cd backend && supabase start   # prints the DB URL for your .env
```
````

Then update the roadmap: change `- [ ] Debts CRUD with persistence` to
`- [x] Debts CRUD with persistence (Supabase Auth, Postgres, RLS)`.

- [ ] **Step 5: Update `CLAUDE.md`**

Replace the `**users**` table block in "## Database schema" with:

```markdown
**users** — not a table. Supabase Auth owns `auth.users`; mirroring it would
create a second source of truth for identity. `debts.user_id` references it
directly. Add a `public.profiles` table later if profile data is needed.
```

In the same section, remove `statement_day` from **debts** and add below it:

```markdown
`statement_day` was dropped: it anticipated daily compounding, which the
engine defers, and a nullable column nothing reads drifts out of sync with
reality. Row-level security is enabled AND forced on this table; see
`docs/superpowers/specs/2026-08-31-persistence-auth-design.md`.
```

Under "## API endpoints", replace the Debts block with:

```markdown
Debts — built. All require a Supabase bearer token; all enforce isolation
through both an explicit user_id filter and RLS.
- POST /v1/debts, GET /v1/debts, PATCH /v1/debts/{id}, DELETE /v1/debts/{id}
- Maximum 20 debts per user, enforced at insert.
- A foreign or unknown debt id is a 404, never a 403.
- GET /v1/me/payoff-plan — the signed-in user's plan from their stored debts.
  POST /v1/payoff-plans remains stateless and unauthenticated: it is the
  anonymous try-before-you-sign-up path.
```

Add to "## Conventions":

```markdown
- Every database query runs inside `user_scoped_connection`, which sets
  `request.jwt.claims` transaction-locally so RLS can resolve `auth.uid()`.
  Never use `SET LOCAL` for this: it cannot take a bind parameter.
```

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/backend.yml backend/.env.example README.md CLAUDE.md
git commit -m "ci(db): run Supabase in CI and document the authenticated endpoints"
```

---

## Self-Review

**Spec coverage.** Every section maps to a task:

| Spec section | Task |
|---|---|
| §3.1 backend owns data access | 6, 7 |
| §3.2 RLS plus explicit filter | 1, 2, 3, 6 |
| §3.3 stateless endpoint unchanged | 8 (adds a sibling route, touches nothing existing) |
| §3.4 SQLAlchemy Core, Supabase CLI migrations | 1, 2 |
| §4 schema, FORCE RLS, both policy clauses | 1 |
| §5.1 token verification | 4 |
| §5.2 request-scoped transaction, `set_config(..., true)` | 2 |
| §5.3 401/200 failure modes | 4, 7 |
| §6 endpoints, 404-not-403, empty PATCH, insert cap | 6, 7 |
| §7 layout, repository, `DebtCreate` vs `DebtIn` | 5, 6, 7 |
| §8 test layers, mutation check | 1, 3, 4, 5, 6, 7, 8 |
| §9 secrets and configuration | 9 |
| §10 deferred items | deliberately not built |

**Placeholder scan.** No "TBD", no "add validation", no "similar to Task N". Every code step carries runnable code; every test step carries real assertions.

**Type consistency.** `user_scoped_connection(user_id)` is defined in Task 2 and called in Tasks 3, 7, and 8. `DebtCreate`/`DebtUpdate`/`DebtOut` and `MAX_DEBTS_PER_USER` are defined in Task 5 and consumed in Tasks 6 and 7. The repository's signatures in Task 6 — all taking `(conn, user_id, ...)` — are called with exactly that shape in Tasks 7 and 8. `DebtLimitReached` is raised in Task 6 and handled in Task 7. `current_user_id` is defined in Task 4 and used as a dependency in Tasks 7 and 8, and overridden by name in both test files. `MONTH_PATTERN` and `Money` come from existing modules and are reused unchanged.

**One thing worth flagging to a reviewer.** Task 7 introduces `from_attributes=True` on `DebtOut`, which is the pattern the API spec explicitly rejected for payoff responses. The distinction is deliberate: that rejection was about converting *engine* dataclasses across a published boundary, where a field rename must surface as a reviewable diff. `DebtOut` and a `debts` row are the same shape by construction — both derive from the same migration — so there is no independent contract to drift from. If a reviewer disagrees, the fallback is an explicit row-to-model function in the router, at the cost of restating eight field names.
