"""Engine figures, pre-formatted for prose.

The generated narrative never writes a number: it writes a token, and these
are the values substituted in afterwards. Keys mirror the engine's field names
one-for-one so any token in a narrative is traceable to its source.

Tokens are omitted rather than rendered as "N/A". The set is computed per
request, so a value that does not exist is simply not in the vocabulary and
cannot be referenced.
"""

from collections.abc import Sequence
from decimal import Decimal

from app.engine import Debt, Outcome, PlanComparison, PlanSummary

from ..dates import month_label, parse_month

_MONTH_NAMES = (
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
)

_INTEREST_DELTAS = (
    "interest_saved_snowball_vs_baseline",
    "interest_saved_avalanche_vs_baseline",
    "interest_saved_avalanche_vs_snowball",
)

_MONTH_DELTAS = (
    "months_saved_snowball_vs_baseline",
    "months_saved_avalanche_vs_baseline",
    "months_saved_avalanche_vs_snowball",
)


def _money(value: Decimal) -> str:
    return f"${value:,.2f}"


def _months(count: int) -> str:
    return f"{count} month" if count == 1 else f"{count} months"


def _calendar(start_month: str, index: int) -> str:
    year, month = parse_month(month_label(start_month, index))
    return f"{_MONTH_NAMES[month - 1]} {year}"


def _scenario_tokens(
    prefix: str, summary: PlanSummary, start_month: str
) -> dict[str, str]:
    tokens = {
        f"{prefix}_outcome": (
            "pays off" if summary.outcome is Outcome.PAID_OFF else "never pays off"
        )
    }
    if summary.outcome is not Outcome.PAID_OFF:
        # Totals for such a run cover the simulated window -- one month, or
        # twelve hundred -- not a lifetime. Offering them would invite a small,
        # falsely reassuring figure about a debt that never clears.
        return tokens

    tokens[f"{prefix}_total_interest"] = _money(summary.total_interest_paid)
    tokens[f"{prefix}_total_paid"] = _money(summary.total_paid)
    if summary.months_to_payoff:
        tokens[f"{prefix}_months"] = _months(summary.months_to_payoff)
        tokens[f"{prefix}_payoff_month"] = _calendar(
            start_month, summary.months_to_payoff
        )
    return tokens


def build_presentation(
    comparison: PlanComparison,
    debts: Sequence[Debt],
    extra_payment: Decimal,
    start_month: str,
) -> dict[str, str]:
    """Every figure a narrative may reference, formatted and named."""
    tokens: dict[str, str] = {}

    for prefix, summary in (
        ("avalanche", comparison.avalanche),
        ("snowball", comparison.snowball),
        ("baseline", comparison.baseline),
    ):
        tokens.update(_scenario_tokens(prefix, summary, start_month))

    for name in _INTEREST_DELTAS:
        value = getattr(comparison, name)
        if value is not None:
            tokens[name] = _money(value)

    for name in _MONTH_DELTAS:
        value = getattr(comparison, name)
        if value is not None:
            tokens[name] = _months(value)

    count = len(debts)
    tokens["debt_count"] = f"{count} debt" if count == 1 else f"{count} debts"
    tokens["total_balance"] = _money(sum((d.balance for d in debts), Decimal("0.00")))
    tokens["extra_payment"] = _money(extra_payment)

    payoffs = comparison.avalanche.debt_payoffs
    if payoffs:
        tokens["first_cleared_name"] = payoffs[0].name
        tokens["first_cleared_month"] = _calendar(start_month, payoffs[0].payoff_month)

    return tokens
