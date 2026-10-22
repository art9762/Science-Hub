"""HTTP application and local-only security boundary."""

from contextlib import asynccontextmanager
import logging
import os
from pathlib import Path
from urllib.parse import urlsplit

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException
from starlette.middleware.trustedhost import TrustedHostMiddleware

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")
logger = logging.getLogger(__name__)


def create_app(data_dir: Path | None = None) -> FastAPI:
    from backend.storage import Store
    from backend.core import router as core_router
    from backend.ai import router as ai_router, setup_ai, shutdown_ai

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        setup_ai(app)
        yield
        await shutdown_ai(app)

    app = FastAPI(title="Science Hub", version="0.1.0", lifespan=lifespan)
    path = data_dir or Path(os.getenv("SCIENCE_HUB_DATA_DIR", "data"))
    if not path.is_absolute():
        path = ROOT / path
    app.state.store = Store(path)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=["localhost", "127.0.0.1", "[::1]", "testserver"])

    @app.middleware("http")
    async def local_boundary(request: Request, call_next):
        origin = request.headers.get("origin")
        if origin and request.method not in ("GET", "HEAD", "OPTIONS"):
            parsed = urlsplit(origin)
            allowed_ports = {8765, 5173, int(os.getenv("SCIENCE_HUB_PORT", "8765"))}
            if (
                parsed.scheme not in ("http", "https")
                or parsed.hostname not in ("localhost", "127.0.0.1", "::1")
                or parsed.port not in allowed_ports
            ):
                return JSONResponse(
                    {
                        "error": {
                            "code": "FOREIGN_ORIGIN",
                            "message": "Запросы к локальному приложению разрешены только из его интерфейса.",
                        }
                    },
                    status_code=403,
                )
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Frame-Options"] = "SAMEORIGIN"
        if request.url.path.startswith("/api"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.exception_handler(KeyError)
    async def not_found(_request, _exc):
        return JSONResponse(
            {"error": {"code": "NOT_FOUND", "message": "Объект не найден в этом проекте."}}, status_code=404
        )

    @app.exception_handler(HTTPException)
    async def http_error(_request, exc):
        detail = exc.detail
        message = detail if isinstance(detail, str) else "Запрос не может быть выполнен."
        return JSONResponse(
            {"error": {"code": f"HTTP_{exc.status_code}", "message": message}},
            status_code=exc.status_code,
            headers=exc.headers,
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error(_request, exc):
        # Do not echo request input: it may include an API key.
        issues = [f"{'.'.join(str(p) for p in issue['loc'])}: {issue['msg']}" for issue in exc.errors()]
        return JSONResponse(
            {"error": {"code": "VALIDATION_ERROR", "message": "; ".join(issues)}}, status_code=422
        )

    @app.exception_handler(Exception)
    async def internal_error(_request, exc):
        logger.error("Unhandled application error: %s", type(exc).__name__)
        return JSONResponse(
            {
                "error": {
                    "code": "INTERNAL_ERROR",
                    "message": "Внутренняя ошибка. Проверьте доступность локального хранилища и настройки.",
                }
            },
            status_code=500,
        )

    @app.get("/api/health")
    async def health():
        return {
            "application": "science-hub",
            "status": "ok",
            "version": "0.1.0",
            "storage": "local",
            "api_docs": "/docs",
        }

    app.include_router(core_router, prefix="/api")
    app.include_router(ai_router, prefix="/api")
    frontend = ROOT / "frontend" / "dist"
    if (frontend / "assets").exists():
        app.mount("/assets", StaticFiles(directory=frontend / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    async def spa(path: str):
        if path.startswith("api/"):
            raise HTTPException(404, "API endpoint not found")
        if (frontend / "index.html").is_file():
            return FileResponse(frontend / "index.html")
        return JSONResponse(
            {
                "message": "Соберите интерфейс: cd frontend && npm install && npm run build",
                "api_docs": "/docs",
            },
            status_code=503,
        )

    return app
