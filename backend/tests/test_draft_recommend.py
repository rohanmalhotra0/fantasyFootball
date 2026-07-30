"""Recommendations (survival, need, pins/bans, K/DST gating) and grading."""

from itertools import pairwise

import pandas as pd
import pytest

from draftengine import db, league
from draftengine.draft import engine, grade, recommend
from draftengine.league import LeagueSettings, RosterSlots
from draftengine.names import normalize_name
from draftengine.orm import PlayerEdit

_POS_CYCLE = ["RB", "WR", "QB", "WR", "RB", "TE"]


def make_pool(n: int = 200) -> pd.DataFrame:
    rows = []
    for i in range(n):
        if i < 180:
            pos = _POS_CYCLE[i % 6]
        elif i < 190:
            pos = "K"
        else:
            pos = "DST"
        modeled = i < 180
        name = f"Alpha{i:03d} Beta{i:03d}"
        rows.append(
            {
                "player_id": f"p{i:03d}",
                "name": name,
                "norm_name": normalize_name(name),
                "position": pos,
                "team": "FA",
                "projected_points": (400.0 - i * 1.5) if modeled else float("nan"),
                "vorp": (250.0 - i * 1.4) if modeled else float("nan"),
                "model_rank": (i + 1) if modeled else None,
                "adp": float(i + 1),
                "adp_stdev": 4.0 + i * 0.05,
                "adp_rank": i + 1,
                "tier": ((i // 12) + 1) if modeled else None,
                "risk_flag": False,
            }
        )
    return pd.DataFrame(rows)


@pytest.fixture()
def pool() -> pd.DataFrame:
    return make_pool()


@pytest.fixture(autouse=True)
def setup(monkeypatch, pool):
    db.init_db()
    monkeypatch.setattr(engine, "get_player_pool", lambda settings: pool)


def use_pool(monkeypatch, frame: pd.DataFrame) -> None:
    monkeypatch.setattr(engine, "get_player_pool", lambda settings: frame)


def advance_until_my_turn(draft_id: int, fillers) -> dict:
    """Make filler picks for other teams until my slot is on the clock."""
    while True:
        state = engine.get_state(draft_id)
        if state["current_overall"] is None or state["on_clock_team"] == state["my_slot"]:
            return state
        engine.make_pick(draft_id, player_id=next(fillers))


def tail_fillers():
    """Low-value players so opponents never consume the interesting top."""
    return (f"p{i:03d}" for i in range(179, 50, -1))


# ---------- survival probability ----------


def test_survival_monotonic_in_adp():
    probs = [
        recommend.survival_probability(float(adp), 5.0, None, 30) for adp in range(1, 61)
    ]
    assert all(b >= a for a, b in pairwise(probs))
    assert probs[0] == 0.01  # long-gone player clamps low
    assert probs[-1] == 0.99  # far-future player clamps high
    # Player whose ADP equals the horizon is roughly a coin flip.
    mid = recommend.survival_probability(30.0, 5.0, None, 30)
    assert 0.4 < mid < 0.6


def test_survival_model_rank_fallback_and_none():
    p = recommend.survival_probability(None, None, 40.0, 30)
    assert p is not None and 0.5 < p < 0.99  # rank 40 likely survives to pick 30
    assert recommend.survival_probability(None, None, None, 30) is None


def test_survival_tiny_stdev_floored():
    # stdev is floored at 3.0 so a 0-stdev player never gets a hard 0/1.
    p = recommend.survival_probability(29.0, 0.0, None, 30)
    assert 0.01 <= p <= 0.99


# ---------- my_turn / picks_until ----------


def test_my_turn_flag_and_picks_until():
    draft_id = engine.create_draft()["id"]  # my_slot defaults to 5
    recs = recommend.build_recommendations(draft_id)
    assert recs["on_clock_team"] == 1
    assert recs["my_turn"] is False
    assert recs["picks_until_my_turn"] == 4

    fillers = tail_fillers()
    advance_until_my_turn(draft_id, fillers)
    recs = recommend.build_recommendations(draft_id)
    assert recs["on_clock_team"] == 5
    assert recs["my_turn"] is True
    assert recs["picks_until_my_turn"] == 0


# ---------- need bonus / reasons ----------


def test_need_reason_names_the_hole():
    draft_id = engine.create_draft()["id"]
    fillers = tail_fillers()
    advance_until_my_turn(draft_id, fillers)

    recs = recommend.build_recommendations(draft_id)["recommendations"]
    rb = next(r for r in recs if r["position"] == "RB")
    assert rb["reason"] == "Fills your RB1 hole"
    qb = next(r for r in recs if r["position"] == "QB")
    assert qb["reason"] == "Fills your QB hole"  # single QB slot: no index

    # Fill RB1 -> next RB fills RB2 -> then FLEX.
    engine.make_pick(draft_id, player_id="p000")  # RB
    advance_until_my_turn(draft_id, fillers)
    recs = recommend.build_recommendations(draft_id)["recommendations"]
    rb = next(r for r in recs if r["position"] == "RB")
    assert rb["reason"] == "Fills your RB2 hole"

    engine.make_pick(draft_id, player_id="p004")  # RB again
    advance_until_my_turn(draft_id, fillers)
    recs = recommend.build_recommendations(draft_id)["recommendations"]
    rb = next(r for r in recs if r["position"] == "RB")
    assert rb["reason"] == "Fills your FLEX hole"


# ---------- pinned / banned ----------


def test_pinned_first_banned_excluded():
    with db.session_scope() as session:
        session.add(PlayerEdit(player_id="p050", pinned=True))
        session.add(PlayerEdit(player_id="p000", banned=True))
    draft_id = engine.create_draft()["id"]
    recs = recommend.build_recommendations(draft_id)["recommendations"]
    assert recs[0]["player_id"] == "p050"
    assert recs[0]["reason"] == "Pinned by you"
    assert all(r["player_id"] != "p000" for r in recs)


# ---------- unmodeled ADP rows ----------


def test_unmodeled_adp_row_recommended_inside_window(monkeypatch):
    small = make_pool(6)  # 6 modeled players
    rookie = {
        "player_id": "rook",
        "name": "Rookie Star",
        "norm_name": normalize_name("Rookie Star"),
        "position": "WR",
        "team": "FA",
        "projected_points": float("nan"),
        "vorp": float("nan"),
        "model_rank": None,
        "adp": 3.0,
        "adp_stdev": 3.0,
        "adp_rank": 3,
        "tier": None,
        "risk_flag": False,
    }
    late_rookie = dict(rookie, player_id="late", name="Late Rookie", norm_name="late rookie",
                       adp=120.0, adp_rank=120)
    small = pd.concat([small, pd.DataFrame([rookie, late_rookie])], ignore_index=True)
    use_pool(monkeypatch, small)

    draft_id = engine.create_draft()["id"]
    recs = recommend.build_recommendations(draft_id)["recommendations"]
    rook = next(r for r in recs if r["player_id"] == "rook")
    assert rook["reason"] == "ADP value (no model history)"
    assert rook["projected_points"] is None
    assert rook["survival_prob"] is not None
    # adp_rank 120 > current_overall(1) + teams(12): outside the window.
    assert all(r["player_id"] != "late" for r in recs)


# ---------- K/DST gating ----------


def test_kdst_excluded_early_included_late():
    league.save_settings(
        LeagueSettings(
            teams=8,
            my_slot=5,
            roster=RosterSlots(
                qb=1, rb=1, wr=1, te=0, flex=0, superflex=0, k=1, dst=1, bench=0
            ),
        )
    )
    draft_id = engine.create_draft()["id"]  # 5 rounds, 40 picks
    fillers = tail_fillers()

    recs = recommend.build_recommendations(draft_id)["recommendations"]
    assert all(r["position"] not in ("K", "DST") for r in recs)  # 5 rounds left > 3

    advance_until_my_turn(draft_id, fillers)
    engine.make_pick(draft_id, player_id="p000")  # my round 1
    advance_until_my_turn(draft_id, fillers)
    engine.make_pick(draft_id, player_id="p001")  # my round 2

    # 3 rounds left for me == unfilled K/DST slots (2) + 1: time to plan.
    recs = recommend.build_recommendations(draft_id)["recommendations"]
    kicker = next(r for r in recs if r["position"] == "K")
    assert kicker["reason"] == "Time to grab a K"
    dst = next(r for r in recs if r["position"] == "DST")
    assert dst["reason"] == "Time to grab a DST"


# ---------- outlooks ----------


def test_outlooks_all_teams_slots_and_needs():
    draft_id = engine.create_draft()["id"]
    for pid in ("p000", "p001", "p002", "p003", "p004"):  # RB WR QB WR RB
        engine.make_pick(draft_id, player_id=pid)

    body = recommend.team_outlooks(draft_id)
    assert len(body["teams"]) == 12

    team1 = body["teams"][0]
    assert team1["name"] == "Team 1"
    assert len(team1["slots"]) == 15
    filled = [s for s in team1["slots"] if s["player_name"]]
    assert filled == [{"slot": "RB", "player_name": "Alpha000 Beta000", "position": "RB"}]
    assert team1["projected_points"] == 400.0  # p000's projection
    assert "RB" in team1["needs"]  # second RB slot still open

    team3 = body["teams"][2]  # picked the QB: QB need satisfied
    assert "QB" not in team3["needs"]
    assert "RB" in team3["needs"]

    team6 = body["teams"][5]  # empty roster: needs every starter type
    assert {"QB", "RB", "WR", "TE", "FLEX", "K", "DST"} == set(team6["needs"])
    assert team6["needs"][-2:] == ["K", "DST"]  # K/DST are never urgent early
    assert team6["projected_points"] == 0.0


def test_my_outlook_tracks_my_picks():
    draft_id = engine.create_draft()["id"]
    fillers = tail_fillers()
    advance_until_my_turn(draft_id, fillers)
    engine.make_pick(draft_id, player_id="p002")  # QB, mine (slot 5)
    out = recommend.build_recommendations(draft_id)["my_outlook"]
    assert out["team_index"] == 5
    assert out["slots"][0] == {"slot": "QB", "player_name": "Alpha002 Beta002", "position": "QB"}
    assert out["projected_points"] == 400.0 - 2 * 1.5
    assert "QB" not in out["needs"]


# ---------- grading ----------


def grade_pool(my_vorp: float, other_vorp: float, adp_offset: int = 5) -> pd.DataFrame:
    """24 players scripted so overall N drafts player gNN in an 8-team draft."""
    rows = []
    for overall in range(1, 25):
        team = engine.overall_to_team(overall, 8)
        rnd = (overall - 1) // 8 + 1
        pos = {1: "QB", 2: "RB", 3: "WR"}[rnd]
        vorp = my_vorp if team == 5 else other_vorp
        name = f"Gamma{overall:02d} Delta{overall:02d}"
        rows.append(
            {
                "player_id": f"g{overall:02d}",
                "name": name,
                "norm_name": normalize_name(name),
                "position": pos,
                "team": "FA",
                "projected_points": vorp + 50.0,
                "vorp": vorp,
                "model_rank": overall,
                "adp": float(overall),
                "adp_stdev": 3.0,
                "adp_rank": overall + adp_offset,
                "tier": 1,
                "risk_flag": False,
            }
        )
    return pd.DataFrame(rows)


def run_scripted_grade_draft(monkeypatch, my_vorp: float, other_vorp: float) -> dict:
    league.save_settings(
        LeagueSettings(
            teams=8,
            my_slot=5,
            roster=RosterSlots(
                qb=1, rb=1, wr=1, te=0, flex=0, superflex=0, k=0, dst=0, bench=0
            ),
        )
    )
    use_pool(monkeypatch, grade_pool(my_vorp, other_vorp))
    draft_id = engine.create_draft()["id"]
    for overall in range(1, 25):
        engine.make_pick(draft_id, player_id=f"g{overall:02d}")
    return grade.build_report(draft_id)


def test_letter_grade_boundaries():
    assert grade.letter_grade(60.0) == "A+"
    assert grade.letter_grade(59.9) == "A"
    assert grade.letter_grade(40.0) == "A"
    assert grade.letter_grade(39.9) == "B"
    assert grade.letter_grade(20.0) == "B"
    assert grade.letter_grade(19.9) == "C"
    assert grade.letter_grade(-10.0) == "C"
    assert grade.letter_grade(-10.1) == "D"
    assert grade.letter_grade(-30.0) == "D"
    assert grade.letter_grade(-30.1) == "F"


def test_grade_a_plus_when_my_haul_dominates(monkeypatch):
    report = run_scripted_grade_draft(monkeypatch, my_vorp=100.0, other_vorp=0.0)
    assert report["my_total_vorp"] == 300.0
    assert report["league_avg_vorp"] == 37.5  # 300 / 8 teams
    assert report["grade"] == "A+"  # diff = 262.5
    assert report["grade_reason"].startswith("Strong value picks:")
    assert report["my_projected_points"] == 450.0  # three 150-point starters
    # My picks at overalls 5, 12, 21 with adp_rank = overall + 5.
    assert [p["overall"] for p in report["picks"]] == [5, 12, 21]
    assert all(p["value_vs_adp"] == 5 for p in report["picks"])
    assert report["position_strengths"] == {"QB": "strong", "RB": "strong", "WR": "strong"}


def test_grade_c_when_perfectly_average(monkeypatch):
    report = run_scripted_grade_draft(monkeypatch, my_vorp=50.0, other_vorp=50.0)
    assert report["grade"] == "C"  # diff = 0 exactly
    assert report["position_strengths"] == {"QB": "average", "RB": "average", "WR": "average"}


def test_grade_f_when_my_haul_is_worst(monkeypatch):
    report = run_scripted_grade_draft(monkeypatch, my_vorp=0.0, other_vorp=100.0)
    assert report["my_total_vorp"] == 0.0
    assert report["league_avg_vorp"] == 262.5  # 2100 / 8
    assert report["grade"] == "F"
    assert report["grade_reason"].startswith("Biggest reaches:")
    assert report["position_strengths"] == {"QB": "weak", "RB": "weak", "WR": "weak"}
