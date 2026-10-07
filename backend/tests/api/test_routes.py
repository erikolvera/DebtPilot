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


def report_body() -> dict:
    return {
        "incomes": [],
        "expenses": [],
        "debts": [
            {"id": "a", "name": "Store card", "balance": "500.00",
             "apr": "5.00", "minimum_payment": "25.00"},
        ],
        "requested_extra_monthly_payment": "0.00",
        "start_month": "2026-09",
    }


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
        "/v1/financial-reports",
        content=oversized,
        headers={"content-type": "application/json"},
    )
    assert response.status_code == 413
    entry = response.json()["detail"][0]
    assert entry["type"] == "request_too_large"
    assert entry["loc"] == ["header", "content-length"]


def test_a_body_under_the_size_cap_is_processed_normally(client):
    response = client.post("/v1/financial-reports", json=report_body())
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
        "path": "/v1/financial-reports",
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
    schema = create_app().openapi()["components"]["schemas"]["FinancialReportDebtIn"]
    balance = schema["properties"]["balance"]
    assert balance.get("type") == "string", balance
    assert "anyOf" not in balance
