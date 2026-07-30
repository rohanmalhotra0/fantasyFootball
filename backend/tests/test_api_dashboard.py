"""Dashboard API + history heatmaps (hand-verified cell math)."""

import json

import pandas as pd

METRIC = {
    "season": 2024,
    "n_players": 150,
    "spearman_model": 0.61,
    "spearman_naive": 0.55,
    "mae_model": 48.2,
    "n_drafted": 120,
    "spearman_model_drafted": 0.5,
    "spearman_naive_drafted": 0.45,
    "spearman_adp_drafted": 0.52,
    "per_position": {"RB": {"n": 40, "spearman_model": 0.6}},
}

VORP_HEATMAP = {
    "rows": [f"R{i}" for i in range(1, 16)],
    "cols": ["QB", "RB", "WR", "TE"],
    "values": [[None, 10.0, 5.0, None]] + [[None] * 4] * 14,
    "note": "test vorp",
}
HIT_HEATMAP = {
    "rows": [f"R{i}" for i in range(1, 16)],
    "cols": ["QB", "RB", "WR", "TE"],
    "values": [[None, 0.5, 0.25, None]] + [[None] * 4] * 14,
    "note": "test hits",
}


def test_dashboard_not_ready(client, monkeypatch):
    from draftengine.jobs import refresh
    from draftengine.pipeline import history, registry

    monkeypatch.setattr(registry, "list_versions", lambda: [])
    monkeypatch.setattr(registry, "active_version", lambda: None)
    monkeypatch.setattr(registry, "load_model", lambda version=None: None)
    monkeypatch.setattr(history, "build_heatmaps", lambda settings: (None, None))
    monkeypatch.setattr(refresh, "last_refresh", lambda: None)

    resp = client.get("/api/dashboard")
    assert resp.status_code == 200
    body = resp.json()
    assert body["data_ready"] is False
    assert body["validation"] == []
    assert body["model_version"] is None
    assert body["last_refresh"] is None
    assert body["adp_available"] is False
    assert body["vorp_heatmap"] is None
    assert body["hit_rate_heatmap"] is None
    assert body["settings_summary"] == "12-team PPR snake, pick 5"


def test_dashboard_ready(client, monkeypatch):
    from draftengine.jobs import refresh
    from draftengine.pipeline import dataset, history, registry

    # Real features file in the isolated data dir + a stub active model.
    pd.DataFrame({"a": [1]}).to_parquet(dataset.features_path(), index=False)
    versions = [
        {
            "version": "v1",
            "created_at": "2026-07-01T00:00:00+00:00",
            "note": "",
            "metrics": [METRIC],
            "active": True,
        },
        {
            "version": "v0",
            "created_at": "2026-06-01T00:00:00+00:00",
            "note": "",
            "metrics": [],
            "active": False,
        },
    ]
    monkeypatch.setattr(registry, "list_versions", lambda: versions)
    monkeypatch.setattr(registry, "active_version", lambda: "v1")
    monkeypatch.setattr(registry, "load_model", lambda version=None: object())
    monkeypatch.setattr(
        history, "build_heatmaps", lambda settings: (VORP_HEATMAP, HIT_HEATMAP)
    )
    monkeypatch.setattr(
        refresh,
        "last_refresh",
        lambda: {"finished_at": "2026-07-28T06:00:00+00:00", "version": "v1", "adp_errors": {}},
    )

    body = client.get("/api/dashboard").json()
    assert body["data_ready"] is True
    assert body["model_version"] == "v1"
    # Validation comes from the ACTIVE version's metrics, not the newest.
    assert len(body["validation"]) == 1
    assert body["validation"][0]["season"] == 2024
    assert body["validation"][0]["spearman_model"] == 0.61
    assert body["validation"][0]["per_position"]["RB"]["n"] == 40
    assert body["last_refresh"]["version"] == "v1"
    assert body["adp_available"] is True
    assert body["vorp_heatmap"]["values"][0][1] == 10.0
    assert body["hit_rate_heatmap"]["note"] == "test hits"


# ---------- pipeline/history.py ----------


def _write_history_fixtures() -> None:
    """One season (2020) of synthetic RB data with a cached FFC ADP file."""
    from draftengine.data import ffc
    from draftengine.pipeline import dataset

    stats = pd.DataFrame(
        [
            {"season": 2020, "position": "RB", "norm_name": "alpha back", "ppr_points": 300.0},
            {"season": 2020, "position": "RB", "norm_name": "beta back", "ppr_points": 100.0},
            {"season": 2020, "position": "RB", "norm_name": "gamma back", "ppr_points": 50.0},
        ]
    )
    stats.to_parquet(dataset.season_stats_path(), index=False)

    players = [
        {"player_id": 1, "name": "Alpha Back", "position": "RB", "adp": 1.0},
        {"player_id": 2, "name": "Beta Back", "position": "RB", "adp": 13.0},
        {"player_id": 3, "name": "Delta Back", "position": "RB", "adp": 14.0},  # never played
        {"player_id": 4, "name": "Gamma Back", "position": "RB", "adp": 200.0},  # round cap
    ]
    path = ffc.adp_path(2020)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"players": players}))


def test_build_heatmaps_hand_verified_cells():
    from draftengine.league import LeagueSettings
    from draftengine.pipeline import history

    _write_history_fixtures()
    vorp, hit = history.build_heatmaps(LeagueSettings())

    assert vorp is not None and hit is not None
    assert vorp["rows"] == [f"R{i}" for i in range(1, 16)]
    assert vorp["cols"] == ["QB", "RB", "WR", "TE"]
    rb = vorp["cols"].index("RB")

    # Replacement RB level for 2020: counts say RB28, only 3 RBs exist, so the
    # pool caps at the worst starter = 50 points.
    # R1: Alpha (adp 1 -> ceil(1/12)=1): 300 - 50 = 250.
    assert vorp["values"][0][rb] == 250.0
    # R2: Beta 100-50=+50 and Delta (no season row -> 0 pts) 0-50=-50 -> mean 0.
    assert vorp["values"][1][rb] == 0.0
    # Gamma adp 200 -> round 17 capped to R15: 50-50 = 0.
    assert vorp["values"][14][rb] == 0.0
    # No RB drafted in round 3; no QBs at all.
    assert vorp["values"][2][rb] is None
    assert all(row[0] is None for row in vorp["values"])

    # Hit rate = share of picks finishing above replacement.
    assert hit["values"][0][rb] == 1.0
    assert hit["values"][1][rb] == 0.5
    assert hit["values"][14][rb] == 0.0
    assert vorp["note"] and hit["note"]


def test_build_heatmaps_none_without_adp():
    from draftengine.league import LeagueSettings
    from draftengine.pipeline import history

    assert history.build_heatmaps(LeagueSettings()) == (None, None)


def test_build_heatmaps_cached_per_settings():
    from draftengine.league import LeagueSettings
    from draftengine.pipeline import history

    _write_history_fixtures()
    first = history.build_heatmaps(LeagueSettings())
    assert first == history.build_heatmaps(LeagueSettings())  # cache hit, same object
    assert first[0] is history.build_heatmaps(LeagueSettings())[0]
    # Different league shape -> different replacement math -> rebuilt.
    ten_team = LeagueSettings(teams=10)
    other = history.build_heatmaps(ten_team)
    assert other[0] is not first[0]
