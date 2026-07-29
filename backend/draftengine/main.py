import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import __version__
from .db import init_db

log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    # Seed current-season ADP from the research board when the live FFC
    # fetch has never succeeded (idempotent; a real refresh overwrites it).
    try:
        from .data.seed import seed_adp_from_board

        seed_adp_from_board()
    except Exception:  # seeding is best-effort, never blocks startup
        log.warning("ADP seed from board_2026.csv failed", exc_info=True)
    from .jobs.scheduler import start_scheduler, stop_scheduler

    start_scheduler()  # no-op unless DRAFTENGINE_SCHEDULE=1
    yield
    stop_scheduler()


def create_app() -> FastAPI:
    app = FastAPI(title="DraftEngine", version=__version__, lifespan=lifespan)

    extra_origins = [
        o.strip() for o in os.environ.get("DRAFTENGINE_CORS_ORIGINS", "").split(",") if o.strip()
    ]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", *extra_origins],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    from .api import register_routes

    register_routes(app)

    @app.get("/api/health")
    def health() -> dict:
        return {"status": "ok", "version": __version__}

    return app


app = create_app()
