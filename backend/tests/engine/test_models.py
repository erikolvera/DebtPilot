from decimal import Decimal

import pytest

from app.engine.errors import InvalidDebt
from app.engine.models import Debt, validate_portfolio


def make_debt(**overrides) -> Debt:
    kwargs = {
        "id": "d1",
        "name": "Visa",
        "balance": Decimal("1000.00"),
        "apr": Decimal("24.00"),
        "minimum_payment": Decimal("50.00"),
    }
    kwargs.update(overrides)
    return Debt(**kwargs)


def test_debt_is_frozen():
    debt = make_debt()
    with pytest.raises(Exception):
        debt.balance = Decimal("5.00")


def test_debt_quantizes_balance_on_ingest():
    assert make_debt(balance=Decimal("100.005")).balance == Decimal("100.01")


def test_debt_quantizes_minimum_on_ingest():
    assert make_debt(minimum_payment=Decimal("49.999")).minimum_payment == Decimal("50.00")


def test_debt_quantizes_apr_on_ingest():
    assert make_debt(apr=Decimal("24.9949")).apr == Decimal("24.99")


def test_negative_balance_is_rejected():
    with pytest.raises(InvalidDebt, match="balance"):
        make_debt(balance=Decimal("-1.00"))


def test_negative_apr_is_rejected():
    with pytest.raises(InvalidDebt, match="apr"):
        make_debt(apr=Decimal("-0.01"))


def test_negative_minimum_is_rejected():
    with pytest.raises(InvalidDebt, match="minimum_payment"):
        make_debt(minimum_payment=Decimal("-5.00"))


def test_zero_balance_is_accepted():
    assert make_debt(balance=Decimal("0.00")).balance == Decimal("0.00")


def test_zero_minimum_is_accepted():
    assert make_debt(minimum_payment=Decimal("0.00")).minimum_payment == Decimal("0.00")


def test_minimum_larger_than_balance_is_accepted():
    debt = make_debt(balance=Decimal("10.00"), minimum_payment=Decimal("50.00"))
    assert debt.minimum_payment == Decimal("50.00")


def test_duplicate_ids_are_rejected():
    debts = [make_debt(id="a"), make_debt(id="a")]
    with pytest.raises(InvalidDebt, match="duplicate"):
        validate_portfolio(debts, Decimal("0.00"))


def test_negative_extra_payment_is_rejected():
    with pytest.raises(InvalidDebt, match="extra_payment"):
        validate_portfolio([make_debt()], Decimal("-1.00"))


def test_valid_portfolio_passes():
    validate_portfolio([make_debt(id="a"), make_debt(id="b")], Decimal("100.00"))


def test_empty_portfolio_passes():
    validate_portfolio([], Decimal("0.00"))
