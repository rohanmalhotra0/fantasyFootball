"""Draft engine: snake order, pick state machine, undo/edit, pool resolution."""

import pandas as pd
import pytest
from fastapi import HTTPException

from draftengine import db, league
from draftengine.draft import engine
from draftengine.league import LeagueSettings
from draftengine.names import normalize_name

# ---------- synthetic pool ----------

_POS_CYCLE = ["RB", "WR", "QB", "WR", "RB", "TE"]

# Captured at import time, before any monkeypatching.
REAL_GET_PLAYER_POOL = engine.get_player_pool


def make_pool(n: int = 200) -> pd.DataFrame:
    """200 synthetic players: 180 modeled skill players + 10 K + 10 DST."""
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


# ---------- snake order ----------


def test_snake_order_exact_12_teams():
    assert engine.overall_to_team(1, 12) == 1
    assert engine.overall_to_team(12, 12) == 12
    assert engine.overall_to_team(13, 12) == 12
    assert engine.overall_to_team(24, 12) == 1
    assert engine.overall_to_team(25, 12) == 1
    assert engine.overall_to_team(36, 12) == 12
    assert engine.overall_to_team(37, 12) == 12


def test_overall_to_round():
    assert engine.overall_to_round(1, 12) == 1
    assert engine.overall_to_round(12, 12) == 1
    assert engine.overall_to_round(13, 12) == 2
    assert engine.overall_to_round(25, 12) == 3


def test_next_overall_for_team():
    # Team 5 in a 12-team draft picks at 5, 20, 29, 44, ...
    assert engine.next_overall_for_team(0, 5, 12, 15) == 5
    assert engine.next_overall_for_team(5, 5, 12, 15) == 20
    assert engine.next_overall_for_team(20, 5, 12, 15) == 29
    assert engine.next_overall_for_team(4, 5, 12, 15) == 5  # on the clock now
    # Team 12's last pick is 180 in a 15-round draft; nothing after.
    assert engine.next_overall_for_team(179, 12, 12, 15) == 180
    assert engine.next_overall_for_team(180, 12, 12, 15) is None


# ---------- create / state ----------


def test_create_draft_shape_and_defaults():
    state = engine.create_draft()
    assert state["status"] == "active"
    assert state["teams"] == 12
    assert state["rounds"] == 15  # 9 starters + 6 bench
    assert state["total_picks"] == 180
    assert state["current_overall"] == 1
    assert state["on_clock_team"] == 1
    assert state["current_round"] == 1
    assert state["picks"] == []
    assert state["my_slot"] == 5
    assert state["team_names"] == [f"Team {i}" for i in range(1, 13)]


def test_settings_snapshot_frozen_at_creation():
    state = engine.create_draft()
    # Changing league settings mid-draft must NOT affect the active draft.
    league.save_settings(LeagueSettings(teams=14, my_slot=3))
    unchanged = engine.get_state(state["id"])
    assert unchanged["teams"] == 12
    assert unchanged["my_slot"] == 5
    # ...but a NEW draft picks up the new settings.
    fresh = engine.create_draft()
    assert fresh["teams"] == 14
    assert fresh["my_slot"] == 3


def test_get_state_unknown_draft_404():
    with pytest.raises(HTTPException) as exc:
        engine.get_state(999)
    assert exc.value.status_code == 404


# ---------- full scripted draft ----------


def test_full_scripted_12_team_15_round_draft():
    state = engine.create_draft()
    draft_id = state["id"]
    for overall in range(1, 181):
        state = engine.make_pick(draft_id, player_id=f"p{overall - 1:03d}")
        assert len(state["picks"]) == overall
        pick = state["picks"][-1]
        assert pick["overall"] == overall
        assert pick["team_index"] == engine.overall_to_team(overall, 12)
        assert pick["round"] == engine.overall_to_round(overall, 12)
        assert pick["source"] == "manual"

    assert state["status"] == "complete"
    assert state["current_overall"] is None
    assert state["on_clock_team"] is None
    assert state["current_round"] is None

    # Every pick recorded exactly once.
    ids = [p["player_id"] for p in state["picks"]]
    assert len(set(ids)) == 180

    # Picking into a complete draft is rejected.
    with pytest.raises(HTTPException) as exc:
        engine.make_pick(draft_id, player_id="p180")
    assert exc.value.status_code == 409
    assert "complete" in exc.value.detail


def test_complete_then_undo_reopens():
    state = engine.create_draft()
    draft_id = state["id"]
    for overall in range(1, 181):
        engine.make_pick(draft_id, player_id=f"p{overall - 1:03d}")
    state = engine.undo_last(draft_id)
    assert state["status"] == "active"
    assert state["current_overall"] == 180
    assert state["on_clock_team"] == engine.overall_to_team(180, 12)
    # The freed player can be re-picked.
    state = engine.make_pick(draft_id, player_id="p179")
    assert state["status"] == "complete"


# ---------- pick errors ----------


def test_duplicate_pick_rejected_with_player_name():
    draft_id = engine.create_draft()["id"]
    engine.make_pick(draft_id, player_id="p000")
    with pytest.raises(HTTPException) as exc:
        engine.make_pick(draft_id, player_id="p000")
    assert exc.value.status_code == 409
    assert "Alpha000 Beta000" in exc.value.detail


