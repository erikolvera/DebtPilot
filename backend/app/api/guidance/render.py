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


def _reject_digits(text: str) -> None:
    # Every token name is alphabetic and every figure arrives by substitution,
    # so one digit means a number was written directly. `isdigit` covers
    # Arabic-Indic and other non-ASCII numerals, so "٣ months" is refused
    # alongside "3 months".
    if any(char.isdigit() for char in text):
        raise GuidanceRejected("output contains a digit")


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
        _reject_digits(text)
        _reject_unknown_tokens(text, presentation)
        _reject_stray_braces(text)

    return Narrative(
        headline=_substitute(payload["headline"], presentation),
        body=_substitute(payload["body"], presentation),
    )
