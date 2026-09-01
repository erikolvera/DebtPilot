import asyncio

import pytest
from fastapi.testclient import TestClient

from app.api.main import (
    MAX_BODY_BYTES,
    BodySizeLimitMiddleware,
    allowed_origins,
    create_app,
)


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app())


def portfolio_body(**overrides) -> dict:
    body = {
        "debts": [
            {"id": "a", "name": "Store card", "balance": "500.00",
             "apr": "5.00", "minimum_payment": "25.00"},
            {"id": "b", "name": "Visa", "balance": "2000.00",
             "apr": "25.00", "minimum_payment": "50.00"},
        ],
        "extra_monthly_payment": "200.00",
        "start_month": "2026-09",
    }
    body.update(overrides)
    return body


def test_health_returns_ok(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_health_is_not_versioned(client):
    # Health describes the process, not the API contract, so it must keep
    # working across a future /v2.
    assert client.get("/v1/health").status_code == 404


def test_allowed_origins_defaults_to_local_dev(monkeypatch):
    monkeypatch.delenv("ALLOWED_ORIGINS", raising=False)
    assert allowed_origins() == ["http://localhost:3000"]


def test_allowed_origins_splits_and_strips_the_env_var(monkeypatch):
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://a.example, https://b.example ")
    assert allowed_origins() == ["https://a.example", "https://b.example"]


def test_allowed_origins_ignores_empty_entries(monkeypatch):
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://a.example,,")
    assert allowed_origins() == ["https://a.example"]


def test_cors_headers_are_sent_for_an_allowed_origin(monkeypatch):
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://app.example")
    client = TestClient(create_app())
    response = client.get("/health", headers={"Origin": "https://app.example"})
    assert response.headers["access-control-allow-origin"] == "https://app.example"


def test_happy_path_returns_all_three_scenarios(client):
    response = client.post("/v1/payoff-plans", json=portfolio_body())
    assert response.status_code == 200
    body = response.json()
    assert set(body["scenarios"]) == {"snowball", "avalanche", "baseline"}
    assert body["start_month"] == "2026-09"


def test_money_comes_back_as_strings(client):
    body = client.post("/v1/payoff-plans", json=portfolio_body()).json()
    assert isinstance(body["scenarios"]["avalanche"]["total_interest_paid"], str)
    assert isinstance(body["comparison"]["interest_saved_avalanche_vs_snowball"], str)


def test_comparison_carries_every_delta(client):
    comparison = client.post("/v1/payoff-plans", json=portfolio_body()).json()["comparison"]
    assert set(comparison) == {
        "interest_saved_snowball_vs_baseline",
        "interest_saved_avalanche_vs_baseline",
        "interest_saved_avalanche_vs_snowball",
        "months_saved_snowball_vs_baseline",
        "months_saved_avalanche_vs_baseline",
        "months_saved_avalanche_vs_snowball",
    }


def test_empty_portfolio_returns_zero_month_scenarios(client):
    body = client.post("/v1/payoff-plans", json=portfolio_body(debts=[])).json()
    assert body["scenarios"]["avalanche"]["months_to_payoff"] == 0
    assert body["scenarios"]["avalanche"]["payoff_month"] is None


def test_route_is_versioned(client):
    assert client.post("/payoff-plans", json=portfolio_body()).status_code == 404


def test_money_as_a_json_number_is_a_422(client):
    body = portfolio_body()
    body["debts"][0]["balance"] = 500.00
    response = client.post("/v1/payoff-plans", json=body)
    assert response.status_code == 422
    assert "JSON string" in response.text


def test_negative_extra_payment_is_a_422(client):
    response = client.post("/v1/payoff-plans", json=portfolio_body(extra_monthly_payment="-1.00"))
    assert response.status_code == 422


def test_malformed_start_month_is_a_422(client):
    response = client.post("/v1/payoff-plans", json=portfolio_body(start_month="2026-13"))
    assert response.status_code == 422


def test_unknown_field_is_a_422(client):
    response = client.post("/v1/payoff-plans", json=portfolio_body(extra_payment="200.00"))
    assert response.status_code == 422


def many_debts(count: int) -> list[dict]:
    return [
        {"id": f"d{i}", "name": f"Card {i}", "balance": "100.00",
         "apr": "10.00", "minimum_payment": "25.00"}
        for i in range(count)
    ]


def test_too_many_debts_is_a_422(client):
    body = portfolio_body(debts=many_debts(21))
    assert client.post("/v1/payoff-plans", json=body).status_code == 422


def test_exactly_twenty_debts_is_accepted(client):
    body = portfolio_body(debts=many_debts(20))
    assert client.post("/v1/payoff-plans", json=body).status_code == 200


def test_duplicate_debt_ids_are_a_422_from_the_engine(client):
    # Pydantic cannot see this; the engine raises InvalidDebt and the handler
    # turns it into a 422 rather than letting it escape as a 500.
    duplicated = portfolio_body()
    duplicated["debts"][1]["id"] = "a"
    response = client.post("/v1/payoff-plans", json=duplicated)
    assert response.status_code == 422
    entry = response.json()["detail"][0]
    assert entry["type"] == "invalid_debt"
    # FastAPI's own 422 entries always carry a `loc`. Without one here, a
    # client written against the framework envelope has two shapes to parse.
    assert entry["loc"] == ["body", "debts"]


def test_never_pays_off_returns_200_not_an_error(client):
    # The single most important thing the product can tell this user. Returning
    # 4xx would route it into every client's error path.
    body = client.post(
        "/v1/payoff-plans",
        json=portfolio_body(
            debts=[{"id": "a", "name": "Maxed card", "balance": "10000.00",
                    "apr": "24.00", "minimum_payment": "100.00"}],
            extra_monthly_payment="3000.00",
        ),
    )
    assert body.status_code == 200
    payload = body.json()
    assert payload["scenarios"]["baseline"]["outcome"] == "never_pays_off"
    assert payload["scenarios"]["baseline"]["payoff_month"] is None
    assert payload["scenarios"]["baseline"]["underwater_debt_ids"] == ["a"]
    assert payload["comparison"]["interest_saved_avalanche_vs_baseline"] is None


def test_cors_does_not_advertise_credentialed_requests(monkeypatch):
    # There is no auth and no cookie in this slice, so allow_credentials would
    # grant nothing today and become a footgun the moment ALLOWED_ORIGINS=*.
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://app.example")
    client = TestClient(create_app())
    response = client.get("/health", headers={"Origin": "https://app.example"})
    assert "access-control-allow-credentials" not in response.headers


def test_cors_preflight_allows_every_verb_the_api_serves(monkeypatch):
    # The anonymous API serves only reads and calculations.
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://app.example")
    client = TestClient(create_app())
    response = client.options(
        "/v1/debts",
        headers={
            "Origin": "https://app.example",
            "Access-Control-Request-Method": "POST",
        },
    )
    allowed = response.headers["access-control-allow-methods"]
    for verb in ("GET", "POST"):
        assert verb in allowed


def test_a_body_over_the_size_cap_is_a_413(client):
    # `max_length=20` on `debts` runs only after the whole body is buffered
    # and parsed, so it is not a request-size cap. This is.
    oversized = b'{"padding": "' + b"x" * (MAX_BODY_BYTES + 1) + b'"}'
    response = client.post(
        "/v1/payoff-plans",
        content=oversized,
        headers={"content-type": "application/json"},
    )
    assert response.status_code == 413
    entry = response.json()["detail"][0]
    assert entry["type"] == "request_too_large"
    assert entry["loc"] == ["header", "content-length"]


def test_a_body_under_the_size_cap_is_processed_normally(client):
    response = client.post("/v1/payoff-plans", json=portfolio_body())
    assert response.status_code == 200
    assert int(response.request.headers["content-length"]) <= MAX_BODY_BYTES


def test_a_chunked_body_over_the_size_cap_is_a_413_before_the_app_runs():
    downstream_called = False
    sent = []
    chunks = iter(
        [
            {"type": "http.request", "body": b"x" * MAX_BODY_BYTES, "more_body": True},
            {"type": "http.request", "body": b"x", "more_body": False},
        ]
    )

    async def downstream(scope, receive, send):
        nonlocal downstream_called
        downstream_called = True

    async def receive():
        return next(chunks)

    async def send(message):
        sent.append(message)

    scope = {
        "type": "http",
        "method": "POST",
        "path": "/v1/payoff-plans",
        "headers": [],
    }
    asyncio.run(BodySizeLimitMiddleware(downstream)(scope, receive, send))

    assert not downstream_called
    assert sent[0]["type"] == "http.response.start"
    assert sent[0]["status"] == 413


def test_a_request_with_no_content_length_is_not_rejected(client):
    # A GET carries no content-length at all; the guard must ignore it rather
    # than treat a missing header as an oversized body.
    response = client.get("/health")
    assert "content-length" not in response.request.headers
    assert response.status_code == 200


def test_non_http_scopes_pass_straight_through():
    # The lifespan scope reaches the middleware too, and it has no headers to
    # inspect. Entering the context manager is what runs startup and shutdown.
    with TestClient(create_app()) as client:
        assert client.get("/health").status_code == 200


def test_openapi_types_request_money_as_a_string():
    # A BeforeValidator does not change the generated schema on its own, so
    # without json_schema_input_type this advertises `number | string` while
    # the code rejects numbers — and the frontend's types are generated here.
    schema = create_app().openapi()["components"]["schemas"]["DebtIn"]
    balance = schema["properties"]["balance"]
    assert balance.get("type") == "string", balance
    assert "anyOf" not in balance
