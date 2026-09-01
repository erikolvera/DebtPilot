import pytest
from fastapi import HTTPException

from app.api.guidance.ratelimit import RATE_LIMIT, WINDOW_SECONDS, RateLimiter


def test_requests_under_the_limit_pass():
    limiter = RateLimiter()
    for i in range(RATE_LIMIT):
        limiter.check("1.2.3.4", now=1000.0 + i)


def test_the_request_over_the_limit_is_a_429():
    limiter = RateLimiter()
    for i in range(RATE_LIMIT):
        limiter.check("1.2.3.4", now=1000.0 + i)
    with pytest.raises(HTTPException) as exc:
        limiter.check("1.2.3.4", now=1000.0 + RATE_LIMIT)
    assert exc.value.status_code == 429
    assert exc.value.detail[0]["type"] == "rate_limited"


def test_limits_are_per_caller():
    limiter = RateLimiter()
    for i in range(RATE_LIMIT):
        limiter.check("1.2.3.4", now=1000.0 + i)
    limiter.check("5.6.7.8", now=1000.0)


def test_the_window_slides():
    limiter = RateLimiter()
    for i in range(RATE_LIMIT):
        limiter.check("1.2.3.4", now=1000.0 + i)
    # Past the window measured from the LAST hit, not the first: the hits
    # are spread across RATE_LIMIT seconds, so +1 would only clear the
    # earliest couple of them.
    limiter.check("1.2.3.4", now=1000.0 + RATE_LIMIT + WINDOW_SECONDS + 1)


def test_old_entries_are_discarded_rather_than_accumulating():
    # Without pruning, a long-lived process grows a list per caller forever.
    limiter = RateLimiter()
    for i in range(RATE_LIMIT):
        limiter.check("1.2.3.4", now=1000.0 + i)
    limiter.check("1.2.3.4", now=1000.0 + RATE_LIMIT + WINDOW_SECONDS + 1)
    assert limiter.recorded("1.2.3.4") == 1


def test_a_rejected_request_also_prunes():
    # The rejection path must not leave stale entries behind either.
    limiter = RateLimiter()
    for i in range(RATE_LIMIT):
        limiter.check("1.2.3.4", now=1000.0 + i)
    with pytest.raises(HTTPException):
        limiter.check("1.2.3.4", now=1000.0 + RATE_LIMIT)
    assert limiter.recorded("1.2.3.4") == RATE_LIMIT


def test_the_clock_defaults_to_the_monotonic_one():
    # Passing `now` is a test convenience; production reads the clock itself.
    limiter = RateLimiter()
    limiter.check("1.2.3.4")
    assert limiter.recorded("1.2.3.4") == 1
