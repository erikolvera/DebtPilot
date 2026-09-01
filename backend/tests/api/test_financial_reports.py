import pytest
from fastapi.testclient import TestClient

from app.api.main import create_app


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app())


def report_body(**overrides) -> dict:
    body = {
        "incomes": [
            {"id": "pay", "name": "Take-home pay", "amount": "5000.00", "frequency": "monthly"}
        ],
        "expenses": [
            {
                "id": "rent",
                "name": "Rent",
                "category": "housing",
                "monthly_amount": "3000.00",
            }
        ],
        "debts": [
            {
                "id": "card",
                "name": "Visa",
                "type": "credit_card",
                "balance": "2000.00",
                "apr": "20.00",
                "minimum_payment": "100.00",
            }
        ],
        "requested_extra_monthly_payment": "500.00",
        "start_month": "2026-09",
    }
    body.update(overrides)
    return body


def test_surplus_report_composes_cash_flow_and_payoff_plan(client):
    response = client.post("/v1/financial-reports", json=report_body())
    assert response.status_code == 200
    body = response.json()

    assert body["cash_flow"] == {
        "total_monthly_income": "5000.00",
        "total_monthly_expenses": "3000.00",
        "total_minimum_debt_payments": "100.00",
        "available_monthly_cash_flow": "1900.00",
        "shortfall": "0.00",
        "maximum_affordable_extra_payment": "1900.00",
        "status": "surplus",
    }
    assert body["total_debt"] == "2000.00"
    assert body["debt_payment_budget"] == {
        "requested_extra_monthly_payment": "500.00",
        "planned_extra_monthly_payment": "500.00",
        "unallocated_cash_flow": "1400.00",
        "extra_payment_gap": "0.00",
        "is_affordable": True,
    }
    assert body["payoff_plan"]["scenarios"]["avalanche"]["outcome"] == "paid_off"
    assert body["payoff_guidance"]["recommended_strategy"] is None
    assert [
        option["extra_monthly_payment"]
        for option in body["payoff_guidance"]["payment_options"]
    ] == ["500.00", "1200.00", "1900.00"]
    assert [item["code"] for item in body["recommendations"]] == [
        "compare_strategies",
        "assign_remaining_surplus",
    ]


def test_unaffordable_extra_is_capped_before_simulation(client):
    body = client.post(
        "/v1/financial-reports",
        json=report_body(requested_extra_monthly_payment="2500.00"),
    ).json()

    budget = body["debt_payment_budget"]
    assert budget["planned_extra_monthly_payment"] == "1900.00"
    assert budget["extra_payment_gap"] == "600.00"
    assert not budget["is_affordable"]
    assert [
        option["kind"] for option in body["payoff_guidance"]["payment_options"]
    ] == ["current"]
    assert [item["code"] for item in body["recommendations"]] == [
        "reduce_extra_payment",
        "compare_strategies",
    ]


def test_deficit_reports_shortfall_and_withholds_a_fake_strategy(client):
    body = client.post(
        "/v1/financial-reports",
        json=report_body(
            incomes=[
                {"id": "pay", "name": "Pay", "amount": "1000.00", "frequency": "monthly"}
            ],
            expenses=[
                {
                    "id": "rent",
                    "name": "Rent",
                    "category": "housing",
                    "monthly_amount": "1000.00",
                }
            ],
        ),
    ).json()

    assert body["cash_flow"]["status"] == "deficit"
    assert body["cash_flow"]["shortfall"] == "100.00"
    assert body["debt_payment_budget"]["planned_extra_monthly_payment"] == "0.00"
    assert body["payoff_plan"] is None
    assert body["payoff_guidance"] is None
    assert [item["code"] for item in body["recommendations"]] == ["close_shortfall"]


def test_break_even_keeps_a_zero_extra_plan_and_protects_minimums(client):
    body = client.post(
        "/v1/financial-reports",
        json=report_body(
            incomes=[
                {"id": "pay", "name": "Pay", "amount": "3100.00", "frequency": "monthly"}
            ],
            requested_extra_monthly_payment="0.00",
        ),
    ).json()

    assert body["cash_flow"]["status"] == "break_even"
    assert body["payoff_plan"] is not None
    assert [
        option["kind"] for option in body["payoff_guidance"]["payment_options"]
    ] == ["current"]
    assert [item["code"] for item in body["recommendations"]] == [
        "protect_minimums"
    ]


def test_no_debt_returns_a_cash_report_without_a_payoff_plan(client):
    body = client.post(
        "/v1/financial-reports",
        json=report_body(debts=[]),
    ).json()

    assert body["total_debt"] == "0.00"
    assert body["payoff_plan"] is None
    assert body["payoff_guidance"] is None
    assert [item["code"] for item in body["recommendations"]] == [
        "build_cash_reserve"
    ]


def test_supported_debt_types_are_accepted_with_an_estimate_disclosure(client):
    debt = report_body()["debts"][0]
    debt["type"] = "student_loan"
    body = client.post(
        "/v1/financial-reports", json=report_body(debts=[debt])
    ).json()
    assert "Non-credit-card debts" in body["estimate_disclosure"]


@pytest.mark.parametrize("collection", ["incomes", "expenses", "debts"])
def test_duplicate_row_ids_are_rejected(client, collection):
    body = report_body()
    body[collection] = [body[collection][0], body[collection][0]]
    response = client.post("/v1/financial-reports", json=body)
    assert response.status_code == 422
    assert f"duplicate {collection[:-1]} id" in response.text


def test_report_money_must_stay_a_json_string(client):
    body = report_body()
    body["incomes"][0]["amount"] = 5000
    response = client.post("/v1/financial-reports", json=body)
    assert response.status_code == 422


