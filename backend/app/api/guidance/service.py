"""Orchestration: compute, prompt, generate, validate, fall back.

The endpoint returns no 5xx for a generation problem. A validation failure is
retried once; anything else falls back to the template. The reader always
receives a correct narrative, and `source` says which one they got.
"""

import os
from collections.abc import Sequence
from dataclasses import dataclass
from decimal import Decimal

from app.engine import Debt, compute_plans

from .presentation import build_presentation
from .prompt import build_prompt
from .provider import GeminiProvider, Provider, ProviderError, TemplateProvider
from .render import GuidanceRejected, render

MAX_ATTEMPTS = 2


@dataclass(frozen=True)
class Guidance:
    headline: str
    body: str
    source: str


def gemini_api_key() -> str | None:
    """The configured key, or None. A blank value counts as absent."""
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    return key or None


def _template(presentation: dict[str, str]) -> Guidance:
    narrative = render(TemplateProvider(presentation).generate(""), presentation)
    return Guidance(narrative.headline, narrative.body, source="template")


def explain(
    debts: Sequence[Debt],
    extra_payment: Decimal,
    start_month: str,
    provider: Provider | None = None,
) -> Guidance:
    """Narrate a payoff comparison computed from these debts."""
    comparison = compute_plans(debts, extra_payment)
    presentation = build_presentation(comparison, debts, extra_payment, start_month)

    if not debts:
        # Nothing to compare and every interesting token absent; a paid call
        # to narrate an empty table is waste.
        return _template(presentation)

    if provider is None:
        key = gemini_api_key()
        if key is None:
            return _template(presentation)
        provider = GeminiProvider(key)

    prompt = build_prompt(presentation)

    for _ in range(MAX_ATTEMPTS):
        try:
            raw = provider.generate(prompt)
        except ProviderError:
            # An outage will still be an outage a millisecond later; retrying
            # only doubles the latency the reader waits through.
            return _template(presentation)
        try:
            narrative = render(raw, presentation)
        except GuidanceRejected:
            continue
        return Guidance(narrative.headline, narrative.body, source="model")

    return _template(presentation)
