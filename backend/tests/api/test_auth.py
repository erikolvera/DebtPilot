"""Token verification, with real cryptography and no network.

The only thing stubbed is the JWKS fetch, which is an HTTP GET. The keypair,
the signing, `jwt.decode`, and every claim check are real -- so these tests
exercise the actual rejection logic rather than a mock of it.
"""

import time
import uuid

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from app.api import auth

ISSUER = "https://test.supabase.co/auth/v1"

# Captured before any fixture stubs it, so one test can exercise the real
# constructor. Building a PyJWKClient does not fetch anything -- the HTTP GET
# happens on first key lookup -- so this stays offline.
_REAL_JWK_CLIENT = auth.jwk_client


@pytest.fixture(autouse=True)
def _configure(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://test.supabase.co")
    auth.jwk_client.cache_clear()
    yield
    # _stub_jwks replaces jwk_client with a plain callable for the duration of
    # the test, so the cached original may not be back yet at teardown.
    if hasattr(auth.jwk_client, "cache_clear"):
        auth.jwk_client.cache_clear()


@pytest.fixture(scope="module")
def signing_key():
    return ec.generate_private_key(ec.SECP256R1())


@pytest.fixture(autouse=True)
def _stub_jwks(monkeypatch, signing_key):
    """Substitute the JWKS HTTP fetch, and nothing else."""

    class _Key:
        key = signing_key.public_key()

    class _Client:
        def get_signing_key_from_jwt(self, token):
            return _Key()

    monkeypatch.setattr(auth, "jwk_client", lambda: _Client())


def make_token(signing_key, **overrides) -> str:
    claims = {
        "sub": str(uuid.uuid4()),
        "aud": "authenticated",
        "iss": ISSUER,
        "exp": int(time.time()) + 3600,
    }
    claims.update(overrides)
    return jwt.encode(claims, signing_key, algorithm="ES256")


def test_a_valid_token_yields_the_subject(signing_key):
    user_id = str(uuid.uuid4())
    assert auth.verify_token(make_token(signing_key, sub=user_id)) == user_id


def test_an_expired_token_is_rejected(signing_key):
    token = make_token(signing_key, exp=int(time.time()) - 1)
    with pytest.raises(HTTPException) as exc:
        auth.verify_token(token)
    assert exc.value.status_code == 401


def test_a_token_for_another_audience_is_rejected(signing_key):
    with pytest.raises(HTTPException) as exc:
        auth.verify_token(make_token(signing_key, aud="anon"))
    assert exc.value.status_code == 401


def test_a_token_from_another_issuer_is_rejected(signing_key):
    # A token minted by a different Supabase project must not work here.
    with pytest.raises(HTTPException) as exc:
        auth.verify_token(make_token(signing_key, iss="https://evil.supabase.co/auth/v1"))
    assert exc.value.status_code == 401


def test_a_token_signed_by_a_different_key_is_rejected(signing_key):
    other = ec.generate_private_key(ec.SECP256R1())
    forged = jwt.encode(
        {"sub": "x", "aud": "authenticated", "iss": ISSUER, "exp": int(time.time()) + 60},
        other,
        algorithm="ES256",
    )
    with pytest.raises(HTTPException) as exc:
        auth.verify_token(forged)
    assert exc.value.status_code == 401


def test_garbage_is_rejected():
    with pytest.raises(HTTPException) as exc:
        auth.verify_token("not-a-jwt")
    assert exc.value.status_code == 401


def test_a_token_without_a_subject_is_rejected(signing_key):
    # A signature-valid token with no `sub` would otherwise produce a None
    # user id and silently scope every query to nobody.
    token = jwt.encode(
        {"aud": "authenticated", "iss": ISSUER, "exp": int(time.time()) + 60},
        signing_key,
        algorithm="ES256",
    )
    with pytest.raises(HTTPException) as exc:
        auth.verify_token(token)
    assert exc.value.status_code == 401


def test_missing_credentials_are_a_401_not_a_403():
    # FastAPI's HTTPBearer returns 403 by default when the header is absent.
    # The contract says 401, so the dependency must use auto_error=False.
    with pytest.raises(HTTPException) as exc:
        auth.current_user_id(credentials=None)
    assert exc.value.status_code == 401


def test_valid_credentials_pass_through(signing_key):
    user_id = str(uuid.uuid4())
    creds = HTTPAuthorizationCredentials(
        scheme="Bearer", credentials=make_token(signing_key, sub=user_id)
    )
    assert auth.current_user_id(credentials=creds) == user_id


def test_supabase_url_must_be_configured(monkeypatch):
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    with pytest.raises(RuntimeError, match="SUPABASE_URL"):
        auth.supabase_url()


def test_supabase_url_strips_a_trailing_slash(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://test.supabase.co/")
    assert auth.supabase_url() == "https://test.supabase.co"


def test_jwk_client_points_at_the_configured_project():
    # The only test that runs the real constructor rather than the stub.
    _REAL_JWK_CLIENT.cache_clear()
    try:
        client = _REAL_JWK_CLIENT()
        assert client.uri == "https://test.supabase.co/auth/v1/.well-known/jwks.json"
    finally:
        _REAL_JWK_CLIENT.cache_clear()
