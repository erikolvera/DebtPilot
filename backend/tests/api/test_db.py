import json

import pytest
from sqlalchemy import text

from app.api.db import database_url, get_engine, user_scoped_connection
from tests.api.conftest import APP_DB_URL


@pytest.fixture(autouse=True)
def _app_database_url(monkeypatch):
    # The app must connect as app_user, never as the privileged postgres
    # role used by conftest's setup/cleanup fixtures, or RLS would appear to
    # work while silently being bypassed. See conftest.py's module docstring.
    monkeypatch.setenv("DATABASE_URL", APP_DB_URL)
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
    monkeypatch.setenv("DATABASE_URL", APP_DB_URL)
    assert get_engine() is get_engine()


def test_user_scoped_connection_sets_the_claims(user_a):
    with user_scoped_connection(user_a) as conn:
        claims = conn.execute(
            text("select current_setting('request.jwt.claims', true)")
        ).scalar_one()
        assert json.loads(claims)["sub"] == user_a


def test_the_request_user_id_resolves_inside_the_transaction(user_a):
    with user_scoped_connection(user_a) as conn:
        assert str(conn.execute(text("select public.request_user_id()")).scalar_one()) == user_a


def test_claims_do_not_leak_to_a_later_connection(user_a):
    with user_scoped_connection(user_a) as conn:
        assert conn.execute(text("select public.request_user_id()")).scalar_one() is not None
    # A fresh transaction must start with no identity. Had set_config been
    # called with is_local=false, a pooled connection would carry the previous
    # user's id into this one.
    with get_engine().begin() as conn:
        assert conn.execute(text("select public.request_user_id()")).scalar_one() is None
