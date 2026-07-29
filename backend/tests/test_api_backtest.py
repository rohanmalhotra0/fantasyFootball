"""Backtest API: scatter ranks, hits/busts math, 404s, simulate stub."""

import sys
import types

import numpy as np
import pandas as pd
import pytest

from draftengine.names import normalize_name
from draftengine.pipeline.dataset import FEATURE_COLUMNS, features_path

N_PLAYERS = 20


def _write_features() -> None:
    """Synthetic features: 20 players x targets 2022/2023 (train), 2024
    (holdout with actuals), 2025 (no actuals yet)."""
    rng = np.random.default_rng(7)
    rows = []
    for target in (2022, 2023, 2024, 2025):
        for i in range(N_PLAYERS):
            base = 350.0 - i * 15.0
            position = "RB" if i % 2 == 0 else "WR"
            row = {c: 0.0 for c in FEATURE_COLUMNS}
            row.update(
                {
                    "player_id": f"pl{i:02d}",
                    "name": f"Player {i:02d}",
                    "norm_name": normalize_name(f"Player {i:02d}"),
                    "position": position,
                    "target_season": target,
                    "experience": 3.0,
                    "has_lag2": 1.0,
                    "lag1_ppr_points": base + rng.normal(0, 5),
                    "lag1_ppg": (base + rng.normal(0, 5)) / 16.0,
                    "lag1_games": 16.0,
                    "lag2_ppr_points": base + rng.normal(0, 8),
                    "pos_RB": 1.0 if position == "RB" else 0.0,
                    "pos_WR": 1.0 if position == "WR" else 0.0,
                    "ppr_points_target": (
                        None if target == 2025 else base + rng.normal(0, 25)
                    ),
                }
            )
            rows.append(row)
    frame = pd.DataFrame(rows)
    frame.to_parquet(features_path(), index=False)


def _adp_frame(year: int) -> pd.DataFrame:
    """Cached-ADP stand-in matching the first 15 synthetic players."""
    rows = []
    for i in range(15):
        rows.append(
            {
                "name": f"Player {i:02d}",
                "norm_name": normalize_name(f"Player {i:02d}"),
                "position": "RB" if i % 2 == 0 else "WR",
                "adp": float(i + 1),
                "adp_rank": i + 1,
                "season": year,
            }
        )
    return pd.DataFrame(rows)


@pytest.fixture()
def with_features():
    _write_features()


@pytest.fixture()
def with_adp(monkeypatch):
    from draftengine.data import ffc

    monkeypatch.setattr(ffc, "load_adp", lambda year, teams=12, scoring="ppr": _adp_frame(year))


@pytest.fixture()
def without_adp(monkeypatch):
    from draftengine.data import ffc

    monkeypatch.setattr(ffc, "load_adp", lambda year, teams=12, scoring="ppr": None)


def test_backtest_years(client, with_features, without_adp):
    body = client.get("/api/backtest/years").json()
    # 2022 has actuals but nothing earlier to train on; 2025 has no actuals.
    assert body["years"] == [2023, 2024]


def test_backtest_years_empty_without_features(client, without_adp):
    assert client.get("/api/backtest/years").json() == {"years": []}


