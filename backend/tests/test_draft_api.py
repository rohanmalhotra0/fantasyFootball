"""Draft REST + WebSocket API: full flow, error codes, zero-desync WS."""

import pandas as pd
import pytest
from fastapi import WebSocketDisconnect

from draftengine.draft import engine
from draftengine.names import normalize_name

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


REAL_GET_PLAYER_POOL = engine.get_player_pool


@pytest.fixture(autouse=True)
def patched_pool(monkeypatch):
    pool = make_pool()
    monkeypatch.setattr(engine, "get_player_pool", lambda settings: pool)


# ---------- REST flow ----------


def test_create_and_list_drafts(client):
    resp = client.post("/api/drafts")
    assert resp.status_code == 200
    state = resp.json()
    assert state["status"] == "active"
    assert state["teams"] == 12
    assert state["rounds"] == 15
    assert state["total_picks"] == 180
    assert state["picks"] == []
    assert state["current_overall"] == 1
    assert state["settings"]["teams"] == 12

    listed = client.get("/api/drafts").json()
    assert len(listed) == 1
    assert listed[0]["id"] == state["id"]
    assert listed[0]["picks_made"] == 0
    assert listed[0]["status"] == "active"
    assert isinstance(listed[0]["created_at"], str)


def test_pick_flow_and_error_codes(client):
    draft_id = client.post("/api/drafts").json()["id"]

    resp = client.post(f"/api/drafts/{draft_id}/picks", json={"player_id": "p000"})
    assert resp.status_code == 200
    assert len(resp.json()["picks"]) == 1

    # Duplicate: 409 naming the player.
    resp = client.post(f"/api/drafts/{draft_id}/picks", json={"player_id": "p000"})
    assert resp.status_code == 409
    assert "Alpha000 Beta000" in resp.json()["detail"]

    # Wrong team: 409 naming who IS on the clock (team 2 now).
    resp = client.post(
        f"/api/drafts/{draft_id}/picks", json={"player_id": "p001", "team_index": 9}
    )
    assert resp.status_code == 409
    assert "Team 2" in resp.json()["detail"]

    # Unknown player: 404.
    resp = client.post(f"/api/drafts/{draft_id}/picks", json={"player_id": "ghost"})
    assert resp.status_code == 404

    # Unknown draft: 404.
    resp = client.post("/api/drafts/999/picks", json={"player_id": "p001"})
    assert resp.status_code == 404
    assert client.get("/api/drafts/999").status_code == 404

    # Pick by name works.
    resp = client.post(
        f"/api/drafts/{draft_id}/picks", json={"player_name": "Alpha001 Beta001"}
    )
    assert resp.status_code == 200

    # State via GET matches the last mutation response.
    assert client.get(f"/api/drafts/{draft_id}").json() == resp.json()


def test_undo_and_edit_endpoints(client):
    draft_id = client.post("/api/drafts").json()["id"]
    client.post(f"/api/drafts/{draft_id}/picks", json={"player_id": "p000"})
    client.post(f"/api/drafts/{draft_id}/picks", json={"player_id": "p001"})

    resp = client.put(f"/api/drafts/{draft_id}/picks/1", json={"player_id": "p005"})
    assert resp.status_code == 200
    assert resp.json()["picks"][0]["player_id"] == "p005"

    # Editing to a player picked elsewhere: 409.
    resp = client.put(f"/api/drafts/{draft_id}/picks/1", json={"player_id": "p001"})
    assert resp.status_code == 409

    resp = client.post(f"/api/drafts/{draft_id}/undo")
    assert resp.status_code == 200
    assert len(resp.json()["picks"]) == 1

    client.post(f"/api/drafts/{draft_id}/undo")
    resp = client.post(f"/api/drafts/{draft_id}/undo")
    assert resp.status_code == 409  # nothing left to undo


def test_pool_missing_503(client, monkeypatch):
    monkeypatch.setattr(engine, "get_player_pool", REAL_GET_PLAYER_POOL)
    draft_id = client.post("/api/drafts").json()["id"]  # creation needs no pool
    resp = client.post(f"/api/drafts/{draft_id}/picks", json={"player_id": "p000"})
    assert resp.status_code == 503
    assert "data refresh" in resp.json()["detail"]


# ---------- analysis endpoints (shape checks; logic tested elsewhere) ----------