@pytest.mark.parametrize(
    ("amount", "frequency", "monthly"),
    [
        ("72000.00", "salary", "6000.00"),
        ("5000.00", "monthly", "5000.00"),
        ("2307.69", "biweekly", "5000.00"),
        ("1000.00", "weekly", "4333.33"),
    ],
)
def test_income_frequency_is_normalized_before_cash_flow(
    client, amount, frequency, monthly
):
    response = client.post(
        "/v1/financial-reports",
        json=report_body(
            incomes=[
                {
                    "id": "pay",
                    "name": "Paycheck",
                    "amount": amount,
                    "frequency": frequency,
                }
            ]
        ),
    )
    assert response.status_code == 200
    assert response.json()["cash_flow"]["total_monthly_income"] == monthly


def test_unknown_income_frequency_is_rejected(client):
    body = report_body()
    body["incomes"][0]["frequency"] = "sometimes"
    assert client.post("/v1/financial-reports", json=body).status_code == 422


def test_report_rejects_unknown_expense_categories(client):
    body = report_body()
    body["expenses"][0]["category"] = "mystery"
    response = client.post("/v1/financial-reports", json=body)
    assert response.status_code == 422


def test_report_route_is_versioned(client):
    assert client.post("/financial-reports", json=report_body()).status_code == 404


def test_seed_report_has_pinned_affordable_payment_options(client):
    body = client.post(
        "/v1/financial-reports",
        json=report_body(
            incomes=[
                {
                    "id": "paycheck",
                    "name": "Take-home paycheck",
                    "amount": "2307.69",
                    "frequency": "biweekly",
                },
                {
                    "id": "recurring",
                    "name": "Recurring side income",
                    "amount": "300.00",
                    "frequency": "monthly",
                },
            ],
            expenses=[
                {
                    "id": f"expense-{index}",
                    "name": name,
                    "category": category,
                    "monthly_amount": amount,
                }
                for index, (name, category, amount) in enumerate(
                    [
                        ("Rent", "housing", "1700.00"),
                        ("Groceries", "food", "600.00"),
                        ("Utilities", "utilities", "300.00"),
                        ("Transportation", "transportation", "450.00"),
                        ("Insurance", "insurance", "350.00"),
                        ("Healthcare", "healthcare", "150.00"),
                        ("Subscriptions", "subscriptions", "100.00"),
                        ("Personal and other", "personal", "300.00"),
                    ]
                )
            ],
            debts=[
                {
                    "id": "visa",
                    "name": "Visa Signature",
                    "type": "credit_card",
                    "balance": "6120.00",
                    "apr": "24.99",
                    "minimum_payment": "122.40",
                },
                {
                    "id": "store",
                    "name": "Store card",
                    "type": "credit_card",
                    "balance": "1840.00",
                    "apr": "27.99",
                    "minimum_payment": "46.00",
                },
                {
                    "id": "credit",
                    "name": "Credit union",
                    "type": "personal_loan",
                    "balance": "3250.00",
                    "apr": "14.50",
                    "minimum_payment": "65.00",
                },
            ],
            requested_extra_monthly_payment="650.00",
        ),
    ).json()

    guidance = body["payoff_guidance"]
    assert guidance["recommended_strategy"] == "avalanche"
    assert [option["kind"] for option in guidance["payment_options"]] == [
        "current",
        "split_difference",
        "maximum",
    ]
    assert [
        (
            option["extra_monthly_payment"],
            option["additional_monthly_payment"],
            option["monthly_cushion_remaining"],
            option["avalanche"]["months_to_payoff"],
        )
        for option in guidance["payment_options"]
    ] == [
        ("650.00", "0.00", "466.60", 15),
        ("883.30", "233.30", "233.30", 12),
        ("1116.60", "466.60", "0.00", 10),
    ]
    assert guidance["payment_options"][1]["avalanche"]["months_saved_vs_current"] == 3
    assert guidance["payment_options"][1]["avalanche"][
        "interest_saved_vs_current"
    ] == "344.03"


def test_half_cent_split_rounds_up_and_duplicate_amounts_are_removed(client):
    body = client.post(
        "/v1/financial-reports",
        json=report_body(
            incomes=[
                {
                    "id": "pay",
                    "name": "Pay",
                    "amount": "3200.01",
                    "frequency": "monthly",
                }
            ],
            requested_extra_monthly_payment="100.00",
        ),
    ).json()

    options = body["payoff_guidance"]["payment_options"]
    assert [(option["kind"], option["extra_monthly_payment"]) for option in options] == [
        ("current", "100.00"),
        ("maximum", "100.01"),
    ]


def test_never_payoff_comparisons_have_null_savings(client):
    body = client.post(
        "/v1/financial-reports",
        json=report_body(
            incomes=[
                {
                    "id": "pay",
                    "name": "Pay",
                    "amount": "1021.00",
                    "frequency": "monthly",
                }
            ],
            expenses=[
                {
                    "id": "rent",
                    "name": "Rent",
                    "category": "housing",
                    "monthly_amount": "1000.00",
                }
            ],
            debts=[
                {
                    "id": "card",
                    "name": "Card",
                    "type": "credit_card",
                    "balance": "1000.00",
                    "apr": "24.00",
                    "minimum_payment": "10.00",
                }
            ],
            requested_extra_monthly_payment="0.00",
        ),
    ).json()

    guidance = body["payoff_guidance"]
    assert guidance["recommended_strategy"] is None
    assert guidance["payment_options"][0]["avalanche"]["outcome"] == "never_pays_off"
    maximum = guidance["payment_options"][-1]["avalanche"]
    assert maximum["outcome"] == "paid_off"
    assert maximum["months_saved_vs_current"] is None
    assert maximum["interest_saved_vs_current"] is None
