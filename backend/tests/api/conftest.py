"""Database fixtures for the tests that need a real Postgres.

Row-level security cannot be tested against a mock: a fake connection
exercises the SQL string, not the engine that enforces the policies. These
fixtures point at the local Supabase stack, which ships the real `auth`
schema and the real `auth.uid()`.

Two connection URLs are in play. ADMIN_DB_URL (`postgres`) is privileged:
it owns the table and is used for setup and cleanup, which must see rows
regardless of RLS. APP_DB_URL (`app_user`) is what the application itself
connects as, and is neither a superuser nor RLS-exempt, so the policies in
the migration actually apply to it. Later tasks point `DATABASE_URL` at
APP_DB_URL.
"""

import os
import uuid
from collections.abc import Iterator

import pytest

from app.api.guidance.service import reset_model_budget
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Connection, Engine

ADMIN_DB_URL = "postgresql+psycopg://postgres:postgres@127.0.0.1:54322/postgres"
APP_DB_URL = "postgresql+psycopg://app_user:app_user@127.0.0.1:54322/postgres"


@pytest.fixture(scope="session")
def db_engine() -> Engine:
    return create_engine(os.environ.get("ADMIN_DATABASE_URL", ADMIN_DB_URL), future=True)


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
def user_a(db_engine: Engine) -> str:
    # Own committing transaction: db_conn's transaction is still open when a
    # test runs, so a separate connection (e.g. one opened as app_user to
    # exercise RLS) cannot see an uncommitted row and the debts.user_id
    # foreign key fails.
    with db_engine.begin() as conn:
        return _make_user(conn)


@pytest.fixture
def user_b(db_engine: Engine) -> str:
    with db_engine.begin() as conn:
        return _make_user(conn)


@pytest.fixture(autouse=True)
def clean_debts(db_engine: Engine) -> Iterator[None]:
    yield
    with db_engine.begin() as conn:
        conn.execute(text("delete from public.debts"))
        conn.execute(text("delete from auth.users where email like '%@example.test'"))


@pytest.fixture(autouse=True)
def _reset_guidance_budget():
    """Clear the process-wide model-call budget between tests.

    It is module-level state by design -- a per-process ceiling is the point --
    which makes it leak across tests: the budget test deliberately exhausts it,
    and without this every later test that reaches a provider would silently
    receive the template and assert against the wrong source.
    """
    reset_model_budget()
    yield
    reset_model_budget()
