"""Application factory.

Everything process-shaped lives here: CORS, exception handlers, and the
health check. The payoff-plan route itself lives in routers/payoff_plans.py.
"""

import os

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.datastructures import Headers
from starlette.types import ASGIApp, Receive, Scope, Send

from app.engine import InvalidDebt

from .routers import financial_reports
from .routers import payoff_plans

DEFAULT_ORIGIN = "http://localhost:3000"

# The largest request body this API will read. `max_length=20` on `debts` is
# not a request-size cap: it runs only after the whole body has been buffered
# and parsed, so a 500 MB array of debts is fully materialized before Pydantic
# gets to count it. 256 KB comfortably holds 20 debts and nothing else.
MAX_BODY_BYTES = 256 * 1024


class BodySizeLimitMiddleware:
    """Reject oversized requests before a downstream parser sees the body.

    Content-Length provides a cheap early rejection, but it is optional and a
    sender can lie. Buffering at most MAX_BODY_BYTES also enforces the limit on
    chunked bodies. The bounded buffer is replayed to FastAPI afterward.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http":
            declared = Headers(scope=scope).get("content-length", "")
            if declared.isdigit() and int(declared) > MAX_BODY_BYTES:
                await self._reject(scope, receive, send, ["header", "content-length"])
                return

            messages: list[dict] = []
            received = 0
            while True:
                message = await receive()
                messages.append(message)
                if message["type"] != "http.request":
                    break
                received += len(message.get("body", b""))
                if received > MAX_BODY_BYTES:
                    await self._reject(scope, receive, send, ["body"])
                    return
                if not message.get("more_body", False):
                    break

            index = 0

            async def replay() -> dict:
                nonlocal index
                if index < len(messages):
                    message = messages[index]
                    index += 1
                    return message
                return await receive()

            await self.app(scope, replay, send)
            return
        await self.app(scope, receive, send)

    @staticmethod
    async def _reject(
        scope: Scope, receive: Receive, send: Send, location: list[str]
    ) -> None:
        response = JSONResponse(
            status_code=413,
            content={
                "detail": [
                    {
                        "type": "request_too_large",
                        "loc": location,
                        "msg": f"Request body exceeds the {MAX_BODY_BYTES} byte limit.",
                    }
                ]
            },
        )
        await response(scope, receive, send)


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
        content={
            "detail": [
                # `loc` is what makes "clients write one error parser" true:
                # FastAPI's own 422 envelope always carries one, so an entry
                # without it is a shape the client's parser has never seen.
                {"type": "invalid_debt", "loc": ["body", "debts"], "msg": str(exc)}
            ]
        },
    )


def create_app() -> FastAPI:
    app = FastAPI(title="DebtPilot API", version="1.0.0")

    # Added first so CORS, added second, ends up outermost: a 413 still comes
    # back with the headers a browser needs in order to read it.
    app.add_middleware(BodySizeLimitMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins(),
        # The anonymous MVP uses no cookies or sessions.
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
    )
    app.add_exception_handler(InvalidDebt, handle_invalid_debt)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(payoff_plans.router, prefix="/v1")
    app.include_router(financial_reports.router, prefix="/v1")
    return app


app = create_app()
