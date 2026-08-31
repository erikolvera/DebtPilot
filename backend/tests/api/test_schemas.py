from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.api.schemas import DebtIn, PayoffPlanRequest


def debt_payload(**overrides) -> dict:
    payload = {
        "id": "card-a",
        "name": "Visa",
        "balance": "1000.00",
        "apr": "24.99",
        "minimum_payment": "50.00",
    }
    payload.update(overrides)
    return payload


def request_payload(**overrides) -> dict:
    payload = {
        "debts": [debt_payload()],
        "extra_monthly_payment": "200.00",
        "start_month": "2026-09",
    }
    payload.update(overrides)
    return payload


def test_money_strings_parse_to_decimal():
    debt = DebtIn(**debt_payload())
    assert debt.balance == Decimal("1000.00")
    assert debt.apr == Decimal("24.99")


def test_money_as_a_json_number_is_rejected():
    # JSON has no decimal type: 1234.56 arrives as an IEEE-754 double, which
    # would reintroduce floats at the boundary of a Decimal-only engine.
    with pytest.raises(ValidationError, match="JSON string"):
        DebtIn(**debt_payload(balance=1000.00))


def test_money_as_an_integer_is_also_rejected():
    with pytest.raises(ValidationError, match="JSON string"):
        DebtIn(**debt_payload(balance=1000))


def test_negative_balance_is_rejected():
    with pytest.raises(ValidationError):
        DebtIn(**debt_payload(balance="-1.00"))


def test_negative_minimum_is_rejected():
    with pytest.raises(ValidationError):
        DebtIn(**debt_payload(minimum_payment="-1.00"))


def test_apr_above_the_numeric_5_2_ceiling_is_rejected():
    with pytest.raises(ValidationError):
        DebtIn(**debt_payload(apr="1000.00"))


def test_balance_above_the_numeric_10_2_ceiling_is_rejected():
    # Unbounded above, "1e1000" is a well-formed Decimal that survives every
    # schema check and then blows up inside the engine's to_cents as an
    # unhandled 500. The ceiling is what turns that into a 422.
    with pytest.raises(ValidationError):
        DebtIn(**debt_payload(balance="1e1000"))


def test_minimum_payment_above_the_numeric_10_2_ceiling_is_rejected():
    with pytest.raises(ValidationError):
        DebtIn(**debt_payload(minimum_payment="100000000.00"))


def test_money_exactly_at_the_ceiling_is_allowed():
    debt = DebtIn(**debt_payload(balance="99999999.99"))
    assert debt.balance == Decimal("99999999.99")


def test_extra_payment_above_the_numeric_10_2_ceiling_is_rejected():
    with pytest.raises(ValidationError):
        PayoffPlanRequest(**request_payload(extra_monthly_payment="1e1000"))


def test_empty_id_is_rejected():
    with pytest.raises(ValidationError):
        DebtIn(**debt_payload(id=""))


def test_unknown_field_is_rejected():
    # A client sending "minimum" instead of "minimum_payment" must be told,
    # not silently defaulted.
    with pytest.raises(ValidationError):
        DebtIn(**debt_payload(minimum="50.00"))


def test_valid_request_parses():
    request = PayoffPlanRequest(**request_payload())
    assert request.start_month == "2026-09"
    assert request.extra_monthly_payment == Decimal("200.00")
    assert len(request.debts) == 1


def test_empty_debt_list_is_valid():
    # "No debts yet" is the normal state of a new account, not an error.
    assert PayoffPlanRequest(**request_payload(debts=[])).debts == []


def test_more_than_twenty_debts_is_rejected():
    with pytest.raises(ValidationError):
        PayoffPlanRequest(
            **request_payload(debts=[debt_payload(id=f"d{i}") for i in range(21)])
        )


def test_exactly_twenty_debts_is_allowed():
    request = PayoffPlanRequest(
        **request_payload(debts=[debt_payload(id=f"d{i}") for i in range(20)])
    )
    assert len(request.debts) == 20


@pytest.mark.parametrize("bad", ["2026-13", "26-09", "2026-9", "2026-09-14", ""])
def test_malformed_start_month_is_rejected(bad):
    with pytest.raises(ValidationError):
        PayoffPlanRequest(**request_payload(start_month=bad))


