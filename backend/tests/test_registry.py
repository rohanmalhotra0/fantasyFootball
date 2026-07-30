"""Tests for draftengine.pipeline.registry: save -> list -> activate -> load."""

import json

import numpy as np
import pandas as pd
import pytest
import xgboost as xgb

from draftengine.config import models_dir
from draftengine.db import init_db, session_scope
from draftengine.pipeline import registry
from draftengine.pipeline.dataset import FEATURE_COLUMNS

METRICS = [
    {
        "season": 2024,
        "n_players": 5,
        "spearman_model": 0.61,
        "spearman_naive": 0.55,
        "mae_model": 42.0,
        "per_position": {},
    }
]


def tiny_model() -> tuple[xgb.XGBRegressor, pd.DataFrame]:
    """A real fitted XGBRegressor on 5 synthetic rows over FEATURE_COLUMNS."""
    rng = np.random.default_rng(7)
    X = pd.DataFrame(
        rng.random((5, len(FEATURE_COLUMNS))), columns=FEATURE_COLUMNS
    )
    y = rng.random(5) * 100.0
    model = xgb.XGBRegressor(n_estimators=3, max_depth=2, random_state=0)
    model.fit(X, y)
    return model, X


def test_empty_registry():
    assert registry.active_version() is None
    assert registry.load_model() is None
    assert registry.list_versions() == []


def test_save_list_activate_load_roundtrip():
    init_db()
    model, X = tiny_model()

    version = registry.save_version(model, METRICS, FEATURE_COLUMNS, note="unit test")
    vdir = models_dir() / version
    assert (vdir / "model.json").exists()
    assert json.loads((vdir / "features.json").read_text()) == FEATURE_COLUMNS
    assert json.loads((vdir / "metrics.json").read_text()) == METRICS

    versions = registry.list_versions()
    assert [v["version"] for v in versions] == [version]
    assert versions[0]["active"] is False
    assert versions[0]["note"] == "unit test"
    assert versions[0]["metrics"] == METRICS
    assert "created_at" in versions[0]
    # saving never activates implicitly
    assert registry.active_version() is None

    registry.activate(version)
    assert registry.active_version() == version
    assert registry.list_versions()[0]["active"] is True

    # activation mirrors into the key_value table for the API layer
    from draftengine.orm import KeyValue

    with session_scope() as session:
        row = session.get(KeyValue, "active_model")
        assert row is not None
        assert row.value == {"version": version}

    loaded = registry.load_model()
    assert loaded is not None
    np.testing.assert_allclose(loaded.predict(X), model.predict(X), rtol=1e-5)

    # explicit-version load matches too
    np.testing.assert_allclose(
        registry.load_model(version).predict(X), model.predict(X), rtol=1e-5
    )


def test_activate_unknown_version_raises():
    init_db()
    with pytest.raises(ValueError, match="unknown model version"):
        registry.activate("v29990101_000000")


def test_load_model_missing_files_returns_none():
    assert registry.load_model("v29990101_000000") is None