def test_recommendations_endpoint_shape(client):
    draft_id = client.post("/api/drafts").json()["id"]
    body = client.get(f"/api/drafts/{draft_id}/recommendations").json()
    assert body["on_clock_team"] == 1
    assert body["my_turn"] is False
    assert body["picks_until_my_turn"] == 4  # my_slot defaults to 5
    assert body["adp_available"] is True
    assert len(body["recommendations"]) > 0
    rec = body["recommendations"][0]
    assert {"player_id", "name", "position", "reason", "survival_prob"} <= set(rec)
    assert body["my_outlook"]["team_index"] == 5
    assert len(body["my_outlook"]["slots"]) == 15


def test_outlooks_endpoint_shape(client):
    draft_id = client.post("/api/drafts").json()["id"]
    client.post(f"/api/drafts/{draft_id}/picks", json={"player_id": "p000"})
    body = client.get(f"/api/drafts/{draft_id}/outlooks").json()
    assert len(body["teams"]) == 12
    team1 = body["teams"][0]
    assert team1["team_index"] == 1
    assert len(team1["slots"]) == 15
    # p000 is an RB: he must occupy team 1's first RB slot.
    filled = [s for s in team1["slots"] if s["player_name"]]
    assert filled == [{"slot": "RB", "player_name": "Alpha000 Beta000", "position": "RB"}]
    assert "RB" in team1["needs"]  # still one RB slot empty


def test_report_endpoint_shape(client):
    draft_id = client.post("/api/drafts").json()["id"]
    body = client.get(f"/api/drafts/{draft_id}/report").json()
    assert body["draft_id"] == draft_id
    assert body["grade"] in {"A+", "A", "B", "C", "D", "F"}
    assert body["picks"] == []
    assert isinstance(body["grade_reason"], str)


# ---------- websocket: zero desync ----------


def test_ws_two_tabs_always_get_identical_full_state(client):
    draft_id = client.post("/api/drafts").json()["id"]
    with (
        client.websocket_connect(f"/api/drafts/{draft_id}/ws") as ws1,
        client.websocket_connect(f"/api/drafts/{draft_id}/ws") as ws2,
    ):
        # Both sockets get a full snapshot immediately on connect.
        first1 = ws1.receive_json()
        first2 = ws2.receive_json()
        assert first1["type"] == "state"
        assert first1 == first2
        assert first1["state"] == client.get(f"/api/drafts/{draft_id}").json()

        # A REST mutation broadcasts the SAME full state to both sockets.
        rest_state = client.post(
            f"/api/drafts/{draft_id}/picks", json={"player_id": "p000"}
        ).json()
        msg1 = ws1.receive_json()
        msg2 = ws2.receive_json()
        assert msg1 == msg2
        assert msg1["type"] == "state"
        assert msg1["state"] == rest_state
        assert msg1["state"] == client.get(f"/api/drafts/{draft_id}").json()

        # Undo broadcasts too.
        undo_state = client.post(f"/api/drafts/{draft_id}/undo").json()
        assert ws1.receive_json()["state"] == undo_state
        assert ws2.receive_json()["state"] == undo_state


def test_ws_reconnect_state_equals_rest(client):
    draft_id = client.post("/api/drafts").json()["id"]
    client.post(f"/api/drafts/{draft_id}/picks", json={"player_id": "p000"})
    client.post(f"/api/drafts/{draft_id}/picks", json={"player_id": "p001"})
    with client.websocket_connect(f"/api/drafts/{draft_id}/ws") as ws:
        snapshot = ws.receive_json()
    assert snapshot["state"] == client.get(f"/api/drafts/{draft_id}").json()
    assert len(snapshot["state"]["picks"]) == 2


def test_ws_survives_one_tab_closing(client):
    draft_id = client.post("/api/drafts").json()["id"]
    with client.websocket_connect(f"/api/drafts/{draft_id}/ws") as ws1:
        ws1.receive_json()
        with client.websocket_connect(f"/api/drafts/{draft_id}/ws") as ws2:
            ws2.receive_json()
        # ws2 closed; mutation must still reach ws1.
        state = client.post(f"/api/drafts/{draft_id}/picks", json={"player_id": "p000"}).json()
        assert ws1.receive_json()["state"] == state


def test_ws_unknown_draft_rejected(client):
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/api/drafts/999/ws"):
            pass
