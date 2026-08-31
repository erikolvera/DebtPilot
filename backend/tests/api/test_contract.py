"""The two properties the API layer must never break.

The first makes the deliberate validation overlap safe: Pydantic re-checks
rules the engine also enforces, and if the two ever disagree the result must
be a well-formed 422, never an unhandled 500.

The second guards the one bug class this layer can uniquely introduce: a
mapper that silently drops a field or rounds a delta.
"""

from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from app.api.main import create_app
from app.engine import Debt, InvalidDebt, compute_plans


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app())


def body(debts, extra="200.00", start="2026-09") -> dict:
    return {"debts": debts, "extra_monthly_payment": extra, "start_month": start}


WIRE_PORTFOLIO = [
    {"id": "a", "name": "Store card", "balance": "500.00",
     "apr": "5.00", "minimum_payment": "25.00"},
    {"id": "b", "name": "Visa", "balance": "2000.00",
     "apr": "25.00", "minimum_payment": "50.00"},
]

ENGINE_PORTFOLIO = [
    Debt("a", "Store card", Decimal("500.00"), Decimal("5.00"), Decimal("25.00")),
    Debt("b", "Visa", Decimal("2000.00"), Decimal("25.00"), Decimal("50.00")),
]

REJECTED_INPUTS = [
    pytest.param(
        [{"id": "a", "name": "A", "balance": "100.00", "apr": "10.00", "minimum_payment": "25.00"},
         {"id": "a", "name": "B", "balance": "200.00", "apr": "10.00", "minimum_payment": "25.00"}],
        "200.00", id="duplicate-ids"),
    pytest.param(
        [{"id": "a", "name": "A", "balance": "100.00", "apr": "10.00", "minimum_payment": "25.00"}],
        "-1.00", id="negative-extra"),
    pytest.param(
        [{"id": "a", "name": "A", "balance": "-100.00", "apr": "10.00", "minimum_payment": "25.00"}],
        "200.00", id="negative-balance"),
    pytest.param(
        [{"id": "a", "name": "A", "balance": "100.00", "apr": "-1.00", "minimum_payment": "25.00"}],
        "200.00", id="negative-apr"),
    pytest.param(
        [{"id": "a", "name": "A", "balance": "100.00", "apr": "10.00", "minimum_payment": "-5.00"}],
        "200.00", id="negative-minimum"),
]


@pytest.mark.parametrize("debts,extra", REJECTED_INPUTS)
def test_every_rejected_input_is_a_422_never_a_500(client, debts, extra):
    response = client.post("/v1/payoff-plans", json=body(debts, extra))
    assert response.status_code == 422, response.text
    assert "detail" in response.json()


def test_duplicate_ids_really_would_raise_without_the_handler():
    # Proves the 422 above comes from a registered handler, not from Pydantic
    # happening to catch it: the engine genuinely raises on this input, so
    # without the handler the same request would surface as a 500.
    with pytest.raises(InvalidDebt):
        compute_plans(
            [
                Debt("a", "A", Decimal("100.00"), Decimal("10.00"), Decimal("25.00")),
                Debt("a", "B", Decimal("200.00"), Decimal("10.00"), Decimal("25.00")),
            ],
            Decimal("200.00"),
        )


def test_response_numbers_equal_the_engines_own_output(client):
    expected = compute_plans(ENGINE_PORTFOLIO, Decimal("200.00"))
    payload = client.post("/v1/payoff-plans", json=body(WIRE_PORTFOLIO)).json()

    for name, summary in (
        ("snowball", expected.snowball),
        ("avalanche", expected.avalanche),
        ("baseline", expected.baseline),
    ):
        wire = payload["scenarios"][name]
        assert wire["months_to_payoff"] == summary.months_to_payoff
        assert wire["total_interest_paid"] == str(summary.total_interest_paid)
        assert wire["total_paid"] == str(summary.total_paid)
        assert wire["underwater_debt_ids"] == list(summary.underwater_debt_ids)
        assert len(wire["debt_payoffs"]) == len(summary.debt_payoffs)
        assert len(wire["monthly_totals"]) == len(summary.monthly_totals)

    assert payload["comparison"]["interest_saved_avalanche_vs_snowball"] == str(
        expected.interest_saved_avalanche_vs_snowball
    )
    assert payload["comparison"]["months_saved_avalanche_vs_baseline"] == (
        expected.months_saved_avalanche_vs_baseline
    )


def test_per_debt_payoff_numbers_survive_the_mapping(client):
    expected = compute_plans(ENGINE_PORTFOLIO, Decimal("200.00"))
    payload = client.post("/v1/payoff-plans", json=body(WIRE_PORTFOLIO)).json()

    for wire, engine_payoff in zip(
        payload["scenarios"]["avalanche"]["debt_payoffs"],
        expected.avalanche.debt_payoffs,
        strict=True,
    ):
        assert wire["debt_id"] == engine_payoff.debt_id
        assert wire["name"] == engine_payoff.name
        assert wire["months_to_payoff"] == engine_payoff.payoff_month
        assert wire["total_interest_paid"] == str(engine_payoff.total_interest_paid)


def test_every_schedule_row_survives_the_mapping(client):
    from app.engine import Strategy, compute_schedules

    schedules = compute_schedules(ENGINE_PORTFOLIO, Decimal("200.00"))
    payload = client.post(
        "/v1/payoff-plans?detail=full", json=body(WIRE_PORTFOLIO)
    ).json()

    engine_months = schedules[Strategy.AVALANCHE].months
    wire_months = payload["scenarios"]["avalanche"]["schedule"]
    assert len(wire_months) == len(engine_months)

    for wire_month, engine_month in zip(wire_months, engine_months, strict=True):
        assert wire_month["total_payment"] == str(engine_month.total_payment)
        assert wire_month["total_interest"] == str(engine_month.total_interest)
        assert wire_month["remaining_balance"] == str(engine_month.remaining_balance)
