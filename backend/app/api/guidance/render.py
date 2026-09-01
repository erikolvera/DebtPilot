"""Validate the generated template, then substitute.

Six checks, in order, each rejecting rather than repairing. This is the file
where an injection or malformed-token bug would live, so it is a pure function
over strings with no I/O of any kind.
"""

import json
import re
import unicodedata
from collections.abc import Mapping
from dataclasses import dataclass

TOKEN_PATTERN = re.compile(r"\{([a-z_]+)\}")

_FIELDS = ("headline", "body")

# Forbidding only digits teaches the workaround: a generator told "no digits"
# that wants to state a count writes "two debts". Ordinals ("first", "second")
# stay allowed -- they order rather than quantify, and the shipped template
# uses one.
_NUMBER_WORDS = frozenset(
    "zero one two three four five six seven eight nine ten eleven twelve "
    "thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty "
    "thirty forty fifty sixty seventy eighty ninety hundred thousand million "
    "billion half quarter dozen".split()
)


class GuidanceRejected(Exception):
    """The generated output failed validation and must not be shown."""


@dataclass(frozen=True)
class Narrative:
    headline: str
    body: str


def _parse(raw: str) -> dict[str, str]:
    try:
        payload = json.loads(raw)
    except (json.JSONDecodeError, TypeError) as exc:
        raise GuidanceRejected("response was not json") from exc
    if not isinstance(payload, dict):
        raise GuidanceRejected("response was not a json object")
    for field in _FIELDS:
        if not isinstance(payload.get(field), str):
            raise GuidanceRejected(f"missing or non-string field: {field}")
    return payload


def _reject_numbers(text: str) -> None:
    """Refuse any figure written directly, as a character or as a word.

    `unicodedata.numeric` is strictly wider than `str.isdigit`: it covers the
    Nd digits, Nl Roman numerals, No fractions and circled forms, and the CJK
    numerals in the Lo category, all in one call.

    The word check is the one that matters in practice. Exotic numerals are
    not what a language model reaches for -- English cardinals are.
    """
    if any(unicodedata.numeric(char, None) is not None for char in text):
        raise GuidanceRejected("output contains a numeric character")
    for word in re.findall(r"[a-z]+", text.lower()):
        if word in _NUMBER_WORDS:
            raise GuidanceRejected(f"output spells a number: {word}")


def _reject_unknown_tokens(text: str, presentation: Mapping[str, str]) -> None:
    for token in TOKEN_PATTERN.findall(text):
        if token not in presentation:
            raise GuidanceRejected(f"unknown token: {token}")


def _reject_stray_braces(text: str) -> None:
    """Check brace integrity on the TEMPLATE, before any substitution.

    Run this after substitution instead and a debt legitimately named
    `{savings}` would be flagged as malformed, letting a user's own data
    suppress their narrative.
    """
    remainder = TOKEN_PATTERN.sub("", text)
    if "{" in remainder or "}" in remainder:
        raise GuidanceRejected("unbalanced or malformed brace")


def _substitute(text: str, presentation: Mapping[str, str]) -> str:
    def _replace(match: re.Match[str]) -> str:
        value = presentation[match.group(1)]
        return "".join(c for c in value if unicodedata.category(c)[0] != "C")

    return TOKEN_PATTERN.sub(_replace, text)


def render(raw: str, presentation: Mapping[str, str]) -> Narrative:
    """Turn a raw generated response into a narrative, or reject it."""
    payload = _parse(raw)

    for field in _FIELDS:
        text = payload[field]
        if not text.strip():
            raise GuidanceRejected(f"empty field: {field}")
        _reject_numbers(text)
        _reject_unknown_tokens(text, presentation)
        _reject_stray_braces(text)

    return Narrative(
        headline=_substitute(payload["headline"], presentation),
        body=_substitute(payload["body"], presentation),
    )