def test_wrong_team_rejected_with_on_clock_name():
    league.save_settings(LeagueSettings(team_names=["The Sharks"] + [""] * 11))
    draft_id = engine.create_draft()["id"]
    with pytest.raises(HTTPException) as exc:
        engine.make_pick(draft_id, player_id="p000", team_index=7)
    assert exc.value.status_code == 409
    assert "The Sharks" in exc.value.detail  # names who IS on the clock
    assert "team 1" in exc.value.detail


def test_explicit_correct_team_index_accepted():
    draft_id = engine.create_draft()["id"]
    state = engine.make_pick(draft_id, player_id="p000", team_index=1)
    assert state["picks"][0]["team_index"] == 1


def test_unknown_player_404():
    draft_id = engine.create_draft()["id"]
    with pytest.raises(HTTPException) as exc:
        engine.make_pick(draft_id, player_id="nope")
    assert exc.value.status_code == 404
    with pytest.raises(HTTPException) as exc:
        engine.make_pick(draft_id, player_name="Zzz Nobody")
    assert exc.value.status_code == 404


def test_no_player_reference_422():
    draft_id = engine.create_draft()["id"]
    with pytest.raises(HTTPException) as exc:
        engine.make_pick(draft_id)
    assert exc.value.status_code == 422


def test_pick_by_normalized_name(pool):
    pool.loc[len(pool)] = {
        "player_id": "pspecial",
        "name": "A.J. Brown Jr.",
        "norm_name": normalize_name("A.J. Brown Jr."),
        "position": "WR",
        "team": "PHI",
        "projected_points": 300.0,
        "vorp": 150.0,
        "model_rank": 1,
        "adp": 2.0,
        "adp_stdev": 1.0,
        "adp_rank": 2,
        "tier": 1,
        "risk_flag": False,
    }
    draft_id = engine.create_draft()["id"]
    state = engine.make_pick(draft_id, player_name="AJ Brown")
    assert state["picks"][0]["player_id"] == "pspecial"
    assert state["picks"][0]["player_name"] == "A.J. Brown Jr."


# ---------- undo ----------


def test_undo_restores_exact_state_at_several_depths():
    initial = engine.create_draft()
    draft_id = initial["id"]
    states = []  # states[i] = state after i+1 picks
    for overall in range(1, 31):
        states.append(engine.make_pick(draft_id, player_id=f"p{overall - 1:03d}"))

    for depth in range(1, 6):  # undo 5 times: 30 -> 25 picks
        after_undo = engine.undo_last(draft_id)
        assert after_undo == states[30 - depth - 1]

    # Undo all the way back to zero picks -> exactly the initial state.
    for _ in range(25):
        state = engine.undo_last(draft_id)
    assert state == initial


def test_undo_empty_draft_409():
    draft_id = engine.create_draft()["id"]
    with pytest.raises(HTTPException) as exc:
        engine.undo_last(draft_id)
    assert exc.value.status_code == 409


# ---------- edit ----------


def test_edit_pick_swaps_player():
    draft_id = engine.create_draft()["id"]
    engine.make_pick(draft_id, player_id="p000")
    engine.make_pick(draft_id, player_id="p001")
    engine.make_pick(draft_id, player_id="p002")

    state = engine.edit_pick(draft_id, 2, player_id="p010")
    edited = state["picks"][1]
    assert edited["player_id"] == "p010"
    assert edited["player_name"] == "Alpha010 Beta010"
    assert edited["position"] == "RB"  # p010's position, not the old player's
    assert edited["overall"] == 2
    assert edited["team_index"] == 2  # slot ownership unchanged
    assert state["current_overall"] == 4  # pick count unchanged


def test_edit_pick_to_already_picked_player_409():
    draft_id = engine.create_draft()["id"]
    engine.make_pick(draft_id, player_id="p000")
    engine.make_pick(draft_id, player_id="p001")
    with pytest.raises(HTTPException) as exc:
        engine.edit_pick(draft_id, 1, player_id="p001")
    assert exc.value.status_code == 409
    assert "Alpha001 Beta001" in exc.value.detail


def test_edit_pick_same_player_is_noop():
    draft_id = engine.create_draft()["id"]
    engine.make_pick(draft_id, player_id="p000")
    state = engine.edit_pick(draft_id, 1, player_id="p000")
    assert state["picks"][0]["player_id"] == "p000"


def test_edit_pick_unknown_overall_404():
    draft_id = engine.create_draft()["id"]
    with pytest.raises(HTTPException) as exc:
        engine.edit_pick(draft_id, 99, player_id="p000")
    assert exc.value.status_code == 404


# ---------- pool 503 (real get_player_pool, empty data dir) ----------


def test_pool_missing_gives_503(monkeypatch):
    # Restore the REAL pool function: the isolated data dir has no
    # artifacts, so it must 503 with an actionable message.
    draft_id = engine.create_draft()["id"]  # creation needs no pool
    monkeypatch.setattr(engine, "get_player_pool", REAL_GET_PLAYER_POOL)
    with pytest.raises(HTTPException) as exc:
        engine.make_pick(draft_id, player_id="p000")
    assert exc.value.status_code == 503
    assert "data refresh" in exc.value.detail
