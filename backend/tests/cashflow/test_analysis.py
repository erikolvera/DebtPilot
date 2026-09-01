from decimal import Decimal

import pytest

from app.cashflow import (
    CashFlowStatus,
    InvalidCashFlow,
    allocate_extra_payment,
    analyze_cash_flow,
)


def amount(value: str) -> Decimal:
    return Decimal(value)


def test_surplus_is_income_less_expenses_and_minimums():
    result = analyze_cash_flow(
        [amount("5000.00"), amount("250.004")],
        [amount("2500.00"), amount("600.005")],
        [Decimal("125.00"), Decimal("75.00")],
    )

    assert result.total_monthly_income == Decimal("5250.00")
    assert result.total_monthly_expenses == Decimal("3100.01")
    assert result.total_minimum_debt_payments == Decimal("200.00")
    assert result.available_monthly_cash_flow == Decimal("1949.99")
    assert result.maximum_affordable_extra_payment == Decimal("1949.99")
    assert result.shortfall == Decimal("0.00")
    assert result.status is CashFlowStatus.SURPLUS


def test_break_even_is_an_objective_status():
    result = analyze_cash_flow([amount("1000")], [amount("900")], [Decimal("100")])
    assert result.available_monthly_cash_flow == Decimal("0.00")
    assert result.status is CashFlowStatus.BREAK_EVEN


def test_deficit_reports_a_positive_shortfall_and_no_affordable_extra():
    result = analyze_cash_flow([amount("1000")], [amount("1100")], [Decimal("50")])
    assert result.available_monthly_cash_flow == Decimal("-150.00")
    assert result.shortfall == Decimal("150.00")
    assert result.maximum_affordable_extra_payment == Decimal("0.00")
    assert result.status is CashFlowStatus.DEFICIT


def test_empty_household_is_break_even():
    result = analyze_cash_flow([], [], [])
    assert result.status is CashFlowStatus.BREAK_EVEN


def test_requested_extra_is_kept_when_affordable():
    summary = analyze_cash_flow([amount("1000")], [amount("500")], [])
    allocation = allocate_extra_payment(Decimal("200.005"), summary)
    assert allocation.requested_extra_payment == Decimal("200.01")
    assert allocation.planned_extra_payment == Decimal("200.01")
    assert allocation.unallocated_cash_flow == Decimal("299.99")
    assert allocation.extra_payment_gap == Decimal("0.00")
    assert allocation.is_affordable


def test_requested_extra_is_capped_when_unaffordable():
    summary = analyze_cash_flow([amount("1000")], [amount("900")], [])
    allocation = allocate_extra_payment(Decimal("250"), summary)
    assert allocation.planned_extra_payment == Decimal("100.00")
    assert allocation.extra_payment_gap == Decimal("150.00")
    assert allocation.unallocated_cash_flow == Decimal("0.00")
    assert not allocation.is_affordable


@pytest.mark.parametrize(
    ("factory", "message"),
    [
        (lambda: analyze_cash_flow([Decimal("-1")], [], []), "income"),
        (lambda: analyze_cash_flow([], [Decimal("-1")], []), "expenses"),
        (
            lambda: analyze_cash_flow([], [], [Decimal("-1")]),
            "minimum debt payments",
        ),
        (
            lambda: allocate_extra_payment(
                Decimal("-1"), analyze_cash_flow([], [], [])
            ),
            "requested extra payment",
        ),
    ],
)
def test_negative_inputs_are_rejected(factory, message):
    with pytest.raises(InvalidCashFlow, match=message):
        factory()
