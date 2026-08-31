"""The CRUD endpoints, exercised through HTTP against the real database.

Auth is overridden with FastAPI's dependency_overrides rather than by minting
tokens: token verification is covered in test_auth.py, and these tests are
about routing, status codes, and isolation.
"""

import pytest
from fastapi.testclient import TestClient

from app.api.auth import current_user_id
from app.api.db import get_engine
from app.api.main import create_app
from tests.api.conftest import APP_DB_URL


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


def test_a_malformed_debt_id_is_a_422_not_a_500(user_a):
    # Typed str, this reaches a uuid column and raises DataError with no
    # handler -- a 500 from a malformed URL.
    client = client_for(user_a)
    assert client.patch("/v1/debts/not-a-uuid", json={"name": "x"}).status_code == 422
    assert client.delete("/v1/debts/not-a-uuid").status_code == 422


def test_a_nul_byte_in_the_name_is_a_422_not_a_500(user_a):
    assert client_for(user_a).post(
        "/v1/debts", json=payload(name="ab\x00cd")
    ).status_code == 422
