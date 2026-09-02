from decimal import Decimal

from app.api.progress import build_check_in_progress
from app.api.schemas import CheckInContextIn
from app.engine import Debt


def debt(id: str, balance: str) -> Debt:
    return Debt(
        id=id,
        name=id.upper(),
        balance=Decimal(balance),
        apr=Decimal("10.00"),
        minimum_payment=Decimal("25.00"),
    )


def context(
    baseline: list[tuple[str, str]],
    previous: list[tuple[str, str]],
) -> CheckInContextIn:
    return CheckInContextIn.model_validate(
        {
            "baseline": {
                "month": "2026-07",
                "debts": [
                    {"id": debt_id, "balance": balance}
                    for debt_id, balance in baseline
                ],
            },
            "previous": {
                "month": "2026-08",
                "debts": [
                    {"id": debt_id, "balance": balance}
                    for debt_id, balance in previous
                ],
            },
        }
    )


def test_without_context_returns_no_progress():
    assert build_check_in_progress(None, [debt("a", "100.00")]) is None


def test_exact_decrease_increase_and_unchanged_amounts():
    down = build_check_in_progress(
        context([("a", "100.10")], [("a", "100.10")]),
        [debt("a", "100.00")],
    )
    assert down is not None
    assert down.since_previous.status == "decreased"
    assert down.since_previous.amount == Decimal("0.10")

    up = build_check_in_progress(
        context([("a", "100.00")], [("a", "100.00")]),
        [debt("a", "100.10")],
    )
    assert up is not None
    assert up.since_previous.status == "increased"
    assert up.since_previous.amount == Decimal("0.10")

    flat = build_check_in_progress(
        context([("a", "100.00")], [("a", "100.00")]),
        [debt("a", "100.00")],
    )
    assert flat is not None
    assert flat.since_previous.status == "unchanged"
    assert flat.since_previous.amount == Decimal("0.00")


def test_paid_off_debts_and_milestone_boundaries_are_reported():
    progress = build_check_in_progress(
        context(
            [("a", "600.00"), ("b", "400.00")],
            [("a", "520.00"), ("b", "380.00")],
        ),
        [debt("a", "500.00"), debt("b", "0.00")],
    )
    assert progress is not None
    assert progress.newly_paid_off_debt_ids == ["b"]
    assert progress.milestones_reached == ["10_percent", "25_percent", "50_percent"]


def test_every_milestone_uses_exact_decimal_thresholds():
    for current, expected in (
        ("90.01", []),
        ("90.00", ["10_percent"]),
        ("75.00", ["10_percent", "25_percent"]),
        ("50.00", ["10_percent", "25_percent", "50_percent"]),
        ("25.00", ["10_percent", "25_percent", "50_percent", "75_percent"]),
        (
            "0.00",
            ["10_percent", "25_percent", "50_percent", "75_percent", "debt_free"],
        ),
    ):
        progress = build_check_in_progress(
            context([("a", "100.00")], [("a", "95.00")]),
            [debt("a", current)],
        )
        assert progress is not None
        assert progress.milestones_reached == expected


def test_portfolio_changes_suppress_amounts_payoffs_and_milestones():
    progress = build_check_in_progress(
        context([("a", "100.00")], [("a", "90.00")]),
        [debt("a", "0.00"), debt("b", "10.00")],
    )
    assert progress is not None
    assert progress.since_previous.status == "portfolio_changed"
    assert progress.since_previous.amount is None
    assert progress.since_baseline.status == "portfolio_changed"
    assert progress.newly_paid_off_debt_ids == []
    assert progress.milestones_reached == []
