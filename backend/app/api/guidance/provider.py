"""Where the narrative comes from.

One method, string in, string out. `TemplateProvider` is not a test double
that happens to ship -- it is a real implementation, used in production
whenever Gemini is unavailable and whenever no API key is configured, which is
also what makes it the local-development default.
"""

import json
from collections.abc import Mapping
from typing import Protocol


class ProviderError(Exception):
    """The provider could not produce a response."""


class Provider(Protocol):
    def generate(self, prompt: str) -> str: ...


class TemplateProvider:
    """A hand-written narrative, assembled from whichever tokens exist.

    Takes the presentation at construction rather than parsing the prompt: a
    fixed template referencing `{baseline_months}` would fail on exactly the
    underwater portfolio the fallback most needs to serve.
    """

    def __init__(self, presentation: Mapping[str, str]) -> None:
        self._presentation = presentation

    def generate(self, prompt: str) -> str:
        headline, body = self._compose(self._presentation)
        return json.dumps({"headline": headline, "body": body})

    @staticmethod
    def _compose(available: Mapping[str, str]) -> tuple[str, str]:
        if "avalanche_months" not in available:
            if available.get("avalanche_outcome") == "never pays off":
                return (
                    "These debts do not clear at this payment.",
                    "You have {debt_count} totalling {total_balance}, and paying "
                    "{extra_payment} extra each month is not enough to clear them. "
                    "Raising the extra payment is what changes that. These figures "
                    "are estimates, not financial advice.",
                )
            return (
                "Nothing to pay off yet.",
                "You have {debt_count} on file, so there is no payoff plan to "
                "compare yet. Add a debt and a plan will appear here.",
            )

        sentences = [
            "You have {debt_count} totalling {total_balance}, and you are paying "
            "{extra_payment} extra each month."
        ]
        # No guard on first_cleared_name: reaching here means avalanche_months
        # exists, which means the plan cleared at least one debt, which means
        # the name and month are present. A conditional here would be dead
        # code that cannot be tested.
        sentences.append(
            "The avalanche plan clears {first_cleared_name} first, in "
            "{first_cleared_month}."
        )
        sentences.append(
            "Everything is paid off by {avalanche_payoff_month}, after "
            "{avalanche_months}, with {avalanche_total_interest} of estimated "
            "interest."
        )
        if "interest_saved_avalanche_vs_baseline" in available:
            sentences.append(
                "Against paying only the minimums, that saves "
                "{interest_saved_avalanche_vs_baseline}."
            )
        sentences.append("These figures are estimates, not financial advice.")

        return ("Your debts clear in {avalanche_months}.", " ".join(sentences))


class GeminiProvider:
    """Gemini, wrapped so the rest of the layer never imports the SDK."""

    def __init__(self, api_key: str, timeout: float = 20.0) -> None:
        if not api_key:
            raise ValueError("api_key must not be empty")
        self._api_key = api_key
        self._timeout = timeout

    def generate(self, prompt: str) -> str:
        from google import genai
        from google.genai import types

        # Built OUTSIDE the try on purpose. An SDK rename here is a programming
        # error and should fail loudly in staging, not be swallowed into a
        # silent permanent fallback that nobody notices in production.
        config = types.GenerateContentConfig(
            temperature=0.2,
            response_mime_type="application/json",
            response_schema={
                "type": "object",
                "properties": {
                    "headline": {"type": "string"},
                    "body": {"type": "string"},
                },
                "required": ["headline", "body"],
            },
            http_options=types.HttpOptions(timeout=int(self._timeout * 1000)),
        )

        try:
            client = genai.Client(api_key=self._api_key)
            response = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=prompt,
                config=config,
            )
        except Exception as exc:  # the SDK raises a variety of transport errors
            raise ProviderError(str(exc)) from exc

        text = getattr(response, "text", None)
        if not text:
            raise ProviderError("empty response")
        return text
