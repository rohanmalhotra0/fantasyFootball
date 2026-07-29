"""/api/analysis/* routes with the analysis layer monkeypatched."""

AGING = {
    "positions": [
        {
            "position": "RB",
            "peak_experience": 1,
            "buckets": [
                {
                    "experience": 0,
                    "label": "0",
                    "n": 2,
                    "mean_points": 150.0,
                    "median_points": 150.0,
                    "mean_ppg": 9.38,
                    "median_ppg": 9.38,
                    "ratio_vs_peak": 0.75,
                },
                {
                    "experience": 12,
                    "label": "12+",
                    "n": 1,
                    "mean_points": 120.0,
                    "median_points": 120.0,
                    "mean_ppg": 7.5,
                    "median_ppg": 7.5,
                    "ratio_vs_peak": 0.6,
                },
            ],
        }
    ],
    "min_games": 8,
    "left_censored_first_season": 2015,
    "note": "test note",
}

CONSISTENCY = {
    "season": 2024,
    "min_games": 6,
    "boom_threshold": 20.0,
    "bust_threshold": 5.0,
    "players": [
        {
            "player_id": "x",
            "name": "X Player",
            "position": "WR",
            "team": None,
            "games": 6,
            "total_points": 60.0,
            "ppg": 10.0,
            "stdev": 8.22,
            "cv": 0.822,
            "boom_rate": 0.167,
            "bust_rate": 0.333,
            "floor": 4.75,
            "ceiling": 10.0,
        }
    ],
}

TRENDS = {
    "seasons": [
        {
            "season": 2020,
            "total_points": 400.0,
            "positions": {
                "QB": {
                    "total_points": 300.0,
                    "share": 0.75,
                    "top12_avg": 300.0,
                    "replacement_points": 300.0,
                }
            },
            "pass_share": 0.4167,
            "rush_share": 0.3596,
            "receiving_share": 0.2237,
        }
    ],
    "replacement_cutoffs": {"QB": 13, "RB": 28, "WR": 34, "TE": 13},
    "note": "test note",
}


def test_aging_route(client, monkeypatch):
    from draftengine.pipeline import analysis

    monkeypatch.setattr(analysis, "aging_curves", lambda: AGING)
    body = client.get("/api/analysis/aging").json()
    assert body["positions"][0]["position"] == "RB"
    assert body["positions"][0]["buckets"][1]["label"] == "12+"
    assert body["positions"][0]["buckets"][0]["ratio_vs_peak"] == 0.75
    assert body["left_censored_first_season"] == 2015


def test_aging_route_404_without_data(client, monkeypatch):
    from draftengine.pipeline import analysis

    monkeypatch.setattr(analysis, "aging_curves", lambda: None)
    resp = client.get("/api/analysis/aging")
    assert resp.status_code == 404
    assert "refresh" in resp.json()["detail"]


def test_consistency_route(client, monkeypatch):
    from draftengine.pipeline import analysis

    seen: list[int] = []

    def fake(season: int):
        seen.append(season)
        return CONSISTENCY

    monkeypatch.setattr(analysis, "consistency", fake)
    body = client.get("/api/analysis/consistency/2024").json()
    assert seen == [2024]
    assert body["season"] == 2024
    player = body["players"][0]
    assert player["cv"] == 0.822
    assert player["team"] is None
    assert player["boom_rate"] == 0.167


def test_consistency_route_404_when_year_not_cached(client, monkeypatch):
    from draftengine.pipeline import analysis

    monkeypatch.setattr(analysis, "consistency", lambda season: None)
    resp = client.get("/api/analysis/consistency/1999")
    assert resp.status_code == 404
    assert "1999" in resp.json()["detail"]
    assert "not cached" in resp.json()["detail"]


def test_trends_route(client, monkeypatch):
    from draftengine.pipeline import analysis

    monkeypatch.setattr(analysis, "position_trends", lambda: TRENDS)
    body = client.get("/api/analysis/trends").json()
    assert body["seasons"][0]["positions"]["QB"]["share"] == 0.75
    assert body["seasons"][0]["pass_share"] == 0.4167
    assert body["replacement_cutoffs"]["WR"] == 34


def test_trends_route_404_without_data(client, monkeypatch):
    from draftengine.pipeline import analysis

    monkeypatch.setattr(analysis, "position_trends", lambda: None)
    assert client.get("/api/analysis/trends").status_code == 404
