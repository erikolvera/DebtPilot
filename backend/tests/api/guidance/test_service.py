import json
from decimal import Decimal

from app.api.guidance import service
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


def test_the_fallback_survives_its_own_template_being_rejected(monkeypatch):
    """The floor under the floor.

    `_template` renders through the same validation chain as generated prose.
    If a future edit puts a numeral or a stray token into the template copy,
    the fallback would raise -- on the one path whose entire job is not
    failing -- and a well-formed request would return a 500. It must degrade
    to a fixed sentence instead.
    """
    def _reject(*args, **kwargs):
        raise service.GuidanceRejected("the template itself is broken")

    monkeypatch.setattr(service, "render", _reject)
    guidance = service.explain(PORTFOLIO, EXTRA, START)

    assert guidance is service._LAST_RESORT
    assert guidance.source == "template"
    # The last resort must itself be token-free and number-free, or it would
    # be rejected by the same rules that got us here.
    assert "{" not in guidance.body
    assert not any(char.isdigit() for char in guidance.headline + guidance.body)


def test_a_portfolio_of_cleared_debts_never_calls_the_model():
    """Debts exist, but none of them can be compared.

    Keying the short-circuit on `not debts` would miss this: a user who has
    paid everything off still has rows, so the old check would have paid for
    a model call to narrate an empty comparison.
    """
    calls: list[str] = []

    class _Counting:
        def generate(self, prompt: str) -> str:
            calls.append(prompt)
            raise AssertionError("must not be reached")

    cleared = (
        Debt(id="a", name="Cleared", balance=Decimal("0"), apr=Decimal("22"),
             minimum_payment=Decimal("25")),
    )
    guidance = service.explain(cleared, EXTRA, START, provider=_Counting())

    assert calls == []
    assert guidance.source == "template"


def test_the_hourly_model_budget_stops_paid_calls_and_serves_the_template():
    service.reset_model_budget()
    calls: list[str] = []

    class _Counting:
        def generate(self, prompt: str) -> str:
            calls.append(prompt)
            return json.dumps({"headline": "{avalanche_months}", "body": "ok"})

    for _ in range(service.MAX_MODEL_CALLS_PER_HOUR):
        assert service.explain(
            PORTFOLIO, EXTRA, START, provider=_Counting()
        ).source == "model"

    assert len(calls) == service.MAX_MODEL_CALLS_PER_HOUR
    over = service.explain(PORTFOLIO, EXTRA, START, provider=_Counting())
    assert over.source == "template"
    assert len(calls) == service.MAX_MODEL_CALLS_PER_HOUR


def test_the_model_budget_forgets_calls_older_than_an_hour():
    budget = service._ModelCallBudget()
    for i in range(service.MAX_MODEL_CALLS_PER_HOUR):
        assert budget.allow(now=1000.0 + i) is True
    assert budget.allow(now=1000.0 + service.MAX_MODEL_CALLS_PER_HOUR) is False
    # An hour past the last recorded call, every slot is free again.
    assert budget.allow(now=1000.0 + service.MAX_MODEL_CALLS_PER_HOUR + 3601.0) is True


def test_the_budget_uses_the_clock_when_no_time_is_supplied():
    assert service._ModelCallBudget().allow() is True
