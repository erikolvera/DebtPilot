"""Database access, scoped to one user per transaction.

Every query in this application runs inside `user_scoped_connection`, which
stamps the verified user's id into `request.jwt.claims` so the row-level
security policies on `public.debts` can resolve `auth.uid()`.
"""

import json
import os
from collections.abc import Iterator
from contextlib import contextmanager
from functools import lru_cache

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Connection, Engine


def database_url() -> str:
    """The Postgres URL. Raises rather than defaulting.

    A default would let a misconfigured production process start up pointed at
    nothing, which is worse than refusing to start.
    """
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL is not set")
    return url


@lru_cache(maxsize=1)
def get_engine() -> Engine:
    """One engine per process. `cache_clear()` resets it for tests."""
    return create_engine(database_url(), pool_pre_ping=True, future=True)


@contextmanager
def user_scoped_connection(user_id: str) -> Iterator[Connection]:
    """A transaction in which RLS policies see `user_id` as `auth.uid()`.

    Two details here are security-critical.

    `set_config` rather than `SET LOCAL`, because SET LOCAL cannot take a bind
    parameter: the obvious alternative interpolates claims into a SQL string,
    putting an injection hole in the line whose job is enforcing security.

    The third argument `true` scopes the setting to this transaction, so it is
    discarded at COMMIT. Session scope would leak this user's identity to
    whatever request next reuses the pooled connection.
    """
    with get_engine().begin() as conn:
        conn.execute(
            text("select set_config('request.jwt.claims', :claims, true)"),
            {"claims": json.dumps({"sub": user_id})},
        )
        yield conn
