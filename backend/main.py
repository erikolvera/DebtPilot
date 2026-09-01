"""Vercel's conventional FastAPI entrypoint.

The application itself remains in ``app.api.main`` so local development,
tests, and deployment all use the same FastAPI instance.
"""

from app.api.main import app

__all__ = ["app"]
