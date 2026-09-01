"""A per-caller limit on the endpoint that spends money.

Deliberately modest. It does not survive a restart, it does not coordinate
across instances, and anyone with several addresses defeats it. Its job is
stopping a loop in a frontend from spending a fortune overnight, and it does
that. The real ceiling is a spend limit configured in the Gemini console; no
application-level limit can protect against a bug in the application.

It applies to every request, including those served by the template provider:
making it conditional on a paid call would remove the limit exactly when the
endpoint is cheapest to hammer.
"""

import os
import time

from fastapi import HTTPException, Request, status

RATE_LIMIT = 10
WINDOW_SECONDS = 3600

# Pruning happens per caller, on that caller's next request -- which never
# comes for a one-shot address. Without a sweep the dict grows one key per
# unique caller for the life of the process, so a public endpoint's limiter
# becomes its own memory leak. The threshold is deliberately far above any
# plausible hour of real traffic: the sweep is O(callers) and should be rare.
MAX_TRACKED_CALLERS = 10_000


class RateLimiter:
    def __init__(self) -> None:
        self._hits: dict[str, list[float]] = {}

    def recorded(self, key: str) -> int:
        """How many hits are currently retained for a caller. For tests.

        Uses .get so asking the question does not create a bucket.
        """
        return len(self._hits.get(key, ()))

    def _sweep(self, cutoff: float) -> None:
        """Drop every caller whose most recent hit has aged out."""
        self._hits = {
            key: hits for key, hits in self._hits.items() if hits[-1] > cutoff
        }

    def check(self, key: str, now: float | None = None) -> None:
        moment = time.monotonic() if now is None else now
        cutoff = moment - WINDOW_SECONDS
        if len(self._hits) > MAX_TRACKED_CALLERS:
            self._sweep(cutoff)
        # Prune on every path, including rejection, so a long-lived process
        # does not grow a list per caller forever.
        # Not thread-safe: sync dependencies run in FastAPI's threadpool, so
        # two requests from one caller can interleave here. The cost is a
        # couple of extra requests slipping through, which is within the
        # tolerance of a limiter this modest.
        recent = [hit for hit in self._hits.get(key, []) if hit > cutoff]
        if recent:
            self._hits[key] = recent
        else:
            # Drop the bucket rather than leaving an empty list behind: the
            # dict would otherwise grow a key per unique caller forever.
            self._hits.pop(key, None)
        if len(recent) >= RATE_LIMIT:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=[
                    {
                        "type": "rate_limited",
                        "loc": ["client"],
                        "msg": f"at most {RATE_LIMIT} explanations per hour",
                    }
                ],
            )
        recent.append(moment)
        self._hits[key] = recent


_limiter = RateLimiter()


def reset_limiter() -> None:
    """Clear all state. For tests."""
    global _limiter
    _limiter = RateLimiter()


def trust_proxy_headers() -> bool:
    """Whether X-Forwarded-For may be believed.

    Off by default. A proxy header is caller-controlled, so trusting it
    blindly hands every abuser an unlimited supply of buckets. Behind a proxy
    that does strip and set it -- Render does -- turn this on, or every user
    shares the proxy's address and the limit becomes one bucket for everybody.
    """
    return os.environ.get("TRUST_PROXY_HEADERS", "").strip().lower() in {
        "1", "true", "yes", "on"
    }


def caller_key(request: Request) -> str:
    if trust_proxy_headers():
        forwarded = request.headers.get("x-forwarded-for", "")
        first = forwarded.split(",")[0].strip()
        if first:
            return first
    client = request.client
    if client is None:
        return "unknown"
    return client.host


def rate_limit(request: Request) -> None:
    """FastAPI dependency enforcing the per-caller limit."""
    _limiter.check(caller_key(request))
