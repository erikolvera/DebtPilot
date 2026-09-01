from decimal import Decimal

import pytest

from app.cashflow import (
    CashFlowStatus,
    IncomeFrequency,
    InvalidCashFlow,
    allocate_extra_payment,
    analyze_cash_flow,
    monthly_income_amount,
)


def amount(value: str) -> Decimal:
    return Decimal(value)


@pytest.mark.parametrize(
    ("frequency", "paycheck", "expected"),
    [
        (IncomeFrequency.SALARY, "72000.00", "6000.00"),
        (IncomeFrequency.MONTHLY, "5000.00", "5000.00"),
        (IncomeFrequency.BIWEEKLY, "2307.69", "4999.995"),
        (IncomeFrequency.WEEKLY, "1000.00", "4333.333333333333333333333333"),
    ],
)
def test_pay_frequency_converts_to_a_monthly_equivalent(
    frequency, paycheck, expected
):
    assert monthly_income_amount(amount(paycheck), frequency) == amount(expected)


def test_normalized_income_is_rounded_once_in_the_monthly_summary():
    result = analyze_cash_flow(
        [monthly_income_amount(amount("2307.69"), IncomeFrequency.BIWEEKLY)],
        [],
        [],
    )
    assert result.total_monthly_income == amount("5000.00")


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
            lambda: monthly_income_amount(
                Decimal("-1"), IncomeFrequency.WEEKLY
            ),
            "income",
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
