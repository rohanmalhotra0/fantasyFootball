"""Tests for draftengine.pipeline.simulate — historical draft replay.

Synthetic world: 100 players x 3 target seasons with KNOWN actuals
(actual = 0.9 * lag1 points + small deterministic wiggle), written as a
features parquet into the isolated data dir. ADP is monkeypatched onto
draftengine.data.ffc.load_adp — no network, no real data/ directory.
"""

import numpy as np
import pandas as pd
import pytest

from draftengine.api.schemas import SimulationResponse
from draftengine.data import ffc
from draftengine.league import LeagueSettings, RosterSlots
from draftengine.names import normalize_name
from draftengine.pipeline import simulate
from draftengine.pipeline.dataset import FEATURE_COLUMNS, features_path
from draftengine.pipeline.simulate import simulate_draft

SEASONS = [2021, 2022, 2023]
SIM_YEAR = 2023
N_PLAYERS = 100
# per 10 players: 3 RB, 4 WR, 1 QB, 2 TE
POS_PATTERN = ["RB", "WR", "QB", "WR", "RB", "TE", "WR", "RB", "WR", "TE"]

TEAMS = 8
SLOT = 3


def make_settings() -> LeagueSettings:
    # 9 starters (QB RB RB WR WR TE FLEX K DST) + 2 bench = 11 rounds,
    # 8 teams -> 88 picks, comfortably inside the synthetic pool.
    return LeagueSettings(teams=TEAMS, roster=RosterSlots(bench=2))


ROUNDS = make_settings().roster.total  # 11


def player(i: int) -> tuple[str, str, float]:
    """(name, position, lag1 points). Quality strictly decreasing in i."""
    return f"Player {i:02d}", POS_PATTERN[i % 10], 380.0 - 3.0 * i


def actual_points(i: int) -> float:
    _, _, lag1 = player(i)
    return 0.9 * lag1 + (5.0 if i % 7 == 0 else 0.0)


def write_features() -> None:
    rows = []
    for season in SEASONS:
        for i in range(N_PLAYERS):
            name, pos, lag1 = player(i)
            row = dict.fromkeys(FEATURE_COLUMNS, 0.0)
            row.update(
                player_id=f"p{i}",
                name=name,
                norm_name=normalize_name(name),
                position=pos,
                team="FA",
                target_season=season,
                lag1_ppr_points=lag1,
                lag1_ppg=lag1 / 17.0,
                lag1_games=17.0,
                lag2_ppr_points=lag1 * 0.9,
                has_lag2=1,
                experience=3,
                ppr_points_target=actual_points(i),
            )
            for p in ("QB", "RB", "WR", "TE"):
                row[f"pos_{p}"] = int(p == pos)
            rows.append(row)
    pd.DataFrame(rows).to_parquet(features_path(), index=False)


def _finish_adp(rows: list[dict]) -> pd.DataFrame:
    df = pd.DataFrame(rows)
    df["norm_name"] = df["name"].map(normalize_name)
    df = df.sort_values("adp").reset_index(drop=True)
    df["adp_rank"] = df.index + 1
    return df


def default_adp() -> pd.DataFrame:
    """ADP #1 is a rookie the model has never seen; then the top 60 pool
    players in quality order; K/DST exist ONLY here (never in features)."""
    rows = [{"name": "Rookie Star", "position": "RB", "adp": 1.0}]
    for i in range(60):
        name, pos, _ = player(i)
        rows.append({"name": name, "position": pos, "adp": 2.0 + i})
    for j in range(10):
        rows.append({"name": f"Kicker {j:02d}", "position": "K", "adp": 85.0 + j})
    for j in range(10):
        rows.append({"name": f"Defense {j:02d}", "position": "DST", "adp": 95.0 + j})
    return _finish_adp(rows)


def qb_heavy_adp() -> pd.DataFrame:
    """All 20 QBs (10 pool + 10 rookies) own the top of the board."""
    rows = []
    adp = 1.0
    for i in range(N_PLAYERS):
        name, pos, _ = player(i)
        if pos == "QB":
            rows.append({"name": name, "position": "QB", "adp": adp})
            adp += 1
    for j in range(10):
        rows.append({"name": f"Rookie QB {j:02d}", "position": "QB", "adp": adp})
        adp += 1
    for i in range(N_PLAYERS):
        name, pos, _ = player(i)
        if pos != "QB":
            rows.append({"name": name, "position": pos, "adp": adp})
            adp += 1
    for j in range(10):
        rows.append({"name": f"Kicker {j:02d}", "position": "K", "adp": adp})
        adp += 1
    for j in range(10):
        rows.append({"name": f"Defense {j:02d}", "position": "DST", "adp": adp})
        adp += 1
    return _finish_adp(rows)


