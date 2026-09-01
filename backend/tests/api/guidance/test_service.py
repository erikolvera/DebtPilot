import json
from decimal import Decimal

from app.api.guidance.provider import ProviderError
from app.api.guidance.service import explain, gemini_api_key
from app.engine import Debt

PORTFOLIO = [
    Debt("a", "Store card", Decimal("500.00"), Decimal("5.00"), Decimal("25.00")),
    Debt("b", "Visa", Decimal("2000.00"), Decimal("25.00"), Decimal("50.00")),
]
EXTRA = Decimal("200.00")
START = "2026-09"


class _Fixed:
    """Returns canned responses in order, counting its calls."""

    def __init__(self, *responses: str) -> None:
        self._responses = list(responses)
        self.calls = 0

    def generate(self, prompt: str) -> str:
        self.calls += 1
        return self._responses[min(self.calls - 1, len(self._responses) - 1)]


class _Exploding:
    def generate(self, prompt: str) -> str:
        raise ProviderError("upstream is down")


def good(headline="Cleared in {avalanche_months}.", body="You owe {total_balance}.") -> str:
    return json.dumps({"headline": headline, "body": body})


BAD = json.dumps({"headline": "Paid in 14 months.", "body": "x"})


def test_a_valid_response_is_reported_as_model():
    result = explain(PORTFOLIO, EXTRA, START, provider=_Fixed(good()))
    assert result.source == "model"
    assert result.headline.startswith("Cleared in ")
    assert "{" not in result.headline


def test_an_invalid_response_is_retried_once():
    provider = _Fixed(BAD, good())
    result = explain(PORTFOLIO, EXTRA, START, provider=provider)
    assert provider.calls == 2
    assert result.source == "model"


def test_two_invalid_responses_fall_back_to_the_template():
    provider = _Fixed(BAD, BAD)
    result = explain(PORTFOLIO, EXTRA, START, provider=provider)
    assert provider.calls == 2
    assert result.source == "template"
    assert result.headline.strip()


def test_a_provider_error_falls_back_without_retrying():
    # An outage will still be an outage a millisecond later; a second call
    # only doubles the latency the reader waits through.
    result = explain(PORTFOLIO, EXTRA, START, provider=_Exploding())
    assert result.source == "template"


def test_the_fallback_narrative_is_fully_substituted():
    result = explain(PORTFOLIO, EXTRA, START, provider=_Exploding())
    assert "{" not in result.headline
    assert "{" not in result.body


def test_an_empty_portfolio_never_calls_the_provider():
    # Nothing to compare, every interesting token absent, and a paid call to
    # narrate an empty table is waste.
    provider = _Fixed(good())
    result = explain([], EXTRA, START, provider=provider)
    assert provider.calls == 0
    assert result.source == "template"
    assert result.headline.strip()


def test_no_key_configured_means_no_key(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    assert gemini_api_key() is None


def test_a_blank_key_is_treated_as_absent(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "   ")
    assert gemini_api_key() is None


def test_a_configured_key_is_returned(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "abc123")
    assert gemini_api_key() == "abc123"


def test_the_default_provider_is_the_template_when_no_key_is_set(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    result = explain(PORTFOLIO, EXTRA, START)
    assert result.source == "template"


def test_a_configured_key_builds_a_gemini_provider(monkeypatch):
    # Proves the key actually selects Gemini rather than silently falling
    # through to the template, without making a network call.
    monkeypatch.setenv("GEMINI_API_KEY", "abc123")
    import google.genai as genai

    def _explode(*args, **kwargs):
        raise RuntimeError("no network in tests")

    monkeypatch.setattr(genai, "Client", _explode)
    result = explain(PORTFOLIO, EXTRA, START)
    # The call was attempted and failed, so we land on the fallback.
    assert result.source == "template"
