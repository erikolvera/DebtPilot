from decimal import Decimal

import pytest

from app.api.db import get_engine, user_scoped_connection
from app.api.repositories import debts as repo
from app.api.schemas import DebtCreate, DebtUpdate
from tests.api.conftest import APP_DB_URL


@pytest.fixture(autouse=True)
def _app_database_url(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", APP_DB_URL)
    get_engine.cache_clear()
    yield
    get_engine.cache_clear()


def make(name="Visa", balance="1000.00") -> DebtCreate:
    return DebtCreate(name=name, balance=balance, apr="24.99", minimum_payment="50.00")


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
    # One transaction per debt, mirroring real usage where each POST is its
    # own request. This matters: created_at defaults to now(), which in
    # Postgres is the TRANSACTION timestamp, so several inserts inside one
    # transaction share a timestamp and fall back to the id tiebreak -- a
    # random UUID, and therefore an arbitrary order.
    for name in ("first", "second", "third"):
        with user_scoped_connection(user_a) as conn:
            repo.create_debt(conn, user_a, make(name))
    with user_scoped_connection(user_a) as conn:
        assert [d.name for d in repo.list_debts(conn, user_a)] == [
            "first", "second", "third"
        ]


def test_list_ordering_is_deterministic_within_one_transaction(user_a):
    # Same-transaction inserts tie on created_at, so the id tiebreak decides.
    # The order is arbitrary but must be stable, never varying between calls.
    with user_scoped_connection(user_a) as conn:
        for name in ("a", "b", "c"):
            repo.create_debt(conn, user_a, make(name))
        first = [d.name for d in repo.list_debts(conn, user_a)]
        second = [d.name for d in repo.list_debts(conn, user_a)]
    assert first == second
    assert sorted(first) == ["a", "b", "c"]


def test_update_applies_only_the_supplied_fields(user_a):
    with user_scoped_connection(user_a) as conn:
        debt_id = repo.create_debt(conn, user_a, make()).id
        updated = repo.update_debt(conn, user_a, str(debt_id), DebtUpdate(balance="500.00"))
    assert updated.balance == Decimal("500.00")
    assert updated.name == "Visa"


def test_update_can_change_several_fields_at_once(user_a):
    with user_scoped_connection(user_a) as conn:
        debt_id = repo.create_debt(conn, user_a, make()).id
        updated = repo.update_debt(
            conn, user_a, str(debt_id), DebtUpdate(name="Renamed", apr="9.99")
        )
    assert updated.name == "Renamed"
    assert updated.apr == Decimal("9.99")


def test_update_returns_none_for_another_users_debt(user_a, user_b):
    with user_scoped_connection(user_a) as conn:
        debt_id = repo.create_debt(conn, user_a, make()).id
    with user_scoped_connection(user_b) as conn:
        assert repo.update_debt(conn, user_b, str(debt_id), DebtUpdate(name="x")) is None


def test_update_touches_updated_at(user_a):
    # Two transactions on purpose. now() is the TRANSACTION timestamp, so a
    # create and an update inside one transaction share it -- and this test
    # would then pass even with the trigger deleted, since updated_at would
    # simply keep its equal insert value.
    with user_scoped_connection(user_a) as conn:
        created = repo.create_debt(conn, user_a, make())
    with user_scoped_connection(user_a) as conn:
        updated = repo.update_debt(
            conn, user_a, str(created.id), DebtUpdate(name="Renamed")
        )
    assert updated.updated_at > created.updated_at

def test_delete_reports_whether_a_row_went(user_a):
    with user_scoped_connection(user_a) as conn:
        debt_id = str(repo.create_debt(conn, user_a, make()).id)
        assert repo.delete_debt(conn, user_a, debt_id) is True
        assert repo.delete_debt(conn, user_a, debt_id) is False


def test_delete_returns_false_for_another_users_debt(user_a, user_b):
    with user_scoped_connection(user_a) as conn:
        debt_id = str(repo.create_debt(conn, user_a, make()).id)
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
