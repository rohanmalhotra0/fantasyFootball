"""/api/players/* career + compare against a synthetic season_stats parquet."""

import numpy as np
import pandas as pd

from draftengine.config import data_dir


def _row(
    player_id: str,
    season: int,
    name: str,
    norm_name: str,
    position: str,
    games: float,
    ppr_points: float,
    ppg: float,
    receptions: float,
    targets: float,
    carries: float,
) -> dict:
    return {
        "player_id": player_id,
        "season": season,
        "name": name,
        "norm_name": norm_name,
        "position": position,
        # counting stats stored as floats on purpose: the routes must cast
        "games": games,
        "ppr_points": ppr_points,
        "ppg": ppg,
        "receptions": receptions,
        "targets": targets,
        "carries": carries,
    }


def _write_season_stats() -> None:
    rows = [
        # seasons intentionally out of order to prove ascending sort
        _row("00-0034796", 2023, "Josh Jacobs", "josh jacobs", "RB", 16.0, 250.46, 15.678, 53.0, 61.0, 233.0),
        _row("00-0034796", 2022, "Josh Jacobs", "josh jacobs", "RB", 17.0, 328.34, 19.314, 53.0, 64.0, 340.0),
        # NaN counting stat: must come back as 0, not NaN/500
        _row("00-0034796", 2024, "Josh Jacobs", "josh jacobs", "RB", 15.0, 240.0, 16.0, 40.0, np.nan, 301.0),
        # resolvable only via the board's synthetic adp_ id
        _row("00-0039918", 2024, "Ja'Marr Chase", "jamarr chase", "WR", 17.0, 403.0, 23.7, 127.0, 175.0, 3.0),
        # an old player with the same norm_name: adp_ resolution must prefer
        # the more recent career (the row above)
        _row("00-0000001", 1999, "Ja'Marr Chase", "jamarr chase", "WR", 10.0, 100.0, 10.0, 30.0, 50.0, 0.0),
    ]
    df = pd.DataFrame(rows)
    df.to_parquet(data_dir() / "season_stats.parquet")


def test_career_ordering_rounding_and_int_casts(client):
    _write_season_stats()
    resp = client.get("/api/players/00-0034796/career")
    assert resp.status_code == 200
    body = resp.json()
    assert body["player_id"] == "00-0034796"
    assert body["name"] == "Josh Jacobs"
    assert body["position"] == "RB"

    seasons = body["seasons"]
    assert [s["season"] for s in seasons] == [2022, 2023, 2024]

    s2023 = seasons[1]
    assert s2023["ppr_points"] == 250.5  # rounded to 1 decimal
    assert s2023["ppg"] == 15.7
    for field in ("games", "receptions", "targets", "carries"):
        assert isinstance(s2023[field], int), field
    assert s2023["games"] == 16
    assert s2023["receptions"] == 53
    assert s2023["carries"] == 233

    # NaN targets in 2024 must serialize as a plain 0
    assert seasons[2]["targets"] == 0


def test_career_resolves_adp_prefixed_board_id(client):
    _write_season_stats()
    resp = client.get("/api/players/adp_jamarr_chase/career")
    assert resp.status_code == 200
    body = resp.json()
    # echoes the id the board asked with, resolved to the real career
    assert body["player_id"] == "adp_jamarr_chase"
    assert body["name"] == "Ja'Marr Chase"
    assert body["position"] == "WR"
    # norm-name collision resolved to the most recent career, not the 1999 one
    assert [s["season"] for s in body["seasons"]] == [2024]
    assert body["seasons"][0]["receptions"] == 127


def test_career_unknown_id_404(client):
    _write_season_stats()
    resp = client.get("/api/players/00-9999999/career")
    assert resp.status_code == 404
    assert "00-9999999" in resp.json()["detail"]

    resp = client.get("/api/players/adp_nobody_home/career")
    assert resp.status_code == 404
    assert "adp_nobody_home" in resp.json()["detail"]


def test_career_404_without_dataset(client):
    resp = client.get("/api/players/00-0034796/career")
    assert resp.status_code == 404
    assert "refresh" in resp.json()["detail"]


def test_compare_both_resolvable(client):
    _write_season_stats()
    resp = client.get("/api/players/compare", params={"a": "00-0034796", "b": "adp_jamarr_chase"})
    assert resp.status_code == 200
    players = resp.json()["players"]
    assert len(players) == 2
    assert players[0]["player_id"] == "00-0034796"
    assert players[1]["player_id"] == "adp_jamarr_chase"
    assert players[1]["name"] == "Ja'Marr Chase"
    assert [s["season"] for s in players[0]["seasons"]] == [2022, 2023, 2024]


def test_compare_one_bad_404_names_the_bad_id(client):
    _write_season_stats()
    resp = client.get("/api/players/compare", params={"a": "00-0034796", "b": "adp_nobody_home"})
    assert resp.status_code == 404
    detail = resp.json()["detail"]
    assert "adp_nobody_home" in detail
    assert "00-0034796" not in detail