def test_backtest_year_scatter_and_hits_busts(client, with_features, with_adp):
    resp = client.get("/api/backtest/2024")
    assert resp.status_code == 200
    body = resp.json()
    assert body["season"] == 2024
    assert body["adp_available"] is True
    assert body["metrics"]["season"] == 2024
    assert body["metrics"]["n_players"] == N_PLAYERS
    assert body["metrics"]["n_drafted"] == 15
    assert body["metrics"]["spearman_adp_drafted"] is not None

    scatter = body["model_scatter"]
    assert len(scatter) == N_PLAYERS
    # Ranks are exactly 1..N; sorted by rank means predicted is non-increasing.
    assert sorted(p["rank"] for p in scatter) == list(range(1, N_PLAYERS + 1))
    assert sorted(p["actual_rank"] for p in scatter) == list(range(1, N_PLAYERS + 1))
    ordered = sorted(scatter, key=lambda p: p["rank"])
    preds = [p["predicted"] for p in ordered]
    assert preds == sorted(preds, reverse=True)
    best_actual = max(scatter, key=lambda p: p["actual"])
    assert best_actual["actual_rank"] == 1

    # ADP scatter: rank is the adp_rank we injected, actual_rank matches the
    # model scatter's for the same player.
    adp_scatter = body["adp_scatter"]
    assert adp_scatter is not None and len(adp_scatter) == 15
    actual_rank_by_id = {p["player_id"]: p["actual_rank"] for p in scatter}
    for point in adp_scatter:
        i = int(point["player_id"][2:])
        assert point["rank"] == i + 1
        assert point["actual_rank"] == actual_rank_by_id[point["player_id"]]

    # Hits/busts math, cross-checked against the scatter itself.
    diffs = sorted(p["actual_rank"] - p["rank"] for p in scatter)
    hits, busts = body["hits"], body["busts"]
    for row in hits + busts:
        assert row["rank"] <= 100
        assert row["diff"] == row["actual_rank"] - row["rank"]
    assert [r["diff"] for r in hits] == diffs[:10]
    assert [r["diff"] for r in busts] == sorted(diffs, reverse=True)[:10]


def test_backtest_year_without_adp(client, with_features, without_adp):
    body = client.get("/api/backtest/2023").json()
    assert body["adp_available"] is False
    assert body["adp_scatter"] is None
    assert body["metrics"]["n_drafted"] is None
    assert len(body["model_scatter"]) == N_PLAYERS


def test_backtest_404s(client, with_features, without_adp):
    assert client.get("/api/backtest/2016").status_code == 404  # before range
    assert client.get("/api/backtest/2030").status_code == 404  # after range
    assert client.get("/api/backtest/2025").status_code == 404  # no actuals yet


def test_backtest_404_without_features(client, without_adp):
    assert client.get("/api/backtest/2024").status_code == 404


# ---------- simulate ----------

SIM_PICK = {
    "overall": 5,
    "round": 1,
    "team_index": 5,
    "name": "Player 00",
    "position": "RB",
    "points": 350.0,
    "is_me": True,
}
SIM_PAYLOAD = {
    "season": 2024,
    "slot": 5,
    "my_roster": [SIM_PICK],
    "my_total": 350.0,
    "league_totals": [100.0] * 12,
    "league_median": 100.0,
    "opponent_strategy": "adp",
    "log": [SIM_PICK],
}


def _fake_simulate_module(fn) -> types.ModuleType:
    module = types.ModuleType("draftengine.pipeline.simulate")
    module.simulate_draft = fn
    return module


def test_simulate_with_stub(client, monkeypatch):
    calls = {}

    def fake(year, slot, settings):
        calls["args"] = (year, slot, settings.teams)
        return SIM_PAYLOAD

    monkeypatch.setitem(sys.modules, "draftengine.pipeline.simulate", _fake_simulate_module(fake))
    resp = client.post("/api/backtest/2024/simulate", json={"slot": 5})
    assert resp.status_code == 200
    body = resp.json()
    assert body["my_total"] == 350.0
    assert body["opponent_strategy"] == "adp"
    assert calls["args"] == (2024, 5, 12)


def test_simulate_503_when_module_missing(client, monkeypatch):
    # None in sys.modules makes the import raise, like a not-yet-written module.
    monkeypatch.setitem(sys.modules, "draftengine.pipeline.simulate", None)
    resp = client.post("/api/backtest/2024/simulate", json={"slot": 5})
    assert resp.status_code == 503
    assert "warming up" in resp.json()["detail"]


def test_simulate_503_when_data_missing(client, monkeypatch):
    def fake(year, slot, settings):
        raise FileNotFoundError("features.parquet not built yet")

    monkeypatch.setitem(sys.modules, "draftengine.pipeline.simulate", _fake_simulate_module(fake))
    resp = client.post("/api/backtest/2024/simulate", json={"slot": 5})
    assert resp.status_code == 503
    assert "warming up" in resp.json()["detail"]
