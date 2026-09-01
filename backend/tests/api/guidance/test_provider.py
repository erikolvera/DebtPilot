import json
from decimal import Decimal

import pytest

from app.api.guidance.presentation import build_presentation
from app.api.guidance.provider import GeminiProvider, ProviderError, TemplateProvider
from app.api.guidance.render import TOKEN_PATTERN, render
from app.engine import Debt, compute_plans

HEALTHY = [
    Debt("a", "Store card", Decimal("500.00"), Decimal("5.00"), Decimal("25.00")),
    Debt("b", "Visa", Decimal("2000.00"), Decimal("25.00"), Decimal("50.00")),
]
UNDERWATER = [Debt("a", "Maxed", Decimal("10000.00"), Decimal("24.00"), Decimal("100.00"))]


def presentation_for(debts, extra="200.00") -> dict[str, str]:
    amount = Decimal(extra)
    return build_presentation(compute_plans(debts, amount), debts, amount, "2026-09")


SHAPES = [
    pytest.param(HEALTHY, "200.00", id="pays-off"),
    pytest.param(UNDERWATER, "3000.00", id="baseline-never-pays-off"),
    pytest.param(UNDERWATER, "0.00", id="nothing-pays-off"),
    pytest.param([], "200.00", id="empty-portfolio"),
]


@pytest.mark.parametrize("debts,extra", SHAPES)
def test_the_template_renders_for_every_scenario_shape(debts, extra):
    """The fallback's version of the grounding guarantee.

    Without this the safety net has a hole in exactly the situation it exists
    to cover: a template referencing a token that is absent for an underwater
    portfolio would fail precisely when the model is unavailable.
    """
    presentation = presentation_for(debts, extra)
    narrative = render(TemplateProvider(presentation).generate("ignored"), presentation)
    assert narrative.headline.strip()
    assert narrative.body.strip()
    assert "{" not in narrative.headline + narrative.body


@pytest.mark.parametrize("debts,extra", SHAPES)
def test_the_template_emits_only_tokens_that_exist(debts, extra):
    presentation = presentation_for(debts, extra)
    payload = json.loads(TemplateProvider(presentation).generate("ignored"))
    for field in ("headline", "body"):
        for token in TOKEN_PATTERN.findall(payload[field]):
            assert token in presentation, f"template used absent token {token}"


@pytest.mark.parametrize("debts,extra", SHAPES)
def test_the_template_writes_no_digits(debts, extra):
    payload = json.loads(TemplateProvider(presentation_for(debts, extra)).generate(""))
    assert not any(c.isdigit() for c in payload["headline"] + payload["body"])


def test_the_template_ignores_the_prompt():
    provider = TemplateProvider(presentation_for(HEALTHY))
    assert provider.generate("one prompt") == provider.generate("a different prompt")


def test_the_template_mentions_the_first_cleared_debt_when_there_is_one():
    presentation = presentation_for(HEALTHY)
    payload = json.loads(TemplateProvider(presentation).generate(""))
    assert "first_cleared_name" in payload["body"]


def test_gemini_provider_requires_a_key():
    with pytest.raises(ValueError, match="api_key"):
        GeminiProvider(api_key="")


def test_a_provider_failure_is_a_provider_error():
    class _Broken:
        def generate(self, prompt: str) -> str:
            raise ProviderError("upstream is down")

    with pytest.raises(ProviderError):
        _Broken().generate("x")


def test_gemini_wraps_transport_failures_as_provider_error(monkeypatch):
    # The single network boundary in the layer, stubbed exactly as the JWKS
    # fetch is in the auth layer. The SDK raises a variety of transport types;
    # callers should only ever see ProviderError.
    import google.genai as genai

    def _explode(*args, **kwargs):
        raise RuntimeError("connection reset")

    monkeypatch.setattr(genai, "Client", _explode)
    with pytest.raises(ProviderError, match="connection reset"):
        GeminiProvider(api_key="k").generate("prompt")


def test_gemini_returns_the_response_text(monkeypatch):
    import google.genai as genai

    class _Models:
        def generate_content(self, **kwargs):
            return type("R", (), {"text": '{"headline": "Hi", "body": "There"}'})()

    class _Client:
        def __init__(self, **kwargs):
            self.models = _Models()

    monkeypatch.setattr(genai, "Client", _Client)
    assert GeminiProvider(api_key="k").generate("prompt") == '{"headline": "Hi", "body": "There"}'


def test_gemini_treats_an_empty_response_as_a_failure(monkeypatch):
    # A response with no text is not a narrative; falling through would hand
    # the renderer an empty string and produce a confusing json error.
    import google.genai as genai

    class _Models:
        def generate_content(self, **kwargs):
            return type("R", (), {"text": ""})()

    class _Client:
        def __init__(self, **kwargs):
            self.models = _Models()

    monkeypatch.setattr(genai, "Client", _Client)
    with pytest.raises(ProviderError, match="empty response"):
        GeminiProvider(api_key="k").generate("prompt")
