"""The two payoff endpoints must agree.

One reads debts from the request body, the other from the database. They
share compute_plans and to_response, and this is what stops them drifting.
"""

import pytest
from fastapi.testclient import TestClient

from app.api.auth import current_user_id
from app.api.db import get_engine
from app.api.main import create_app
from tests.api.conftest import APP_DB_URL

PORTFOLIO = [
    {"name": "Store card", "balance": "500.00", "apr": "5.00", "minimum_payment": "25.00"},
    {"name": "Visa", "balance": "2000.00", "apr": "25.00", "minimum_payment": "50.00"},
]


@pytest.fixture(autouse=True)
def _app_database_url(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", APP_DB_URL)
    get_engine.cache_clear()
    yield
    get_engine.cache_clear()


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
