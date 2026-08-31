import pytest

from app.api.dates import month_label, parse_month, shift_month


def test_parse_month_splits_year_and_month():
    assert parse_month("2026-09") == (2026, 9)


@pytest.mark.parametrize(
    "bad", ["2026-13", "2026-00", "26-09", "2026-9", "", "2026/09", "not-a-month"]
)
def test_parse_month_rejects_malformed_input(bad):
    with pytest.raises(ValueError):
        parse_month(bad)


def test_shift_month_by_zero_is_identity():
    assert shift_month(2026, 9, 0) == (2026, 9)


def test_shift_month_crosses_the_year_boundary():
    assert shift_month(2026, 12, 1) == (2027, 1)


def test_shift_month_does_not_roll_over_early():
    assert shift_month(2026, 1, 11) == (2026, 12)


def test_shift_month_handles_multi_year_offsets():
    assert shift_month(2026, 9, 25) == (2028, 10)


def test_month_one_is_the_start_month():
    # Month 1 is the first month a payment is made — the start month itself.
    assert month_label("2026-09", 1) == "2026-09"


def test_month_label_crosses_the_year_boundary():
    assert month_label("2026-12", 2) == "2027-01"


def test_month_label_no_premature_rollover():
    assert month_label("2026-01", 12) == "2026-12"


def test_month_label_at_the_simulation_cap():
    # 1200 months is the engine's MAX_MONTHS: a century out, still plain ints.
    assert month_label("2026-09", 1200) == "2126-08"


def test_fourteen_months_from_september():
    assert month_label("2026-09", 14) == "2027-10"


def test_month_label_pads_single_digit_months():
    assert month_label("2026-09", 5) == "2027-01"


def test_month_label_round_trips_at_index_one():
    for label in ("2026-01", "2026-12", "2030-07", "2199-11"):
        assert month_label(label, 1) == label