def run_sim(monkeypatch, adp_frame, slot=SLOT, year=SIM_YEAR, settings=None) -> dict:
    write_features()
    monkeypatch.setattr(ffc, "load_adp", lambda year, teams=12, scoring="ppr": adp_frame)
    return simulate_draft(year, slot, settings or make_settings())


def my_snake_overalls(slot: int) -> list[int]:
    return [
        (r - 1) * TEAMS + (slot if r % 2 == 1 else TEAMS + 1 - slot)
        for r in range(1, ROUNDS + 1)
    ]


# ---------- shape + my snake slots ----------


class TestMyPicks:
    def test_my_picks_land_on_my_snake_slots(self, monkeypatch):
        result = run_sim(monkeypatch, default_adp())
        mine = [p for p in result["log"] if p["is_me"]]
        assert [p["overall"] for p in mine] == my_snake_overalls(SLOT)
        assert all(p["team_index"] == SLOT for p in mine)
        assert result["my_roster"] == mine
        assert len(mine) == ROUNDS

    def test_response_matches_schema(self, monkeypatch):
        result = run_sim(monkeypatch, default_adp())
        parsed = SimulationResponse.model_validate(result)
        assert parsed.season == SIM_YEAR
        assert parsed.slot == SLOT
        assert parsed.opponent_strategy == "adp"
        assert len(parsed.log) == TEAMS * ROUNDS
        assert len(parsed.league_totals) == TEAMS


# ---------- opponents: ADP order + constraints ----------


class TestOpponents:
    def test_first_opponent_pick_is_best_adp_even_if_unmodeled(self, monkeypatch):
        result = run_sim(monkeypatch, default_adp())
        first = result["log"][0]
        assert first["is_me"] is False
        assert first["team_index"] == 1
        # ADP #1 is a rookie unknown to the model: still draftable, actual 0.
        assert first["name"] == "Rookie Star"
        assert first["points"] == 0.0

    def test_round_one_opponents_walk_the_adp_board(self, monkeypatch):
        adp = default_adp()
        result = run_sim(monkeypatch, adp)
        adp_names = adp.sort_values("adp")["name"].tolist()
        taken: set[str] = set()
        for pick in [p for p in result["log"] if p["round"] == 1]:
            if not pick["is_me"]:
                expected = next(n for n in adp_names if n not in taken)
                assert pick["name"] == expected
            taken.add(pick["name"])

    def test_no_second_qb_before_round_10_for_opponents(self, monkeypatch):
        result = run_sim(monkeypatch, qb_heavy_adp())
        early_qbs: dict[int, int] = {}
        for p in result["log"]:
            if not p["is_me"] and p["position"] == "QB" and p["round"] <= 9:
                early_qbs[p["team_index"]] = early_qbs.get(p["team_index"], 0) + 1
        assert early_qbs, "QB-heavy ADP should make opponents draft QBs"
        assert all(n <= 1 for n in early_qbs.values()), early_qbs

    def test_naive_fallback_when_no_adp(self, monkeypatch):
        result = run_sim(monkeypatch, None)
        assert result["opponent_strategy"] == "naive last-season points (no ADP cached)"
        # First opponent takes the best last-season scorer.
        first = result["log"][0]
        assert first["is_me"] is False
        assert first["name"] == "Player 00"
        # No ADP -> no K/DST in the pool at all; draft still completes.
        assert all(p["position"] in {"QB", "RB", "WR", "TE"} for p in result["log"])
        assert len(result["log"]) == TEAMS * ROUNDS
        assert len(result["my_roster"]) == ROUNDS


# ---------- K/DST timing ----------


class TestKickersAndDefenses:
    def test_kdst_only_in_last_three_rounds(self, monkeypatch):
        result = run_sim(monkeypatch, default_adp())
        kdst = [p for p in result["log"] if p["position"] in ("K", "DST")]
        assert kdst, "the ADP pool has K/DST — someone must draft them"
        assert all(p["round"] > ROUNDS - 3 for p in kdst)

    def test_my_roster_fills_k_and_dst(self, monkeypatch):
        result = run_sim(monkeypatch, default_adp())
        my_pos = [p["position"] for p in result["my_roster"]]
        assert my_pos.count("K") == 1
        assert my_pos.count("DST") == 1


# ---------- determinism ----------


def test_two_runs_are_identical(monkeypatch):
    a = run_sim(monkeypatch, default_adp())
    b = run_sim(monkeypatch, default_adp())
    assert a == b


# ---------- outcome math ----------


