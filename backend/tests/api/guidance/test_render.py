import json
from dataclasses import FrozenInstanceError

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
    with pytest.raises(GuidanceRejected, match="numeric"):
        render(raw("Paid off in 14 months."), PRESENTATION)


def test_a_digit_in_the_body_is_rejected_too():
    with pytest.raises(GuidanceRejected, match="numeric"):
        render(raw("All clear.", "You saved $3,140.22."), PRESENTATION)


def test_a_unicode_digit_is_rejected():
    with pytest.raises(GuidanceRejected, match="numeric"):
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
    with pytest.raises(FrozenInstanceError):
        result.headline = "changed"


@pytest.mark.parametrize(
    "text",
    [
        pytest.param("Paid off in Ⅻ months.", id="roman-numeral"),
        pytest.param("You owe ½ of it.", id="vulgar-fraction"),
        pytest.param("Paid off in 三 months.", id="cjk-numeral"),
        pytest.param("Circled ⑩ months.", id="circled-number"),
    ],
)
def test_numeric_characters_beyond_digits_are_rejected(text):
    # str.isdigit misses Nl, No and the CJK Lo numerals; unicodedata.numeric
    # covers all of them.
    with pytest.raises(GuidanceRejected, match="numeric"):
        render(raw(text), PRESENTATION)


@pytest.mark.parametrize(
    "text",
    [
        pytest.param("You have two debts.", id="two"),
        pytest.param("About three thousand dollars.", id="three-thousand"),
        pytest.param("Roughly half of it.", id="half"),
        pytest.param("Twelve months to go.", id="capitalised"),
    ],
)
def test_spelled_out_numbers_are_rejected(text):
    # The gap that mattered: a generator told only "no digits" writes the word.
    with pytest.raises(GuidanceRejected, match="spells a number"):
        render(raw(text), PRESENTATION)


def test_ordinals_are_still_allowed():
    # "first" orders rather than quantifies, and the shipped template uses it.
    result = render(raw("Your first debt goes first."), PRESENTATION)
    assert result.headline == "Your first debt goes first."


def test_a_substituted_value_may_contain_number_words():
    # The rule applies to what was written, not to values substituted in: a
    # card called "One Card" must not break the narrative.
    presentation = dict(PRESENTATION, first_cleared_name="One Card")
    result = render(raw("Cleared {first_cleared_name}."), presentation)
    assert result.headline == "Cleared One Card."
