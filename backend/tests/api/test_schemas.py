from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.api.schemas import DebtIn, FinancialReportRequest


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
        "incomes": [],
        "expenses": [],
        "debts": [debt_payload()],
        "requested_extra_monthly_payment": "200.00",
        "start_month": "2026-09",
    }
    payload.update(overrides)
    return payload


def test_money_as_a_json_number_is_rejected():
    # JSON has no decimal type: 1234.56 arrives as an IEEE-754 double, which
    # would reintroduce floats at the boundary of a Decimal-only engine.
    with pytest.raises(ValidationError, match="JSON string"):
        DebtIn(**debt_payload(balance=1000.00))


def test_money_as_an_integer_is_also_rejected():
    with pytest.raises(ValidationError, match="JSON string"):
        DebtIn(**debt_payload(balance=1000))


def test_apr_above_the_numeric_5_2_ceiling_is_rejected():
    with pytest.raises(ValidationError):
        DebtIn(**debt_payload(apr="1000.00"))


def test_minimum_payment_above_the_numeric_10_2_ceiling_is_rejected():
    with pytest.raises(ValidationError):
        DebtIn(**debt_payload(minimum_payment="100000000.00"))


def test_money_exactly_at_the_ceiling_is_allowed():
    debt = DebtIn(**debt_payload(balance="99999999.99"))
    assert debt.balance == Decimal("99999999.99")


def test_extra_payment_above_the_numeric_10_2_ceiling_is_rejected():
    with pytest.raises(ValidationError):
        FinancialReportRequest(
            **request_payload(requested_extra_monthly_payment="1e1000")
        )


def test_empty_id_is_rejected():
    with pytest.raises(ValidationError):
        DebtIn(**debt_payload(id=""))


def test_unknown_field_is_rejected():
    # A client sending "minimum" instead of "minimum_payment" must be told,
    # not silently defaulted.
    with pytest.raises(ValidationError):
        DebtIn(**debt_payload(minimum="50.00"))


def test_empty_debt_list_is_valid():
    # "No debts yet" is the normal state of a new account, not an error.
    assert FinancialReportRequest(**request_payload(debts=[])).debts == []


def test_more_than_twenty_debts_is_rejected():
    with pytest.raises(ValidationError):
        FinancialReportRequest(
            **request_payload(debts=[debt_payload(id=f"d{i}") for i in range(21)])
        )


def test_exactly_twenty_debts_is_allowed():
    request = FinancialReportRequest(
        **request_payload(debts=[debt_payload(id=f"d{i}") for i in range(20)])
    )
    assert len(request.debts) == 20


@pytest.mark.parametrize("bad", ["2026-13", "26-09", "2026-9", "2026-09-14", ""])
def test_malformed_start_month_is_rejected(bad):
    with pytest.raises(ValidationError):
        FinancialReportRequest(**request_payload(start_month=bad))



def test_a_bool_is_still_rejected_as_money():
    with pytest.raises(ValidationError, match="JSON string"):
        DebtIn(**debt_payload(balance=True))


def test_a_plan_request_rejects_a_blank_or_nul_debt_name():
    for name in ("   ", "Vi\x00sa"):
        with pytest.raises(ValidationError):
            DebtIn(
                id="a",
                name=name,
                balance="100.00",
                apr="20.00",
                minimum_payment="25.00",
            )


def test_a_plan_request_strips_surrounding_whitespace_from_a_debt_name():
    debt = DebtIn(
        id="a",
        name="  Visa  ",
        balance="100.00",
        apr="20.00",
        minimum_payment="25.00",
    )
    assert debt.name == "Visa"
