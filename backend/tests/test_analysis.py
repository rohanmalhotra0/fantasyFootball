"""pipeline/analysis.py on synthetic frames — every number hand-checked."""

import pandas as pd
import pytest

from draftengine.pipeline import analysis

# ---------- aging ----------


def _season_row(pid: str, season: int, pos: str, games: int, points: float, first: int) -> dict:
    return {
        "player_id": pid,
        "season": season,
        "position": pos,
        "games": games,
        "ppr_points": points,
        "ppg": points / games,
        "first_season": first,
        # stat columns the trends math reads; zero unless a test sets them
        "passing_yards": 0.0,
        "passing_tds": 0.0,
        "interceptions": 0.0,
        "rushing_yards": 0.0,
        "rushing_tds": 0.0,
        "receptions": 0.0,
        "receiving_yards": 0.0,
        "receiving_tds": 0.0,
    }


def _aging_frame() -> pd.DataFrame:
    return pd.DataFrame(
        [
            # First covered season is 2015 -> this player is left-censored
            # (their real debut may be 2005) and must be excluded entirely.
            _season_row("cen", 2015, "RB", 16, 400.0, 2015),
            _season_row("cen", 2016, "RB", 16, 380.0, 2015),
            # a: debut 2016, seasons at experience 0 and 1.
            _season_row("a", 2016, "RB", 16, 200.0, 2016),
            _season_row("a", 2017, "RB", 16, 250.0, 2016),
            # b: same debut; the 4-game 2018 season is dropped (games < 8).
            _season_row("b", 2016, "RB", 16, 100.0, 2016),
            _season_row("b", 2017, "RB", 10, 150.0, 2016),
            _season_row("b", 2018, "RB", 4, 90.0, 2016),
            # v: 14 years in -> capped into the 12+ bucket.
            _season_row("v", 2030, "RB", 16, 120.0, 2016),
        ]
    )


def test_aging_hand_checked_rb_buckets():
    out = analysis.compute_aging_curves(_aging_frame())

    assert out["min_games"] == 8
    assert out["left_censored_first_season"] == 2015
    assert "2015" in out["note"]

    assert [p["position"] for p in out["positions"]] == ["RB"]  # empty positions skipped
    rb = out["positions"][0]
    buckets = {b["experience"]: b for b in rb["buckets"]}
    assert sorted(buckets) == [0, 1, 12]
    # censored player contributes nowhere; b's 4-game season is dropped.
    assert sum(b["n"] for b in rb["buckets"]) == 5

    # exp 0: a=200, b=100 -> mean 150, median 150; ppg (12.5 + 6.25) / 2.
    assert buckets[0]["n"] == 2
    assert buckets[0]["mean_points"] == 150.0
    assert buckets[0]["median_points"] == 150.0
    assert buckets[0]["mean_ppg"] == pytest.approx(9.38)
    # exp 1: a=250, b=150 -> mean 200 = the peak bucket.
    assert buckets[1]["mean_points"] == 200.0
    assert rb["peak_experience"] == 1
    assert buckets[1]["ratio_vs_peak"] == 1.0
    assert buckets[0]["ratio_vs_peak"] == pytest.approx(0.75)  # 150 / 200
    # 14 years of experience caps into the 12+ bucket.
    assert buckets[12]["label"] == "12+"
    assert buckets[12]["n"] == 1
    assert buckets[12]["ratio_vs_peak"] == pytest.approx(0.6)  # 120 / 200


# ---------- consistency ----------


def _weekly_row(pid: str, name: str, pos: str, season: int, week: int, points: float) -> dict:
    return {
        "player_id": pid,
        "player_display_name": name,
        "position": pos,
        "recent_team": "KC",
        "season": season,
        "week": week,
        "fantasy_points_ppr": points,
    }


def _weekly_frame() -> pd.DataFrame:
    x_weeks = [25.0, 3.0, 10.0, 10.0, 10.0, 2.0]
    rows = [_weekly_row("x", "X Player", "WR", 2024, w + 1, p) for w, p in enumerate(x_weeks)]
    rows += [_weekly_row("z", "Z Player", "RB", 2024, w, 20.0) for w in range(1, 7)]
    # y: only 5 games -> excluded.
    rows += [_weekly_row("y", "Y Player", "TE", 2024, w, 30.0) for w in range(1, 6)]
    # Another season sneaking into the frame must be ignored.
    rows += [_weekly_row("x", "X Player", "WR", 2023, w, 99.0) for w in range(1, 7)]
    return pd.DataFrame(rows)


