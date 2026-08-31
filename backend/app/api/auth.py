"""Supabase JWT verification.

Tokens are verified locally against cached JWKS: no network round trip per
request, and no dependency on Supabase being reachable to serve one.
"""

import os
from functools import lru_cache

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient
from jwt.exceptions import PyJWKClientError

# auto_error=False is required: HTTPBearer's default raises 403 when the
# header is missing, and the contract for this API is 401.
_bearer = HTTPBearer(auto_error=False)


def supabase_url() -> str:
    url = os.environ.get("SUPABASE_URL")
    if not url:
        raise RuntimeError("SUPABASE_URL is not set")
    return url.rstrip("/")


@lru_cache(maxsize=1)
def jwk_client() -> PyJWKClient:
    """Cached JWKS client. `cache_clear()` resets it for tests."""
    return PyJWKClient(
        f"{supabase_url()}/auth/v1/.well-known/jwks.json", cache_keys=True
    )


def verify_token(token: str) -> str:
    """Return the subject of a valid Supabase token, or raise 401.

    Every argument to `jwt.decode` is load-bearing. Pinning `algorithms`
    blocks algorithm-confusion attacks; `audience` and `issuer` stop a token
    minted for a different Supabase project from being accepted here.
    """
    issuer = f"{supabase_url()}/auth/v1"
    try:
        key = jwk_client().get_signing_key_from_jwt(token).key
    except PyJWKClientError as exc:
        # An unreachable JWKS endpoint is an outage, not a bad credential.
        # Reporting 401 here sends the on-call engineer hunting an auth bug.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="cannot reach the identity provider",
        ) from exc

    try:
        claims = jwt.decode(
            token,
            key,
            algorithms=["ES256"],
            audience="authenticated",
            issuer=issuer,
            # exp is checked when present but not required by default, so a
            # signature-valid token without it would never expire.
            options={"require": ["exp", "sub", "aud", "iss"]},
        )
    except Exception as exc:  # PyJWT raises several unrelated types
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid token"
        ) from exc

    subject = claims.get("sub")
    if not subject:
        # A signature-valid token with no subject would scope every query to
        # nobody, which is a silent failure rather than a loud one.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="token has no subject"
        )
    return str(subject)


def current_user_id(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> str:
    """FastAPI dependency yielding the verified user's id."""
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="not authenticated"
        )
    return verify_token(credentials.credentials)
