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

import time
from collections import defaultdict

from fastapi import HTTPException, Request, status

RATE_LIMIT = 10
WINDOW_SECONDS = 3600


class RateLimiter:
    def __init__(self) -> None:
        self._hits: dict[str, list[float]] = defaultdict(list)

    def recorded(self, key: str) -> int:
        """How many hits are currently retained for a caller. For tests."""
        return len(self._hits[key])

    def check(self, key: str, now: float | None = None) -> None:
        moment = time.monotonic() if now is None else now
        cutoff = moment - WINDOW_SECONDS
        # Prune on every path, including rejection, so a long-lived process
        # does not grow a list per caller forever.
        recent = [hit for hit in self._hits[key] if hit > cutoff]
        self._hits[key] = recent
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


_limiter = RateLimiter()


def reset_limiter() -> None:
    """Clear all state. For tests."""
    global _limiter
    _limiter = RateLimiter()


def rate_limit(request: Request) -> None:
    """FastAPI dependency enforcing the per-caller limit."""
    client = request.client
    _limiter.check(client.host if client else "unknown")
