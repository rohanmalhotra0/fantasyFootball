"""Admin API: model registry, background refresh lifecycle, scheduler."""

import json
import threading
import time

import pytest

from draftengine.config import models_dir

METRIC = {
    "season": 2024,
    "n_players": 150,
    "spearman_model": 0.61,
    "spearman_naive": 0.55,
    "mae_model": 48.2,
    "per_position": {},
}


@pytest.fixture(autouse=True)
def reset_refresh_state():
    """Module-level refresh state must not leak between tests."""
    from draftengine.api import routes_admin

    with routes_admin._lock:
        routes_admin._state.update(
            running=False,
            started_at=None,
            finished_at=None,
            error=None,
            staged_version=None,
            message=None,
        )
    yield


def _write_registry(active: str | None = None) -> None:
    index = {
        "active": active,
        "versions": [
            {
                "version": "v20260701_000000",
                "created_at": "2026-07-01T00:00:00+00:00",
                "note": "first",
                "metrics": [METRIC],
            }
        ],
    }
    (models_dir() / "registry.json").write_text(json.dumps(index))


def _wait_finished(client, timeout: float = 5.0) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        body = client.get("/api/admin/refresh/status").json()
        if not body["running"]:
            return body
        time.sleep(0.02)
    raise AssertionError("refresh did not finish in time")


def test_models_empty_registry(client):
    assert client.get("/api/admin/models").json() == {"versions": []}


def test_models_list_and_activate(client):
    _write_registry()
    body = client.get("/api/admin/models").json()
    assert [v["version"] for v in body["versions"]] == ["v20260701_000000"]
    assert body["versions"][0]["active"] is False
    assert body["versions"][0]["note"] == "first"
    assert body["versions"][0]["metrics"][0]["season"] == 2024

    body = client.post("/api/admin/models/v20260701_000000/activate").json()
    assert body["versions"][0]["active"] is True

    resp = client.post("/api/admin/models/v_nope/activate")
    assert resp.status_code == 404
    assert "v_nope" in resp.json()["detail"]


def test_refresh_start_and_complete(client, monkeypatch, tmp_path):
    from draftengine.jobs import refresh

    sentinel = tmp_path / "refresh_ran.txt"

    def stub(activate=False):
        assert activate is False  # refreshed models are staged, never auto-active
        sentinel.write_text("ran")
        return {"version": "v20990101_000000"}

    monkeypatch.setattr(refresh, "run_full_refresh", stub)

    resp = client.post("/api/admin/refresh")
    assert resp.status_code == 200
    started = resp.json()
    assert started["running"] is True
    assert started["started_at"] is not None
    assert started["staged_version"] is None

    status = _wait_finished(client)
    assert sentinel.exists()
    assert status["error"] is None
    assert status["staged_version"] == "v20990101_000000"
    assert status["message"] == (
        "New model v20990101_000000 staged — review metrics then activate"
    )
    assert status["started_at"] is not None
    assert status["finished_at"] is not None


def test_refresh_double_start_409(client, monkeypatch):
    from draftengine.jobs import refresh

    release = threading.Event()

    def stub(activate=False):
        release.wait(5)
        return {"version": "v1"}

    monkeypatch.setattr(refresh, "run_full_refresh", stub)
    try:
        assert client.post("/api/admin/refresh").status_code == 200
        resp = client.post("/api/admin/refresh")
        assert resp.status_code == 409
        assert "already running" in resp.json()["detail"]
    finally:
        release.set()
    status = _wait_finished(client)
    assert status["staged_version"] == "v1"


def test_refresh_error_captured(client, monkeypatch):
    from draftengine.jobs import refresh

    def stub(activate=False):
        raise RuntimeError("nflverse download exploded")

    monkeypatch.setattr(refresh, "run_full_refresh", stub)
    client.post("/api/admin/refresh")
    status = _wait_finished(client)
    assert status["error"] == "nflverse download exploded"
    assert status["staged_version"] is None
    assert status["message"] is None
    assert status["finished_at"] is not None

    # A failed run releases the lock: starting again works.
    monkeypatch.setattr(refresh, "run_full_refresh", lambda activate=False: {"version": "v2"})
    assert client.post("/api/admin/refresh").status_code == 200
    assert _wait_finished(client)["staged_version"] == "v2"


# ---------- jobs/scheduler.py ----------


def test_scheduler_noop_without_env(monkeypatch):
    from draftengine.jobs import scheduler

    monkeypatch.delenv("DRAFTENGINE_SCHEDULE", raising=False)
    assert scheduler.start_scheduler() is None
    assert scheduler._scheduler is None


def test_scheduler_starts_daily_job_and_stops(monkeypatch):
    from draftengine.jobs import scheduler

    monkeypatch.setenv("DRAFTENGINE_SCHEDULE", "1")
    sched = scheduler.start_scheduler()
    try:
        assert sched is not None
        assert scheduler.start_scheduler() is sched  # idempotent
        job = sched.get_job(scheduler.JOB_ID)
        assert job is not None
        trigger = str(job.trigger)
        assert "hour='6'" in trigger
        assert "minute='0'" in trigger
    finally:
        scheduler.stop_scheduler()
    assert scheduler._scheduler is None
