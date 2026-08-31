"""Application factory.

Everything process-shaped lives here: CORS, exception handlers, and the
health check. The payoff-plan route itself lives in routers/payoff_plans.py.
"""

import os

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.engine import InvalidDebt

from .routers import payoff_plans

DEFAULT_ORIGIN = "http://localhost:3000"


def allowed_origins() -> list[str]:
    """CORS origins from the environment, comma separated.

    Never hardcoded: every Vercel preview deployment gets its own origin.
    """
    raw = os.environ.get("ALLOWED_ORIGINS", DEFAULT_ORIGIN)
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


def handle_invalid_debt(request: Request, exc: Exception) -> JSONResponse:
    """Surface engine validation as a 422 in FastAPI's own error envelope.

    Matching the framework's shape means clients write one error parser
    rather than two — and it guarantees a rejected portfolio never escapes as
    an unhandled 500.
    """
    return JSONResponse(
        status_code=422,
        content={"detail": [{"type": "invalid_debt", "msg": str(exc)}]},
    )


def create_app() -> FastAPI:
    app = FastAPI(title="DebtPilot API", version="1.0.0")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins(),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_exception_handler(InvalidDebt, handle_invalid_debt)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(payoff_plans.router, prefix="/v1")
    return app


app = create_app()