def test_negative_extra_payment_is_rejected():
    with pytest.raises(ValidationError):
        PayoffPlanRequest(**request_payload(extra_monthly_payment="-1.00"))


import json

from app.api.schemas import ComparisonOut, PayoffPlanResponse, ScenarioOut, ScenariosOut


def scenario_payload(strategy="avalanche", **overrides) -> dict:
    payload = {
        "strategy": strategy,
        "outcome": "paid_off",
        "months_to_payoff": 14,
        "payoff_month": "2027-10",
        "underwater_debt_ids": [],
        "total_interest_paid": "412.88",
        "total_paid": "2912.88",
        "debt_payoffs": [
            {
                "debt_id": "card-a",
                "name": "Visa",
                "months_to_payoff": 9,
                "payoff_month": "2027-05",
                "total_interest_paid": "298.14",
            }
        ],
        "monthly_totals": [
            {
                "month_number": 1,
                "month": "2026-09",
                "remaining_balance": "2371.50",
                "cumulative_interest": "43.20",
            }
        ],
        "schedule": None,
        "schedule_truncated": False,
    }
    payload.update(overrides)
    return payload


def test_scenario_parses_and_keeps_decimals():
    scenario = ScenarioOut(**scenario_payload())
    assert scenario.total_interest_paid == Decimal("412.88")
    assert scenario.debt_payoffs[0].months_to_payoff == 9


def test_never_pays_off_allows_null_months_and_month():
    scenario = ScenarioOut(
        **scenario_payload(
            outcome="never_pays_off",
            months_to_payoff=None,
            payoff_month=None,
            underwater_debt_ids=["card-a"],
            debt_payoffs=[],
        )
    )
    assert scenario.months_to_payoff is None
    assert scenario.payoff_month is None


def test_unknown_strategy_is_rejected():
    with pytest.raises(ValidationError):
        ScenarioOut(**scenario_payload(strategy="debt_lasso"))


def test_comparison_allows_null_deltas():
    comparison = ComparisonOut(
        interest_saved_snowball_vs_baseline=None,
        interest_saved_avalanche_vs_baseline=None,
        interest_saved_avalanche_vs_snowball="37.41",
        months_saved_snowball_vs_baseline=None,
        months_saved_avalanche_vs_baseline=None,
        months_saved_avalanche_vs_snowball=0,
    )
    assert comparison.interest_saved_avalanche_vs_baseline is None
    assert comparison.months_saved_avalanche_vs_snowball == 0


def test_money_serializes_back_out_as_a_json_string():
    # The contract is symmetric: strings in, strings out. If Pydantic ever
    # emitted a bare number here, every JS client would silently get a float.
    response = PayoffPlanResponse(
        start_month="2026-09",
        scenarios=ScenariosOut(
            snowball=ScenarioOut(**scenario_payload("snowball")),
            avalanche=ScenarioOut(**scenario_payload("avalanche")),
            baseline=ScenarioOut(**scenario_payload("minimum_only")),
        ),
        comparison=ComparisonOut(
            interest_saved_snowball_vs_baseline="1.00",
            interest_saved_avalanche_vs_baseline="2.00",
            interest_saved_avalanche_vs_snowball="3.00",
            months_saved_snowball_vs_baseline=1,
            months_saved_avalanche_vs_baseline=2,
            months_saved_avalanche_vs_snowball=3,
        ),
    )
    body = json.loads(response.model_dump_json())
    assert body["scenarios"]["avalanche"]["total_interest_paid"] == "412.88"
    assert body["comparison"]["interest_saved_avalanche_vs_snowball"] == "3.00"
    assert body["start_month"] == "2026-09"


def test_scenarios_requires_all_three():
    with pytest.raises(ValidationError):
        ScenariosOut(snowball=ScenarioOut(**scenario_payload("snowball")))


def test_money_accepts_a_decimal_from_internal_construction():
    # The validator guards INBOUND JSON. A Decimal cannot come from JSON
    # parsing (which yields str/int/float), so it must pass: this is the
    # mapper building a response out of engine output.
    scenario = ScenarioOut(**scenario_payload(total_interest_paid=Decimal("412.88")))
    assert scenario.total_interest_paid == Decimal("412.88")


def test_a_bool_is_still_rejected_as_money():
    with pytest.raises(ValidationError, match="JSON string"):
        DebtIn(**debt_payload(balance=True))
