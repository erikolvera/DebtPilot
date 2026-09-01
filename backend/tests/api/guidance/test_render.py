import json

import pytest

from app.api.guidance.render import GuidanceRejected, render

PRESENTATION = {
    "avalanche_months": "14 months",
    "total_balance": "$2,500.00",
    "first_cleared_name": "Store card",
}


def raw(headline: str = "All clear.", body: str = "Nothing owed.") -> str:
    return json.dumps({"headline": headline, "body": body})


def test_a_clean_template_substitutes():
    result = render(
        raw("Paid off in {avalanche_months}.", "You owe {total_balance}."),
        PRESENTATION,
    )
    assert result.headline == "Paid off in 14 months."
    assert result.body == "You owe $2,500.00."


def test_a_literal_digit_is_rejected():
    # The whole ungrounded-number class, in one check: every token name is
    # alphabetic, so a digit means a figure was written directly.
    with pytest.raises(GuidanceRejected, match="digit"):
        render(raw("Paid off in 14 months."), PRESENTATION)


def test_a_digit_in_the_body_is_rejected_too():
    with pytest.raises(GuidanceRejected, match="digit"):
        render(raw("All clear.", "You saved $3,140.22."), PRESENTATION)


def test_a_unicode_digit_is_rejected():
    with pytest.raises(GuidanceRejected, match="digit"):
        render(raw("Paid off in ٣ months."), PRESENTATION)


def test_an_unknown_token_is_rejected():
    with pytest.raises(GuidanceRejected, match="unknown token"):
        render(raw("You save {interest_saved_avalanche_vs_baseline}."), PRESENTATION)


def test_an_unclosed_brace_is_rejected():
    with pytest.raises(GuidanceRejected, match="brace"):
        render(raw("Paid off in {avalanche_months."), PRESENTATION)


def test_a_stray_closing_brace_is_rejected():
    with pytest.raises(GuidanceRejected, match="brace"):
        render(raw("Paid off soon} enough."), PRESENTATION)


def test_a_nested_brace_is_rejected():
    with pytest.raises(GuidanceRejected, match="brace"):
        render(raw("Paid off in {{avalanche_months}}."), PRESENTATION)


def test_malformed_json_is_rejected():
    with pytest.raises(GuidanceRejected, match="json"):
        render("not json at all", PRESENTATION)


def test_a_json_array_is_rejected():
    with pytest.raises(GuidanceRejected, match="json object"):
        render(json.dumps(["headline", "body"]), PRESENTATION)


def test_a_missing_field_is_rejected():
    with pytest.raises(GuidanceRejected, match="field"):
        render(json.dumps({"headline": "Hi"}), PRESENTATION)


def test_a_non_string_field_is_rejected():
    with pytest.raises(GuidanceRejected, match="field"):
        render(json.dumps({"headline": "Hi", "body": ["a", "b"]}), PRESENTATION)


def test_an_empty_body_is_rejected():
    with pytest.raises(GuidanceRejected, match="empty"):
        render(raw("Something.", "   "), PRESENTATION)


def test_a_debt_name_containing_braces_is_inserted_literally():
    # Substitution happens after token extraction, so a name like {savings} is
    # text and is never re-scanned. Checking brace integrity AFTER substitution
    # instead would let a user's own debt name suppress their narrative.
    presentation = dict(PRESENTATION, first_cleared_name="{savings}")
    result = render(raw("Cleared {first_cleared_name}."), presentation)
    assert result.headline == "Cleared {savings}."


def test_a_debt_name_containing_a_digit_survives_substitution():
    # The no-digits rule applies to what was written, not to the values
    # substituted in. A card called "Visa 2" must not break the narrative.
    presentation = dict(PRESENTATION, first_cleared_name="Visa 2")
    result = render(raw("Cleared {first_cleared_name}."), presentation)
    assert result.headline == "Cleared Visa 2."


def test_control_characters_in_a_substituted_value_are_stripped():
    presentation = dict(PRESENTATION, first_cleared_name="Store\x07card")
    result = render(raw("Cleared {first_cleared_name}."), presentation)
    assert result.headline == "Cleared Storecard."


def test_a_dunder_token_is_rejected_like_any_other_unknown():
    with pytest.raises(GuidanceRejected, match="unknown token"):
        render(raw("See {__class__}."), PRESENTATION)


def test_the_result_is_frozen():
    result = render(raw("Hi.", "There."), PRESENTATION)
    with pytest.raises(Exception):
        result.headline = "changed"
