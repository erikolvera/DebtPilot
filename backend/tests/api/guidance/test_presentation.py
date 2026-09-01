from decimal import Decimal

import pytest

from app.api.guidance.presentation import build_presentation
from app.engine import Debt, compute_plans

PORTFOLIO = [
    Debt("a", "Store card", Decimal("500.00"), Decimal("5.00"), Decimal("25.00")),
    Debt("b", "Visa", Decimal("2000.00"), Decimal("25.00"), Decimal("50.00")),
]
EXTRA = Decimal("200.00")
START = "2026-09"

MONTH_NAMES = (
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
)


@pytest.fixture
def tokens() -> dict[str, str]:
    return build_presentation(compute_plans(PORTFOLIO, EXTRA), PORTFOLIO, EXTRA, START)


def test_money_is_exact_with_separators(tokens):
    assert tokens["total_balance"] == "$2,500.00"
    assert tokens["extra_payment"] == "$200.00"


def test_every_value_is_a_string(tokens):
    # The substitution model depends on this: a Decimal here would be
    # formatted by str() at substitution time and lose its separators.
    assert all(isinstance(v, str) for v in tokens.values())


def test_debt_count_is_pluralised(tokens):
    assert tokens["debt_count"] == "2 debts"


def test_a_single_debt_is_singular():
    single = [PORTFOLIO[0]]
    tokens = build_presentation(compute_plans(single, EXTRA), single, EXTRA, START)
    assert tokens["debt_count"] == "1 debt"


def test_a_one_month_term_is_singular():
    quick = [Debt("a", "Tiny", Decimal("50.00"), Decimal("0.00"), Decimal("50.00"))]
    tokens = build_presentation(compute_plans(quick, EXTRA), quick, EXTRA, START)
    assert tokens["avalanche_months"] == "1 month"


def test_scenario_outcomes_are_present(tokens):
    for prefix in ("avalanche", "snowball", "baseline"):
        assert tokens[f"{prefix}_outcome"] == "pays off"


def test_months_are_pluralised_and_paired_with_a_calendar_month(tokens):
    assert tokens["avalanche_months"].endswith(" months")
    assert tokens["avalanche_payoff_month"].split()[0] in MONTH_NAMES


def test_totals_are_money(tokens):
    assert tokens["avalanche_total_interest"].startswith("$")
    assert tokens["avalanche_total_paid"].startswith("$")


def test_deltas_are_formatted_by_kind(tokens):
    assert tokens["interest_saved_avalanche_vs_snowball"].startswith("$")
    assert tokens["months_saved_avalanche_vs_baseline"].endswith("months")


def test_first_cleared_comes_from_the_avalanche_plan(tokens):
    comparison = compute_plans(PORTFOLIO, EXTRA)
    assert tokens["first_cleared_name"] == comparison.avalanche.debt_payoffs[0].name
    assert tokens["first_cleared_month"].split()[0] in MONTH_NAMES


def test_a_never_paying_off_scenario_omits_every_number():
    # PlanSummary reports totals over the SIMULATED WINDOW, so for such a run
    # they are one month's interest, not a lifetime figure. Offered as a token,
    # a later stage could write "you would pay $20.00 in interest" about a debt
    # that never clears -- wrong, and reassuring in the worst direction.
    debts = [Debt("a", "Maxed", Decimal("10000.00"), Decimal("24.00"), Decimal("100.00"))]
    tokens = build_presentation(
        compute_plans(debts, Decimal("3000.00")), debts, Decimal("3000.00"), START
    )
    assert tokens["baseline_outcome"] == "never pays off"
    for suffix in ("months", "payoff_month", "total_interest", "total_paid"):
        assert f"baseline_{suffix}" not in tokens


def test_null_deltas_are_omitted():
    debts = [Debt("a", "Maxed", Decimal("10000.00"), Decimal("24.00"), Decimal("100.00"))]
    tokens = build_presentation(
        compute_plans(debts, Decimal("3000.00")), debts, Decimal("3000.00"), START
    )
    assert "interest_saved_avalanche_vs_baseline" not in tokens
    assert "interest_saved_avalanche_vs_snowball" in tokens


def test_an_empty_portfolio_omits_first_cleared_and_the_term():
    tokens = build_presentation(compute_plans([], EXTRA), [], EXTRA, START)
    assert tokens["debt_count"] == "0 debts"
    assert "first_cleared_name" not in tokens
    assert "first_cleared_month" not in tokens
    # months_to_payoff is 0, so there is no month to name.
    assert "avalanche_months" not in tokens
    assert "avalanche_payoff_month" not in tokens


def test_no_token_name_contains_a_digit(tokens):
    # The no-digits rule on generated output only works if token names are
    # alphabetic; a token like `plan_2` would make the check unusable.
    assert not any(char.isdigit() for key in tokens for char in key)
