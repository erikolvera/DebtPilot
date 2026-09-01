import pytest
from fastapi import HTTPException

from starlette.datastructures import Address, Headers
from starlette.requests import Request

from app.api.guidance.ratelimit import (
    MAX_TRACKED_CALLERS,
    RATE_LIMIT,
    WINDOW_SECONDS,
    RateLimiter,
    caller_key,
)


def _request(peer: str | None, forwarded: str | None) -> Request:
    """A Request with only the two fields caller_key reads.

    Built from a raw ASGI scope rather than a TestClient call: the point is
    to control the peer address and the header independently, and a real
    client always supplies both.
    """
    headers = Headers({"x-forwarded-for": forwarded} if forwarded is not None else {})
    scope = {
        "type": "http",
        "method": "POST",
        "path": "/",
        "headers": headers.raw,
        "client": Address(peer, 1234) if peer is not None else None,
    }
    return Request(scope)


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


def test_a_bucket_disappears_once_its_hits_age_out():
    """Prune to nothing, not to an empty list.

    The limiter is process-lifetime state on a public endpoint. Leaving an
    empty list behind per caller turns it into an unbounded map keyed by
    attacker-chosen addresses -- a slow memory leak caused by the very thing
    meant to protect the service.
    """
    limiter = RateLimiter()
    limiter.check("1.2.3.4", now=0.0)
    assert limiter.recorded("1.2.3.4") == 1

    # The same caller returning after the window: the bucket is rebuilt with
    # one fresh hit, not left holding a stale list.
    limiter.check("1.2.3.4", now=WINDOW_SECONDS + 1.0)
    assert limiter.recorded("1.2.3.4") == 1


def test_one_shot_callers_are_swept_once_the_map_grows():
    """The leak a per-caller prune cannot reach.

    Pruning runs on a caller's next request, which for a scripted address is
    never. Ten thousand single-request callers would otherwise sit in the map
    until the process restarts.
    """
    limiter = RateLimiter()
    for i in range(MAX_TRACKED_CALLERS + 1):
        limiter.check(f"caller-{i}", now=0.0)
    assert len(limiter._hits) == MAX_TRACKED_CALLERS + 1

    limiter.check("someone new", now=WINDOW_SECONDS + 1.0)
    assert len(limiter._hits) == 1


def test_the_sweep_keeps_callers_who_are_still_inside_the_window():
    limiter = RateLimiter()
    for i in range(MAX_TRACKED_CALLERS + 1):
        limiter.check(f"caller-{i}", now=0.0)
    limiter.check("recent", now=WINDOW_SECONDS - 1.0)

    limiter.check("newest", now=WINDOW_SECONDS + 1.0)
    assert set(limiter._hits) == {"recent", "newest"}


def test_asking_about_an_unknown_caller_does_not_create_a_bucket():
    limiter = RateLimiter()
    assert limiter.recorded("never seen") == 0
    assert limiter._hits == {}


def test_the_peer_address_is_the_key_by_default(monkeypatch):
    """A forwarded header is caller-controlled and must be ignored unless an
    operator has said a proxy sets it. Believing it by default hands every
    abuser an unlimited supply of buckets."""
    monkeypatch.delenv("TRUST_PROXY_HEADERS", raising=False)
    assert caller_key(_request(peer="10.0.0.1", forwarded="9.9.9.9")) == "10.0.0.1"


@pytest.mark.parametrize("value", ["1", "true", "TRUE", "yes", "on", " On "])
def test_the_forwarded_header_is_used_when_the_operator_opts_in(monkeypatch, value):
    monkeypatch.setenv("TRUST_PROXY_HEADERS", value)
    # The client is the FIRST entry: a proxy appends, so the last entry is the
    # proxy itself, which would put every user in a single bucket.
    key = caller_key(_request(peer="10.0.0.1", forwarded="9.9.9.9, 10.0.0.1"))
    assert key == "9.9.9.9"


@pytest.mark.parametrize("value", ["0", "false", "no", "", "  "])
def test_other_values_do_not_enable_proxy_trust(monkeypatch, value):
    monkeypatch.setenv("TRUST_PROXY_HEADERS", value)
    assert caller_key(_request(peer="10.0.0.1", forwarded="9.9.9.9")) == "10.0.0.1"


def test_trusting_proxies_still_falls_back_when_the_header_is_useless(monkeypatch):
    monkeypatch.setenv("TRUST_PROXY_HEADERS", "1")
    assert caller_key(_request(peer="10.0.0.1", forwarded=None)) == "10.0.0.1"
    assert caller_key(_request(peer="10.0.0.1", forwarded="  ,  ")) == "10.0.0.1"


def test_a_request_with_no_client_shares_one_bucket(monkeypatch):
    """ASGI does not guarantee a client address -- a unix-socket transport can
    omit it. Keying those together is the safe reading: unknown callers share
    a limit rather than escaping it."""
    monkeypatch.delenv("TRUST_PROXY_HEADERS", raising=False)
    assert caller_key(_request(peer=None, forwarded=None)) == "unknown"
