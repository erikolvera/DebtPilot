"""The explain endpoint, exercised on the template provider.

Every test here runs with no API key, so the deterministic fallback serves the
narrative -- real production code, the same path used whenever generation is
unavailable, and no network.
"""

import pytest
from fastapi.testclient import TestClient

from app.api.guidance.ratelimit import RATE_LIMIT, reset_limiter
from app.api.main import create_app


@pytest.fixture(autouse=True)
def _no_key(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    reset_limiter()
    yield
    reset_limiter()


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app())


def body(**overrides) -> dict:
    payload = {
        "debts": [
            {"id": "a", "name": "Store card", "balance": "500.00",
             "apr": "5.00", "minimum_payment": "25.00"},
            {"id": "b", "name": "Visa", "balance": "2000.00",
             "apr": "25.00", "minimum_payment": "50.00"},
        ],
        "extra_monthly_payment": "200.00",
        "start_month": "2026-09",
    }
    payload.update(overrides)
    return payload


def test_a_narrative_comes_back(client):
    response = client.post("/v1/payoff-plans/explain", json=body())
    assert response.status_code == 200
    payload = response.json()
    assert payload["headline"].strip()
    assert payload["body"].strip()
    assert payload["source"] == "template"


def test_the_narrative_contains_no_template_syntax(client):
    payload = client.post("/v1/payoff-plans/explain", json=body()).json()
    assert "{" not in payload["headline"] + payload["body"]


def test_the_narrative_quotes_figures_the_engine_computed(client):
    payload = client.post("/v1/payoff-plans/explain", json=body()).json()
    plan = client.post("/v1/payoff-plans", json=body()).json()
    months = plan["scenarios"]["avalanche"]["months_to_payoff"]
    assert f"{months} months" in payload["headline"] + payload["body"]


def test_the_route_needs_no_authentication(client):
    # The narrative is what makes the plan land; gating it gates the pitch.
    assert client.post("/v1/payoff-plans/explain", json=body()).status_code == 200


def test_an_empty_portfolio_is_a_200_with_a_sensible_line(client):
    payload = client.post("/v1/payoff-plans/explain", json=body(debts=[])).json()
    assert payload["source"] == "template"
    assert payload["headline"].strip()


def test_a_portfolio_that_never_pays_off_is_a_200(client):
    response = client.post(
        "/v1/payoff-plans/explain",
        json=body(
            debts=[{"id": "a", "name": "Maxed", "balance": "10000.00",
                    "apr": "24.00", "minimum_payment": "100.00"}],
            extra_monthly_payment="0.00",
        ),
    )
    assert response.status_code == 200
    assert response.json()["headline"].strip()


def test_money_as_a_json_number_is_a_422(client):
    payload = body()
    payload["debts"][0]["balance"] = 500.00
    assert client.post("/v1/payoff-plans/explain", json=payload).status_code == 422


def test_a_malformed_start_month_is_a_422(client):
    assert client.post(
        "/v1/payoff-plans/explain", json=body(start_month="2026-13")
    ).status_code == 422


def test_duplicate_debt_ids_are_a_422(client):
    payload = body()
    payload["debts"][1]["id"] = "a"
    assert client.post("/v1/payoff-plans/explain", json=payload).status_code == 422


def test_the_rate_limit_applies(client):
    for _ in range(RATE_LIMIT):
        assert client.post("/v1/payoff-plans/explain", json=body()).status_code == 200
    response = client.post("/v1/payoff-plans/explain", json=body())
    assert response.status_code == 429
    assert response.json()["detail"][0]["type"] == "rate_limited"


def test_the_limit_applies_even_without_a_paid_call(client):
    # Every request here is served by the template. Making the limit
    # conditional on a paid call would remove it exactly when the endpoint is
    # cheapest to hammer.
    for _ in range(RATE_LIMIT):
        client.post("/v1/payoff-plans/explain", json=body())
    assert client.post("/v1/payoff-plans/explain", json=body()).status_code == 429


def test_the_plan_route_is_not_rate_limited(client):
    for _ in range(RATE_LIMIT + 5):
        assert client.post("/v1/payoff-plans", json=body()).status_code == 200