def test_consistency_hand_checked_profile():
    out = analysis.compute_consistency(_weekly_frame(), 2024)

    assert out["season"] == 2024
    assert out["boom_threshold"] == 20.0 and out["bust_threshold"] == 5.0
    # y is under 6 games; x's 2023 rows are out of season. Sorted by ppg.
    assert [p["player_id"] for p in out["players"]] == ["z", "x"]

    x = out["players"][1]
    # weeks [25, 3, 10, 10, 10, 2]: mean 10; sample stdev sqrt(338/5).
    assert x["games"] == 6
    assert x["total_points"] == 60.0
    assert x["ppg"] == 10.0
    assert x["stdev"] == pytest.approx(8.22)
    assert x["cv"] == pytest.approx(0.822)
    assert x["boom_rate"] == pytest.approx(0.167)  # one 25-point week
    assert x["bust_rate"] == pytest.approx(0.333)  # the 3- and 2-point weeks
    assert x["floor"] == pytest.approx(4.75)  # 25th pct of [2,3,10,10,10,25]
    assert x["ceiling"] == 10.0
    assert x["team"] == "KC"

    z = out["players"][0]  # six identical 20-point weeks
    assert z["ppg"] == 20.0
    assert z["stdev"] == 0.0
    assert z["cv"] == 0.0
    assert z["boom_rate"] == 1.0  # 20 >= boom threshold
    assert z["bust_rate"] == 0.0


def test_consistency_cv_none_for_nonpositive_mean():
    rows = [_weekly_row("q", "Q Player", "QB", 2024, w, -2.0) for w in range(1, 7)]
    out = analysis.compute_consistency(pd.DataFrame(rows), 2024)
    assert out["players"][0]["cv"] is None
    assert out["players"][0]["ppg"] == -2.0


# ---------- trends ----------


def _trends_frame() -> pd.DataFrame:
    qb = _season_row("qb1", 2020, "QB", 16, 300.0, 2016)
    qb.update(
        passing_yards=3000.0,
        passing_tds=20.0,
        interceptions=5.0,
        rushing_yards=100.0,
        rushing_tds=1.0,
    )
    rb = _season_row("rb1", 2020, "RB", 16, 100.0, 2016)
    rb.update(
        rushing_yards=1000.0,
        rushing_tds=8.0,
        receptions=50.0,
        receiving_yards=400.0,
        receiving_tds=2.0,
    )
    # 2021: fourteen TEs at 140, 130, ..., 10 points to pin down the
    # top-12 average and the TE13 replacement cutoff. No stat columns ->
    # the pass/rush/receiving split degrades to 0 instead of NaN.
    tes = [_season_row(f"te{i}", 2021, "TE", 16, 140.0 - 10 * i, 2016) for i in range(14)]
    return pd.DataFrame([qb, rb, *tes])


def test_trends_hand_checked_shares_and_cutoffs():
    out = analysis.compute_position_trends(_trends_frame())

    assert out["replacement_cutoffs"] == {"QB": 13, "RB": 28, "WR": 34, "TE": 13}
    assert [s["season"] for s in out["seasons"]] == [2020, 2021]

    s2020 = out["seasons"][0]
    assert s2020["total_points"] == 400.0
    assert s2020["positions"]["QB"]["share"] == pytest.approx(0.75)  # 300 / 400
    assert s2020["positions"]["RB"]["share"] == pytest.approx(0.25)
    # Only one QB: top-12 average and the (capped) replacement are that player.
    assert s2020["positions"]["QB"]["top12_avg"] == 300.0
    assert s2020["positions"]["QB"]["replacement_points"] == 300.0
    assert "WR" not in s2020["positions"]
    # pass = 3000*.04 + 20*4 - 5*2 = 190; rush = (100+1000)*.1 + 9*6 = 164;
    # recv = 50 + 400*.1 + 2*6 = 102; total components = 456.
    assert s2020["pass_share"] == pytest.approx(190 / 456, abs=1e-4)
    assert s2020["rush_share"] == pytest.approx(164 / 456, abs=1e-4)
    assert s2020["receiving_share"] == pytest.approx(102 / 456, abs=1e-4)

    s2021 = out["seasons"][1]
    te = s2021["positions"]["TE"]
    assert te["share"] == 1.0
    assert te["top12_avg"] == pytest.approx(85.0)  # mean of 140..30
    assert te["replacement_points"] == 20.0  # the 13th of fourteen TEs
    assert s2021["pass_share"] == 0.0  # zero components, not NaN


# ---------- cached loaders ----------


def test_loaders_none_without_files():
    # conftest gives every test an empty DATA_DIR.
    assert analysis.aging_curves() is None
    assert analysis.position_trends() is None
    assert analysis.consistency(2024) is None


def test_aging_loader_reads_parquet_and_caches():
    from draftengine.pipeline import dataset

    _aging_frame().to_parquet(dataset.season_stats_path(), index=False)
    first = analysis.aging_curves()
    assert first is not None
    assert first["positions"][0]["position"] == "RB"
    assert analysis.aging_curves() is first  # same mtime -> cache hit


def test_consistency_loader_uses_cached_file_only(monkeypatch):
    from draftengine.data import nflverse

    calls: list[list[int]] = []

    def fake_load_weekly(years):
        calls.append(years)
        return _weekly_frame()

    monkeypatch.setattr(nflverse, "load_weekly", fake_load_weekly)
    assert analysis.consistency(2024) is None  # no cached file -> no network attempt
    assert calls == []

    path = nflverse.stats_path(2024)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("stub")
    out = analysis.consistency(2024)
    assert out is not None
    assert calls == [[2024]]
    assert [p["player_id"] for p in out["players"]] == ["z", "x"]
    assert analysis.consistency(2024) is out  # cache hit, no re-load
    assert calls == [[2024]]
