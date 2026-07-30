"""Admin: model registry + background data refresh.

A refresh runs in a daemon thread guarded by a module-level lock; its
progress lives in module state served by /admin/refresh/status. A new
model is only STAGED — activation stays an explicit admin click.
"""

import threading
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException

from ..jobs import refresh
from ..pipeline import registry
from .schemas import AdminModelsResponse, RefreshStatus

router = APIRouter(prefix="/api")

_lock = threading.Lock()
_state: dict = {
    "running": False,
    "started_at": None,
    "finished_at": None,
    "error": None,
    "staged_version": None,
    "message": None,
}


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _versions() -> list[dict]:
    return [
        {
            "version": v["version"],
            "created_at": str(v.get("created_at", "")),
            "note": v.get("note", ""),
            "active": bool(v.get("active")),
            "metrics": v.get("metrics") or [],
        }
        for v in registry.list_versions()
    ]


@router.get("/admin/models", response_model=AdminModelsResponse)
def list_models() -> AdminModelsResponse:
    return AdminModelsResponse(versions=_versions())


@router.post("/admin/models/{version}/activate", response_model=AdminModelsResponse)
def activate_model(version: str) -> AdminModelsResponse:
    try:
        registry.activate(version)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return AdminModelsResponse(versions=_versions())


def _run_refresh() -> None:
    error: str | None = None
    version: str | None = None
    try:
        summary = refresh.run_full_refresh(activate=False)
        version = (summary or {}).get("version")
    except Exception as exc:  # keep the API alive; surface the error in status
        error = str(exc) or exc.__class__.__name__
    with _lock:
        _state["running"] = False
        _state["finished_at"] = _now_iso()
        _state["error"] = error
        _state["staged_version"] = version
        _state["message"] = (
            f"New model {version} staged — review metrics then activate"
            if version and not error
            else None
        )


@router.post("/admin/refresh", response_model=RefreshStatus)
def start_refresh() -> RefreshStatus:
    with _lock:
        if _state["running"]:
            raise HTTPException(status_code=409, detail="A data refresh is already running.")
        _state.update(
            running=True,
            started_at=_now_iso(),
            finished_at=None,
            error=None,
            staged_version=None,
            message=None,
        )
        snapshot = RefreshStatus(**_state)
    threading.Thread(target=_run_refresh, name="draftengine-refresh", daemon=True).start()
    return snapshot


@router.get("/admin/refresh/status", response_model=RefreshStatus)
def refresh_status() -> RefreshStatus:
    with _lock:
        return RefreshStatus(**_state)
