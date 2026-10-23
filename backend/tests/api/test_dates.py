import pytest

from app.api.dates import month_label, parse_month


@pytest.mark.parametrize(
    "bad", ["2026-13", "2026-00", "26-09", "2026-9", "", "2026/09", "not-a-month"]
)
def test_parse_month_rejects_malformed_input(bad):
    with pytest.raises(ValueError):
        parse_month(bad)


def test_month_label_crosses_the_year_boundary():
    assert month_label("2026-12", 2) == "2027-01"


def test_month_label_no_premature_rollover():
    assert month_label("2026-01", 12) == "2026-12"


def test_month_label_at_the_simulation_cap():
    # 1200 months is the engine's MAX_MONTHS: a century out, still plain ints.
    assert month_label("2026-09", 1200) == "2126-08"


def test_month_label_round_trips_at_index_one():
    for label in ("2026-01", "2026-12", "2030-07", "2199-11"):
        assert month_label(label, 1) == label
