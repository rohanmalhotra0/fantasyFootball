"""Model version registry.

Every trained model is stored under data/models/<version>/ with its
validation metrics. A new model never becomes active implicitly — the
admin flow stages it, shows the metrics, and activation is an explicit
call (or `activate=True` from the CLI where the user is watching).
"""

import json
import os
import threading
from datetime import UTC, datetime
from pathlib import Path

import xgboost as xgb

from ..config import models_dir
from ..db import session_scope

# registry.json is read on every board build and written by the refresh
# thread; writes are atomic (tmp + rename) and read-modify-write cycles
# hold the lock so versions are never lost or torn.
_registry_lock = threading.Lock()


def _versions_index() -> Path:
    return models_dir() / "registry.json"


def _read_index() -> dict:
    p = _versions_index()
    if p.exists():
        return json.loads(p.read_text())
    return {"active": None, "versions": []}


def _write_index(index: dict) -> None:
    target = _versions_index()
    tmp = target.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(index, indent=2))
    os.replace(tmp, target)


def save_version(
    model: xgb.XGBRegressor,
    metrics: list[dict],
    feature_columns: list[str],
    note: str = "",
) -> str:
    version = datetime.now(UTC).strftime("v%Y%m%d_%H%M%S")
    vdir = models_dir() / version
    vdir.mkdir(parents=True, exist_ok=True)
    model.save_model(vdir / "model.json")
    (vdir / "metrics.json").write_text(json.dumps(metrics, indent=2))
    (vdir / "features.json").write_text(json.dumps(feature_columns, indent=2))
    with _registry_lock:
        index = _read_index()
        index["versions"].append(
            {
                "version": version,
                "created_at": datetime.now(UTC).isoformat(),
                "note": note,
                "metrics": metrics,
            }
        )
        _write_index(index)
    return version


def list_versions() -> list[dict]:
    index = _read_index()
    active = index.get("active")
    return [
        {**v, "active": v["version"] == active}
        for v in sorted(index["versions"], key=lambda v: v["version"], reverse=True)
    ]


def active_version() -> str | None:
    return _read_index().get("active")


def activate(version: str) -> None:
    with _registry_lock:
        index = _read_index()
        if version not in {v["version"] for v in index["versions"]}:
            raise ValueError(f"unknown model version: {version}")
        index["active"] = version
        _write_index(index)
    _touch_kv("active_model", {"version": version})
    _sync_active_rows(version)


def _sync_active_rows(version: str) -> None:
    """Keep the DB mirror's active flag in step with registry.json."""
    from ..orm import ModelVersionRow

    with session_scope() as session:
        for row in session.query(ModelVersionRow).all():
            row.active = row.version == version


def load_model(version: str | None = None) -> xgb.XGBRegressor | None:
    version = version or active_version()
    if version is None:
        return None
    path = models_dir() / version / "model.json"
    if not path.exists():
        return None
    model = xgb.XGBRegressor()
    model.load_model(path)
    return model


def _touch_kv(key: str, value: dict) -> None:
    from ..orm import KeyValue

    with session_scope() as session:
        row = session.get(KeyValue, key)
        if row is None:
            session.add(KeyValue(key=key, value=value))
        else:
            row.value = value
            row.updated_at = datetime.utcnow()
