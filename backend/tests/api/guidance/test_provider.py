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


def test_gemini_pins_the_call_it_makes(monkeypatch):
    """The request shape is the contract, so assert it field by field.

    Every other Gemini test stubs `generate_content(**kwargs)` and throws the
    kwargs away, so the model name could change to a costlier one, the
    temperature could drift to 1.0, or the JSON mode could be dropped
    entirely, and the whole suite would stay green while production quietly
    changed behaviour. Nothing here reaches the network; the point is that
    the arguments are what we think they are.
    """
    import google.genai as genai

    captured: dict[str, object] = {}

    class _Models:
        def generate_content(self, **kwargs):
            captured.update(kwargs)
            return type("R", (), {"text": '{"headline": "H", "body": "B"}'})()

    class _Client:
        def __init__(self, **kwargs):
            captured["api_key"] = kwargs.get("api_key")
            self.models = _Models()

    monkeypatch.setattr(genai, "Client", _Client)
    GeminiProvider(api_key="k", timeout=8.0).generate("the prompt")

    assert captured["api_key"] == "k"
    assert captured["model"] == "gemini-2.5-flash"
    assert captured["contents"] == "the prompt"

    config = captured["config"]
    # Low but not zero: zero is not a determinism guarantee from a hosted
    # model, and the validation chain -- not the sampler -- is what makes the
    # output safe. Low temperature just keeps the prose boring.
    assert config.temperature == 0.2
    assert config.response_mime_type == "application/json"
    assert config.response_schema == {
        "type": "object",
        "properties": {
            "headline": {"type": "string"},
            "body": {"type": "string"},
        },
        "required": ["headline", "body"],
    }
    # The SDK takes milliseconds; the constructor takes seconds. A unit slip
    # here turns an 8-second budget into an 8-millisecond one, which fails
    # every call, or into a 2.2-hour one, which hangs a worker thread.
    assert config.http_options.timeout == 8000
