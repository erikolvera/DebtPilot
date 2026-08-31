import json
from datetime import datetime, timezone
from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.api.schemas import DebtCreate, DebtOut, DebtUpdate


def payload(**overrides) -> dict:
    body = {
        "name": "Visa",
        "balance": "1000.00",
        "apr": "24.99",
        "minimum_payment": "50.00",
    }
    body.update(overrides)
    return body


def test_valid_payload_parses_to_decimals():
    debt = DebtCreate(**payload())
    assert debt.balance == Decimal("1000.00")
    assert debt.type == "credit_card"


def test_money_as_a_json_number_is_rejected():
    with pytest.raises(ValidationError, match="JSON string"):
        DebtCreate(**payload(balance=1000.00))


def test_money_above_the_ceiling_is_rejected():
    # Matches numeric(10,2); without it an oversized Decimal reaches the
    # database and surfaces as a 500 rather than a 422.
    with pytest.raises(ValidationError):
        DebtCreate(**payload(balance="1e1000"))


def test_apr_above_the_ceiling_is_rejected():
    with pytest.raises(ValidationError):
        DebtCreate(**payload(apr="1000.00"))


def test_negative_money_is_rejected():
    with pytest.raises(ValidationError):
        DebtCreate(**payload(balance="-1.00"))


def test_whitespace_only_name_is_rejected():
    # The column's CHECK is length(trim(name)) >= 1. Pydantic's min_length
    # alone accepts "   ", which would violate the constraint and surface as
    # an unhandled IntegrityError -- a 500 from a well-formed request.
    with pytest.raises(ValidationError):
        DebtCreate(**payload(name="   "))


def test_name_is_stripped():
    assert DebtCreate(**payload(name="  Visa  ")).name == "Visa"


def test_user_id_cannot_be_supplied_by_the_client():
    # user_id comes from the verified token. Accepting it from a body is how
    # a caller writes into someone else's account.
    with pytest.raises(ValidationError):
        DebtCreate(**payload(user_id="00000000-0000-0000-0000-000000000000"))


def test_id_cannot_be_supplied_by_the_client():
    with pytest.raises(ValidationError):
        DebtCreate(**payload(id="00000000-0000-0000-0000-000000000000"))


def test_update_allows_partial_payloads():
    assert DebtUpdate(balance="500.00").name is None


def test_update_rejects_an_entirely_empty_payload():
    # Sending {} is a client bug, not a request to change nothing.
    with pytest.raises(ValidationError, match="at least one field"):
        DebtUpdate()


def test_update_rejects_unknown_fields():
    with pytest.raises(ValidationError):
        DebtUpdate(blance="500.00")


def test_update_rejects_a_blank_name():
    with pytest.raises(ValidationError):
        DebtUpdate(name="   ")


def test_debt_out_serializes_money_as_strings_and_id_as_a_uuid():
    out = DebtOut(
        id="11111111-1111-1111-1111-111111111111",
        name="Visa",
        type="credit_card",
        balance=Decimal("1000.00"),
        apr=Decimal("24.99"),
        minimum_payment=Decimal("50.00"),
        created_at=datetime(2026, 8, 31, tzinfo=timezone.utc),
        updated_at=datetime(2026, 8, 31, tzinfo=timezone.utc),
    )
    body = json.loads(out.model_dump_json())
    assert body["balance"] == "1000.00"
    assert body["apr"] == "24.99"
    assert body["id"] == "11111111-1111-1111-1111-111111111111"


def test_a_non_string_name_is_a_clean_validation_error():
    # The stripper passes non-strings through so the type check produces a
    # normal 422 rather than an AttributeError from calling .strip() on an int.
    with pytest.raises(ValidationError):
        DebtCreate(**payload(name=123))


def test_a_nul_byte_in_the_name_is_rejected():
    # Postgres text columns cannot hold NUL and psycopg raises on the way in,
    # so without this the request validates and then 500s.
    with pytest.raises(ValidationError, match="NUL"):
        DebtCreate(**payload(name="ab\x00cd"))


def test_sub_cent_money_is_rejected_rather_than_silently_rounded():
    # numeric(10,2) would round "1.005" to 1.01 invisibly; the engine's
    # contract is that quantization happens on ingest, not in the database.
    with pytest.raises(ValidationError):
        DebtCreate(**payload(balance="1.005"))