def ref_lineup_total(picks: list[dict], roster: RosterSlots) -> float:
    """Independent greedy starters-only scorer used to cross-check totals."""
    pool: dict[str, list[float]] = {}
    for p in picks:
        pool.setdefault(p["position"], []).append(p["points"])
    for v in pool.values():
        v.sort(reverse=True)
    total = 0.0
    for pos, n in (("QB", roster.qb), ("RB", roster.rb), ("WR", roster.wr), ("TE", roster.te)):
        for _ in range(min(n, len(pool.get(pos, [])))):
            total += pool[pos].pop(0)
    for eligible, n in (
        (("RB", "WR", "TE"), roster.flex),
        (("QB", "RB", "WR", "TE"), roster.superflex),
    ):
        for _ in range(n):
            cands = [(pool[p][0], p) for p in eligible if pool.get(p)]
            if not cands:
                break
            _, best = max(cands)
            total += pool[best].pop(0)
    for pos, n in (("K", roster.k), ("DST", roster.dst)):
        for _ in range(min(n, len(pool.get(pos, [])))):
            total += pool[pos].pop(0)
    return total


class TestOutcome:
    def test_league_totals_and_median(self, monkeypatch):
        settings = make_settings()
        result = run_sim(monkeypatch, default_adp(), settings=settings)
        totals = result["league_totals"]
        assert len(totals) == TEAMS
        assert result["my_total"] == totals[SLOT - 1]
        assert result["league_median"] == pytest.approx(float(np.median(totals)))
        # Every team's total matches an independent lineup computation.
        for team in range(1, TEAMS + 1):
            picks = [p for p in result["log"] if p["team_index"] == team]
            assert totals[team - 1] == pytest.approx(ref_lineup_total(picks, settings.roster))

    def test_points_are_known_actuals(self, monkeypatch):
        result = run_sim(monkeypatch, default_adp())
        expected = {player(i)[0]: actual_points(i) for i in range(N_PLAYERS)}
        for p in result["log"]:
            if p["name"] in expected:
                assert p["points"] == pytest.approx(expected[p["name"]])
            else:  # ADP-only players never played that season -> 0
                assert p["points"] == 0.0


class TestLineupTotal:
    def test_hand_verified_tiny_case(self):
        roster = RosterSlots()  # 1QB 2RB 2WR 1TE 1FLEX 1K 1DST
        players = [
            ("QB", 300.0),
            ("RB", 200.0),
            ("RB", 180.0),
            ("RB", 150.0),
            ("WR", 170.0),
            ("WR", 160.0),
            ("WR", 90.0),
            ("TE", 120.0),
            ("K", 7.0),
            ("DST", 5.0),
        ]
        # 300 + (200+180) + (170+160) + 120 + FLEX best leftover 150 + 7 + 5
        assert simulate._lineup_total(players, roster) == pytest.approx(1292.0)

    def test_superflex_takes_best_leftover_qb(self):
        roster = RosterSlots(qb=1, rb=1, wr=1, te=1, flex=1, superflex=1, k=0, dst=0)
        players = [
            ("QB", 300.0),
            ("QB", 250.0),
            ("RB", 200.0),
            ("RB", 150.0),
            ("WR", 180.0),
            ("WR", 90.0),
            ("TE", 100.0),
        ]
        # 300 + 200 + 180 + 100 + FLEX 150 + SFLEX 250
        assert simulate._lineup_total(players, roster) == pytest.approx(1180.0)

    def test_short_roster_scores_what_it_has(self):
        roster = RosterSlots()
        assert simulate._lineup_total([("RB", 100.0)], roster) == pytest.approx(100.0)
        assert simulate._lineup_total([], roster) == 0.0


# ---------- error paths ----------


class TestErrors:
    def test_missing_features_raises_no_data(self):
        with pytest.raises(ValueError, match="no data for year"):
            simulate_draft(SIM_YEAR, 1, make_settings())

    def test_year_without_training_data_raises(self, monkeypatch):
        write_features()
        monkeypatch.setattr(ffc, "load_adp", lambda *a, **kw: None)
        with pytest.raises(ValueError, match="no data for year"):
            simulate_draft(SEASONS[0], 1, make_settings())  # nothing earlier to train on

    def test_unknown_year_raises(self, monkeypatch):
        write_features()
        monkeypatch.setattr(ffc, "load_adp", lambda *a, **kw: None)
        with pytest.raises(ValueError, match="no data for year"):
            simulate_draft(2030, 1, make_settings())

    def test_slot_out_of_range_raises(self, monkeypatch):
        write_features()
        monkeypatch.setattr(ffc, "load_adp", lambda *a, **kw: None)
        for bad in (0, TEAMS + 1):
            with pytest.raises(ValueError, match="slot"):
                simulate_draft(SIM_YEAR, bad, make_settings())
