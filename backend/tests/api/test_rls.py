"""Cross-user isolation, enforced by Postgres rather than by application code.

These run through `user_scoped_connection` -- the same path production uses --
rather than against raw SQL, so they exercise the real mechanism.
"""

from decimal import Decimal

import pytest
from sqlalchemy import text

from app.api.db import get_engine, user_scoped_connection
from tests.api.conftest import APP_DB_URL

INSERT = text(
    """
    insert into public.debts (user_id, name, balance, apr, minimum_payment)
    values (:user_id, :name, :balance, :apr, :minimum_payment)
    returning id
    """
)


@pytest.fixture(autouse=True)
def _app_database_url(monkeypatch):
    # The app must connect as app_user, never as the privileged postgres
    # role used by conftest's setup/cleanup fixtures, or RLS would appear to
    # work while silently being bypassed. See conftest.py's module docstring.
    monkeypatch.setenv("DATABASE_URL", APP_DB_URL)
    get_engine.cache_clear()
    yield
    get_engine.cache_clear()


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
