"""Rankings API: sort contract, pins/bans/manual ranks, NaN sanitization."""

import pandas as pd
import pytest

from draftengine.config import CURRENT_SEASON

NAN = float("nan")


def _board_frame() -> pd.DataFrame:
    common = {"adp_stdev": NAN, "experience": 3, "lag1_games": 17, "lag1_ppr_points": 200.0}
    return pd.DataFrame(
        [
            {
                "player_id": "p1",
                "name": "Alpha Back",
                "position": "RB",
                "team": "AAA",
                "projected_points": 300.0,
                "vorp": 150.0,
                "model_rank": 1,
                "adp": 3.0,
                "adp_rank": 3,
                "value_gap": 2,
                "tier": 1,
                "risk_flag": False,
                **common,
            },
            {
                "player_id": "p2",
                "name": "Beta Wide",
                "position": "WR",
                "team": "BBB",
                "projected_points": 280.0,
                "vorp": 120.0,
                "model_rank": 2,
                "adp": 1.0,
                "adp_rank": 1,
                "value_gap": -1,
                "tier": 1,
                "risk_flag": True,
                **common,
            },
            {
                "player_id": "p3",
                "name": "Gamma Quarterback",
                "position": "QB",
                "team": "CCC",
                "projected_points": 260.0,
                "vorp": 90.0,
                "model_rank": 3,
                "adp": NAN,
                "adp_rank": NAN,
                "value_gap": NAN,
                "tier": 2,
                "risk_flag": False,
                **common,
            },
            {
                # ADP-only rookie: no projection, appended after modeled players.
                "player_id": "adp_rookie_star",
                "name": "Rookie Star",
                "position": "WR",
                "team": NAN,
                "projected_points": NAN,
                "vorp": NAN,
                "model_rank": NAN,
                "adp": 2.0,
                "adp_rank": 2,
                "value_gap": NAN,
                "tier": NAN,
                "risk_flag": NAN,
                **common,
            },
        ]
    )


@pytest.fixture()
def fake_board(monkeypatch):
    from draftengine.pipeline import projections, registry

    monkeypatch.setattr(projections, "build_board", lambda settings, season=None: _board_frame())
    monkeypatch.setattr(registry, "active_version", lambda: "v_test")


def _ids(body: dict) -> list[str]:
    return [p["player_id"] for p in body["players"]]


def test_rankings_sort_and_nan_sanitization(client, fake_board):
    resp = client.get("/api/rankings")
    assert resp.status_code == 200
    assert "NaN" not in resp.text  # invalid-JSON NaN literals never leak
    body = resp.json()

    assert _ids(body) == ["p1", "p2", "p3", "adp_rookie_star"]
    assert body["adp_available"] is True
    assert body["model_version"] == "v_test"
    assert body["season"] == CURRENT_SEASON

    p3 = body["players"][2]
    assert p3["adp"] is None
    assert p3["adp_rank"] is None
    assert p3["value_gap"] is None
    assert p3["unmodeled"] is False

    rookie = body["players"][3]
    assert rookie["unmodeled"] is True
    assert rookie["projected_points"] is None
    assert rookie["vorp"] is None
    assert rookie["model_rank"] is None
    assert rookie["tier"] is None
    assert rookie["team"] is None
    assert rookie["risk_flag"] is False
    assert rookie["adp_rank"] == 2


def test_pin_moves_player_first(client, fake_board):
    body = client.post("/api/rankings/edits", json={"player_id": "p3", "pinned": True}).json()
    assert _ids(body) == ["p3", "p1", "p2", "adp_rookie_star"]
    assert body["players"][0]["pinned"] is True

    body = client.post("/api/rankings/edits", json={"player_id": "p3", "pinned": False}).json()
    assert _ids(body) == ["p1", "p2", "p3", "adp_rookie_star"]


def test_ban_moves_player_last(client, fake_board):
    body = client.post("/api/rankings/edits", json={"player_id": "p1", "banned": True}).json()
    assert _ids(body) == ["p2", "p3", "adp_rookie_star", "p1"]
    assert body["players"][-1]["banned"] is True


def test_manual_rank_and_clear(client, fake_board):
    body = client.post("/api/rankings/edits", json={"player_id": "p3", "manual_rank": 1}).json()
    # Manual rank 1 beats model rank 1 on ties: user intent wins.
    assert _ids(body) == ["p3", "p1", "p2", "adp_rookie_star"]
    assert body["players"][0]["manual_rank"] == 1

    body = client.post(
        "/api/rankings/edits", json={"player_id": "p3", "clear_manual_rank": True}
    ).json()
    assert _ids(body) == ["p1", "p2", "p3", "adp_rookie_star"]
    assert body["players"][2]["manual_rank"] is None


def test_edits_persist_across_reads(client, fake_board):
    client.post("/api/rankings/edits", json={"player_id": "p2", "pinned": True})
    body = client.get("/api/rankings").json()
    assert _ids(body)[0] == "p2"
    assert body["players"][0]["pinned"] is True


def test_rankings_without_board(client, monkeypatch):
    from draftengine.pipeline import projections, registry

    monkeypatch.setattr(projections, "build_board", lambda settings, season=None: None)
    monkeypatch.setattr(registry, "active_version", lambda: None)
    body = client.get("/api/rankings").json()
    assert body == {
        "players": [],
        "adp_available": False,
        "model_version": None,
        "season": CURRENT_SEASON,
    }


def test_adp_available_false_when_no_adp_column_values(client, monkeypatch):
    from draftengine.pipeline import projections, registry

    frame = _board_frame()
    frame["adp"] = NAN
    frame["adp_rank"] = NAN
    frame = frame[frame["projected_points"].notna()]
    monkeypatch.setattr(projections, "build_board", lambda settings, season=None: frame)
    monkeypatch.setattr(registry, "active_version", lambda: "v_test")
    body = client.get("/api/rankings").json()
    assert body["adp_available"] is False
    assert all(p["adp"] is None for p in body["players"])
