"""Orchestration: compute, prompt, generate, validate, fall back.

The endpoint returns no 5xx for a generation problem. A validation failure is
retried once; anything else falls back to the template. The reader always
receives a correct narrative, and `source` says which one they got.
"""

import logging
import os
import time
from collections.abc import Sequence
from dataclasses import dataclass
from decimal import Decimal

from app.engine import Debt, compute_plans

from .presentation import build_presentation
from .prompt import build_prompt
from .provider import GeminiProvider, Provider, ProviderError, TemplateProvider
from .render import GuidanceRejected, render

MAX_ATTEMPTS = 2

# The only mechanism here that actually bounds spend. A per-caller limit does
# not: an IPv6 /64 gives an abuser more buckets than they could ever use.
MAX_MODEL_CALLS_PER_HOUR = 200
_MODEL_CALL_WINDOW = 3600.0

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Guidance:
    headline: str
    body: str
    source: str


def gemini_api_key() -> str | None:
    """The configured key, or None. A blank value counts as absent."""
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    return key or None


_LAST_RESORT = Guidance(
    headline="Here is your payoff plan.",
    body="Your plan is shown above. We could not put it into words this time.",
    source="template",
)


def _template(presentation: dict[str, str]) -> Guidance:
    """The fallback, which must never raise.

    It renders through the same validation chain as generated prose, so it
    could in principle be rejected -- and every call site is on the path whose
    whole job is not failing. A fixed, token-free sentence is the floor.
    """
    try:
        narrative = render(TemplateProvider(presentation).generate(""), presentation)
    except GuidanceRejected:
        logger.error("the fallback template failed its own validation")
        return _LAST_RESORT
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

    if "avalanche_months" not in presentation:
        # Nothing to compare -- no debts, or only zero-balance ones. Every
        # interesting token is absent, so a paid call would narrate an empty
        # table. Keying on the token rather than on `not debts` also catches a
        # portfolio of debts that are all already cleared.
        return _template(presentation)

    if provider is None:
        key = gemini_api_key()
        if key is None:
            return _template(presentation)
        provider = GeminiProvider(key)

    if not _model_budget.allow():
        logger.warning("hourly model-call budget exhausted; serving the template")
        return _template(presentation)

    prompt = build_prompt(presentation)

    for _ in range(MAX_ATTEMPTS):
        try:
            raw = provider.generate(prompt)
        except ProviderError as exc:
            # An outage will still be an outage a millisecond later; retrying
            # only doubles the latency the reader waits through.
            logger.warning("provider failed, serving the template: %s", exc)
            return _template(presentation)
        try:
            narrative = render(raw, presentation)
        except GuidanceRejected as exc:
            logger.warning("generated narrative rejected: %s", exc)
            continue
        return Guidance(narrative.headline, narrative.body, source="model")

    logger.warning("every attempt was rejected; serving the template")
    return _template(presentation)


class _ModelCallBudget:
    """A process-wide ceiling on paid calls per hour.

    Not a substitute for a spend limit in the provider console -- nothing in
    an application can protect against a bug in that application -- but it is
    the only limit here that bounds cost rather than per-caller frequency.
    """

    def __init__(self) -> None:
        self._calls: list[float] = []

    def allow(self, now: float | None = None) -> bool:
        moment = time.monotonic() if now is None else now
        cutoff = moment - _MODEL_CALL_WINDOW
        self._calls = [c for c in self._calls if c > cutoff]
        if len(self._calls) >= MAX_MODEL_CALLS_PER_HOUR:
            return False
        self._calls.append(moment)
        return True


_model_budget = _ModelCallBudget()


def reset_model_budget() -> None:
    """Clear the budget. For tests."""
    global _model_budget
    _model_budget = _ModelCallBudget()
