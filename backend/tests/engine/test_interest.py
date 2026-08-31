from decimal import Decimal

from app.engine.interest import monthly_interest, monthly_rate


def test_monthly_rate_divides_percent_by_twelve():
    # 24% APR -> 2% per month
    assert monthly_rate(Decimal("24.00")) == Decimal("0.02")


def test_round_number_case():
    # $1,000 at 24% APR -> 2% -> $20.00
    assert monthly_interest(Decimal("1000.00"), Decimal("24.00")) == Decimal("20.00")


def test_result_is_rounded_to_cents():
    # 100.00 * 19.99 / 100 / 12 = 1.6658333... -> 1.67
    assert monthly_interest(Decimal("100.00"), Decimal("19.99")) == Decimal("1.67")


def test_zero_apr_accrues_nothing():
    assert monthly_interest(Decimal("5000.00"), Decimal("0.00")) == Decimal("0.00")


def test_zero_balance_accrues_nothing():
    assert monthly_interest(Decimal("0.00"), Decimal("24.00")) == Decimal("0.00")


def test_penny_balance_accrues_nothing():
    # 0.01 * 0.02 = 0.0002, which quantizes to 0.00. This is what prevents an
    # immortal fractional debt.
    assert monthly_interest(Decimal("0.01"), Decimal("24.00")) == Decimal("0.00")


def test_result_is_always_two_places():
    result = monthly_interest(Decimal("1234.56"), Decimal("17.99"))
    assert result.as_tuple().exponent == -2
