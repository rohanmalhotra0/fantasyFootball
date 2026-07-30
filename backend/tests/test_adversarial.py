"""Phase 6 adversarial QA: attack the draft engine + API, prove every break.

Each test either reproduces a break that has since been fixed in the
engine/routes (and now passes), or locks in an already-safe invariant so
a regression reintroducing the bug fails loudly here.

Attack map (see the phase report for outcomes):
  1. duplicate pick via parallel POSTs
  2. parallel picks for the same overall slot + DB-level uniqueness net
  3. undo at zero / parallel undo spam
  4. edit racing make; edit onto an already-picked player
  5. 16-team superflex 0K/0DST end-to-end on the REAL board artifacts
  6. settings changed mid-draft (snapshot honored)
  7. GET state while picks stream in (client-refresh consistency)
  8. websocket: 3 clients, 20 picks, disconnect + reconnect
  9. malformed pick/edit inputs never 500, never persist
 10. voice endpoint hardening (50k chars, garbage, team names, dupes)
"""

import shutil
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pandas as pd
import pytest
from sqlalchemy.exc import IntegrityError

from draftengine.db import session_scope
from draftengine.draft import engine
from draftengine.names import normalize_name
from draftengine.orm import Pick

_POS_CYCLE = ["RB", "WR", "QB", "WR", "RB", "TE"]


def make_pool(n: int = 220) -> pd.DataFrame:
    rows = []
    for i in range(n):
        if i < 192:
            pos = _POS_CYCLE[i % 6]
        elif i < 206:
            pos = "K"
        else:
            pos = "DST"
        modeled = i < 192
        name = f"Alpha{i:03d} Beta{i:03d}"
        rows.append(
            {
                "player_id": f"p{i:03d}",
                "name": name,
                "norm_name": normalize_name(name),
                "position": pos,
                "team": "FA",
                "projected_points": (400.0 - i * 1.5) if modeled else float("nan"),
                "vorp": (250.0 - i * 1.2) if modeled else float("nan"),
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
def patched_pool(monkeypatch):
    pool = make_pool()
    monkeypatch.setattr(engine, "get_player_pool", lambda settings: pool)
    return pool


def _new_draft(client) -> int:
    resp = client.post("/api/drafts")
    assert resp.status_code == 200
    return resp.json()["id"]


def _assert_state_consistent(state: dict) -> None:
    """The invariants every DraftState snapshot must satisfy."""
    picks = state["picks"]
    overalls = [p["overall"] for p in picks]
    assert overalls == list(range(1, len(picks) + 1)), "picks must be contiguous from 1"
    player_ids = [p["player_id"] for p in picks]
    assert len(set(player_ids)) == len(player_ids), "a player may only be picked once"
    for p in picks:
        assert p["team_index"] == engine.overall_to_team(p["overall"], state["teams"])
        assert p["round"] == engine.overall_to_round(p["overall"], state["teams"])
    if state["status"] == "active":
        assert state["current_overall"] == len(picks) + 1
        assert state["on_clock_team"] == engine.overall_to_team(
            state["current_overall"], state["teams"]
        )
        assert state["current_round"] == engine.overall_to_round(
            state["current_overall"], state["teams"]
        )
    else:
        assert state["status"] == "complete"
        assert state["current_overall"] is None
        assert state["on_clock_team"] is None
        assert len(picks) == state["total_picks"]


# ---------- attack 1: duplicate pick via parallel POSTs ----------


def test_duplicate_pick_parallel_posts_one_wins(client, patched_pool):
    """Same player POSTed from two threads at once: exactly one 200, one 409."""
    for trial in range(6):
        draft_id = _new_draft(client)
        barrier = threading.Barrier(2)

        def fire(draft_id=draft_id, barrier=barrier):
            barrier.wait()
            return client.post(f"/api/drafts/{draft_id}/picks", json={"player_id": "p000"})

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = [f.result() for f in [pool.submit(fire), pool.submit(fire)]]
        statuses = sorted(r.status_code for r in results)
        assert statuses == [200, 409], f"trial {trial}: got {statuses}"

        state = client.get(f"/api/drafts/{draft_id}").json()
        assert len(state["picks"]) == 1
        assert state["picks"][0]["player_id"] == "p000"
        _assert_state_consistent(state)


def test_duplicate_pick_engine_level_stress(client, patched_pool):
    """Six threads race the same player at the engine layer: one winner."""
    draft_id = _new_draft(client)
    barrier = threading.Barrier(6)
    outcomes: list[int] = []
    lock = threading.Lock()

    def fire():
        barrier.wait()
        try:
            engine.make_pick(draft_id, player_id="p007")
            code = 200
        except Exception as exc:  # HTTPException carries .status_code
            code = getattr(exc, "status_code", 500)
        with lock:
            outcomes.append(code)

    threads = [threading.Thread(target=fire) for _ in range(6)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(outcomes) == [200, 409, 409, 409, 409, 409]
    state = engine.get_state(draft_id)
    assert [p["player_id"] for p in state["picks"]] == ["p007"]


# ---------- attack 2: same overall slot, different players ----------


def test_same_slot_parallel_different_players_exactly_one_wins(client, patched_pool):
    """Both POSTs target team 1's pick (team_index=1): exactly one may land."""
    for trial in range(4):
        draft_id = _new_draft(client)
        barrier = threading.Barrier(2)

        def fire(pid: str, draft_id=draft_id, barrier=barrier):
            barrier.wait()
            return client.post(
                f"/api/drafts/{draft_id}/picks", json={"player_id": pid, "team_index": 1}
            )

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = [f.result() for f in [pool.submit(fire, "p000"), pool.submit(fire, "p001")]]
        statuses = sorted(r.status_code for r in results)
        assert statuses == [200, 409], f"trial {trial}: got {statuses}"

        state = client.get(f"/api/drafts/{draft_id}").json()
        assert len(state["picks"]) == 1
        assert state["picks"][0]["team_index"] == 1
        _assert_state_consistent(state)


def test_parallel_untargeted_picks_stay_contiguous(client, patched_pool):
    """Eight threads, eight players, no team_index: every landed pick gets a
    unique contiguous overall — never two picks in the same slot."""
    draft_id = _new_draft(client)
    barrier = threading.Barrier(8)

    def fire(pid: str):
        barrier.wait()
        return client.post(f"/api/drafts/{draft_id}/picks", json={"player_id": pid})

    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = [pool.submit(fire, f"p{i:03d}") for i in range(8)]
        results = [f.result() for f in futures]
    assert all(r.status_code == 200 for r in results)
    state = client.get(f"/api/drafts/{draft_id}").json()
    assert len(state["picks"]) == 8
    _assert_state_consistent(state)


def test_db_unique_indexes_are_the_last_line_of_defense(client, patched_pool):
    """Bypass the engine's write lock entirely: a raw duplicate-overall or
    duplicate-player INSERT must be rejected by the DB itself (this guards
    a second writer process, where the module lock cannot reach)."""
    draft_id = _new_draft(client)
    client.post(f"/api/drafts/{draft_id}/picks", json={"player_id": "p000"})
    engine.ensure_pick_indexes()

    def raw_insert(overall: int, player_id: str) -> None:
        with session_scope() as session:
            session.add(
                Pick(
                    draft_id=draft_id,
                    overall=overall,
                    round=1,
                    team_index=1,
                    player_id=player_id,
                    player_name="Rogue Writer",
                    position="RB",
                    source="manual",
                )
            )

    with pytest.raises(IntegrityError):
        raw_insert(1, "p999")  # same overall slot, different player
    with pytest.raises(IntegrityError):
        raw_insert(2, "p000")  # different slot, same player

    state = client.get(f"/api/drafts/{draft_id}").json()
    assert len(state["picks"]) == 1
    _assert_state_consistent(state)


# ---------- attack 3: undo at zero + undo spam ----------


def test_undo_at_pick_zero_is_409(client, patched_pool):
    draft_id = _new_draft(client)
    resp = client.post(f"/api/drafts/{draft_id}/undo")
    assert resp.status_code == 409
    state = client.get(f"/api/drafts/{draft_id}").json()
    assert state["picks"] == []
    assert state["current_overall"] == 1


def test_parallel_undo_spam_never_negative(client, patched_pool):
    """Five parallel undos with three picks made: exactly three succeed,
    two 409, zero 500s, and state ends at exactly zero picks."""
    draft_id = _new_draft(client)
    for pid in ("p000", "p001", "p002"):
        assert client.post(f"/api/drafts/{draft_id}/picks", json={"player_id": pid}).status_code == 200

    barrier = threading.Barrier(5)

    def fire():
        barrier.wait()
        return client.post(f"/api/drafts/{draft_id}/undo")

    with ThreadPoolExecutor(max_workers=5) as pool:
        results = [f.result() for f in [pool.submit(fire) for _ in range(5)]]
    statuses = sorted(r.status_code for r in results)
    assert statuses == [200, 200, 200, 409, 409]

    state = client.get(f"/api/drafts/{draft_id}").json()
    assert state["picks"] == []
    assert state["current_overall"] == 1
    _assert_state_consistent(state)


# ---------- attack 4: edit racing make; edit onto a picked player ----------


def test_edit_to_already_picked_player_is_409(client, patched_pool):
    draft_id = _new_draft(client)
    client.post(f"/api/drafts/{draft_id}/picks", json={"player_id": "p000"})
    client.post(f"/api/drafts/{draft_id}/picks", json={"player_id": "p001"})
    resp = client.put(f"/api/drafts/{draft_id}/picks/1", json={"player_id": "p001"})
    assert resp.status_code == 409
    state = client.get(f"/api/drafts/{draft_id}").json()
    assert state["picks"][0]["player_id"] == "p000"  # edit did not land


def test_edit_racing_make_pick_stays_consistent(client, patched_pool):
    """One thread edits pick #1 in a loop while another makes picks. Every
    response is 200/409, and the final state satisfies all invariants."""
    draft_id = _new_draft(client)
    client.post(f"/api/drafts/{draft_id}/picks", json={"player_id": "p000"})

    edit_codes: list[int] = []
    make_codes: list[int] = []

    def editor():
        # alternates pick #1 between two players the maker also wants
        for i in range(12):
            pid = "p100" if i % 2 == 0 else "p101"
            r = client.put(f"/api/drafts/{draft_id}/picks/1", json={"player_id": pid})
            edit_codes.append(r.status_code)

    def maker():
        for i in range(1, 13):
            pid = f"p{i:03d}" if i % 3 else "p100"  # collide with the editor
            r = client.post(f"/api/drafts/{draft_id}/picks", json={"player_id": pid})
            make_codes.append(r.status_code)

    t1, t2 = threading.Thread(target=editor), threading.Thread(target=maker)
    t1.start(), t2.start()
    t1.join(), t2.join()

    assert set(edit_codes) <= {200, 409}, f"editor saw {sorted(set(edit_codes))}"
    assert set(make_codes) <= {200, 409}, f"maker saw {sorted(set(make_codes))}"
    _assert_state_consistent(client.get(f"/api/drafts/{draft_id}").json())


# ---------- attack 5: 16-team superflex, 0 K / 0 DST, real artifacts ----------

SUPERFLEX_ROSTER = {
    "qb": 1, "rb": 2, "wr": 2, "te": 1, "flex": 1, "superflex": 1,
    "k": 0, "dst": 0, "bench": 5,
}


def _copy_real_artifacts() -> bool:
    """Copy the repo's real pipeline artifacts into this test's DATA_DIR."""
    src = Path(__file__).resolve().parents[2] / "data"
    if not (src / "features.parquet").exists() or not (src / "models" / "registry.json").exists():
        return False
    from draftengine.config import data_dir

    dst = data_dir()
    shutil.copy2(src / "features.parquet", dst / "features.parquet")
    if (src / "season_stats.parquet").exists():
        shutil.copy2(src / "season_stats.parquet", dst / "season_stats.parquet")
    shutil.copytree(src / "models", dst / "models", dirs_exist_ok=True)
    if (src / "cache" / "adp").exists():
        shutil.copytree(src / "cache" / "adp", dst / "cache" / "adp", dirs_exist_ok=True)
    return True


def test_superflex_16_team_no_kdst_end_to_end(client):
    """Full 16-team superflex draft on the real board: settings PUT, every
    pick via the API, mid-draft settings sabotage, report at the end."""
    if not _copy_real_artifacts():
        pytest.skip("real pipeline artifacts not present in repo data/")

    resp = client.put(
        "/api/settings",
        json={"teams": 16, "my_slot": 5, "scoring_preset": "ppr", "roster": SUPERFLEX_ROSTER},
    )
    assert resp.status_code == 200
    rounds = resp.json()["rounds"]
    assert rounds == 13  # 8 starters + 5 bench

    state = client.post("/api/drafts").json()
    draft_id = state["id"]
    assert state["teams"] == 16
    assert state["rounds"] == rounds
    assert state["total_picks"] == 16 * rounds

    # Superflex must boost QBs: at least 3 QBs in the top-10 recs early.
    recs = client.get(f"/api/drafts/{draft_id}/recommendations").json()
    top10 = recs["recommendations"][:10]
    qbs = sum(1 for r in top10 if r["position"] == "QB")
    assert qbs >= 3, f"expected >=3 QBs in top-10 superflex recs, got {qbs}: " + ", ".join(
        f"{r['name']}({r['position']})" for r in top10
    )

    # Draft the whole thing through the API in board order.
    from draftengine.league import LeagueSettings

    settings = LeagueSettings.model_validate(state["settings"])
    board = engine.get_player_pool(settings).drop_duplicates("player_id")
    ids = [str(pid) for pid in board["player_id"]]
    made = 0
    for pid in ids:
        if made == 16 * rounds:
            break
        r = client.post(f"/api/drafts/{draft_id}/picks", json={"player_id": pid})
        assert r.status_code == 200, f"pick {made + 1} ({pid}) -> {r.status_code}: {r.text[:200]}"
        made += 1
        if made == 20:
            # Mid-draft sabotage: shrink the league; the draft's snapshot
            # must keep it at 16 teams x 13 rounds (attack 6, real data).
            assert client.put(
                "/api/settings", json={"teams": 12, "my_slot": 5}
            ).status_code == 200
            mid = client.get(f"/api/drafts/{draft_id}").json()
            assert mid["teams"] == 16
            assert mid["rounds"] == rounds
            _assert_state_consistent(mid)
        if made % 50 == 0:
            _assert_state_consistent(client.get(f"/api/drafts/{draft_id}").json())

    final = client.get(f"/api/drafts/{draft_id}").json()
    assert final["status"] == "complete"
    assert len(final["picks"]) == 16 * rounds
    _assert_state_consistent(final)

    # One more pick must 409, not corrupt anything.
    assert client.post(
        f"/api/drafts/{draft_id}/picks", json={"player_id": ids[16 * rounds]}
    ).status_code == 409

    # Outlooks: 16 teams, superflex slot present, no K/DST slots anywhere.
    outlooks = client.get(f"/api/drafts/{draft_id}/outlooks").json()["teams"]
    assert len(outlooks) == 16
    slot_names = {s["slot"] for s in outlooks[0]["slots"]}
    assert "SFLEX" in slot_names
    assert "K" not in slot_names and "DST" not in slot_names

    # Report never crashes and stays inside the contract.
    report = client.get(f"/api/drafts/{draft_id}/report").json()
    assert report["grade"] in {"A+", "A", "B", "C", "D", "F"}
    assert len(report["picks"]) == rounds
    assert report["my_projected_points"] > 0
    assert set(report["position_strengths"]) <= {"QB", "RB", "WR", "TE", "K", "DST"}


# ---------- attack 6: settings changed mid-draft (snapshot honored) ----------


def test_settings_change_mid_draft_does_not_touch_active_draft(client, patched_pool):
    draft_id = _new_draft(client)
    before = client.get(f"/api/drafts/{draft_id}").json()
    assert (before["teams"], before["rounds"]) == (12, 15)
    client.post(f"/api/drafts/{draft_id}/picks", json={"player_id": "p000"})

    # Sabotage: 16 teams, superflex, different slot count.
    assert client.put(
        "/api/settings",
        json={"teams": 16, "my_slot": 9, "roster": SUPERFLEX_ROSTER},
    ).status_code == 200

    state = client.get(f"/api/drafts/{draft_id}").json()
    assert (state["teams"], state["rounds"]) == (12, 15), "snapshot must be frozen"
    assert state["my_slot"] == 5
    assert state["total_picks"] == 180
    assert len(state["team_names"]) == 12

    # Picks keep following 12-team snake math, not the new 16-team settings.
    for pid in ("p001", "p002"):
        assert client.post(f"/api/drafts/{draft_id}/picks", json={"player_id": pid}).status_code == 200
    state = client.get(f"/api/drafts/{draft_id}").json()
    assert state["on_clock_team"] == engine.overall_to_team(4, 12)
    _assert_state_consistent(state)

    # Recommendations also honor the snapshot (12-team horizon, slot 5).
    recs = client.get(f"/api/drafts/{draft_id}/recommendations").json()
    assert recs["my_outlook"]["team_index"] == 5
    assert len(recs["my_outlook"]["slots"]) == 15

    # A NEW draft picks up the new settings.
    fresh = client.post("/api/drafts").json()
    assert (fresh["teams"], fresh["my_slot"]) == (16, 9)


# ---------- attack 7: refresh-mid-draft read consistency ----------


def test_get_state_always_consistent_while_picks_stream(client, patched_pool):
    """A writer thread streams 40 picks while the main thread hammers GET:
    every snapshot must be internally consistent and monotonic."""
    draft_id = _new_draft(client)
    stop = threading.Event()
    writer_codes: list[int] = []

    def writer():
        for i in range(40):
            r = client.post(f"/api/drafts/{draft_id}/picks", json={"player_id": f"p{i:03d}"})
            writer_codes.append(r.status_code)
            time.sleep(0.002)
        stop.set()

    t = threading.Thread(target=writer)
    t.start()
    seen = 0
    reads = 0
    try:
        while not stop.is_set() or reads == 0:
            resp = client.get(f"/api/drafts/{draft_id}")
            assert resp.status_code == 200
            state = resp.json()
            _assert_state_consistent(state)
            assert len(state["picks"]) >= seen, "pick count must never go backwards"
            seen = len(state["picks"])
            reads += 1
    finally:
        t.join()
    assert all(c == 200 for c in writer_codes)
    assert reads >= 5, "reader must actually have interleaved with the writer"
    final = client.get(f"/api/drafts/{draft_id}").json()
    assert len(final["picks"]) == 40
    _assert_state_consistent(final)


# ---------- attack 8: websocket fanout ----------


def test_ws_three_clients_identical_stream_and_reconnect(client, patched_pool):
    draft_id = _new_draft(client)
    with (
        client.websocket_connect(f"/api/drafts/{draft_id}/ws") as ws1,
        client.websocket_connect(f"/api/drafts/{draft_id}/ws") as ws2,
        client.websocket_connect(f"/api/drafts/{draft_id}/ws") as ws3,
    ):
        for ws in (ws1, ws2, ws3):
            snap = ws.receive_json()
            assert snap["type"] == "state"
            assert snap["state"]["picks"] == []

        # First 10 picks reach all three identically.
        for i in range(10):
            rest = client.post(
                f"/api/drafts/{draft_id}/picks", json={"player_id": f"p{i:03d}"}
            ).json()
            msgs = [ws.receive_json() for ws in (ws1, ws2, ws3)]
            assert msgs[0] == msgs[1] == msgs[2]
            assert msgs[0]["state"] == rest

    # All sockets dropped; ten more picks with zero listeners must not 500.
    for i in range(10, 20):
        assert client.post(
            f"/api/drafts/{draft_id}/picks", json={"player_id": f"p{i:03d}"}
        ).status_code == 200

    # Reconnect: snapshot equals REST truth, and new picks stream again.
    with client.websocket_connect(f"/api/drafts/{draft_id}/ws") as ws:
        snap = ws.receive_json()
        assert snap["state"] == client.get(f"/api/drafts/{draft_id}").json()
        assert len(snap["state"]["picks"]) == 20
        rest = client.post(f"/api/drafts/{draft_id}/picks", json={"player_id": "p020"}).json()
        assert ws.receive_json()["state"] == rest
        _assert_state_consistent(rest)


# ---------- attack 9: malformed inputs never 500, never persist ----------


def test_malformed_pick_inputs_clean_4xx_nothing_persisted(client, patched_pool):
    draft_id = _new_draft(client)
    sqlish = "Robert'); DROP TABLE picks;--"
    attacks = [
        # (method, path, json, expected statuses)
        ("POST", f"/api/drafts/{draft_id}/picks", {}, {422}),
        ("POST", f"/api/drafts/{draft_id}/picks", None, {422}),  # no body at all
        ("POST", f"/api/drafts/{draft_id}/picks", {"player_id": "ghost-9999"}, {404}),
        ("POST", f"/api/drafts/{draft_id}/picks", {"player_id": "p000", "team_index": 99}, {409}),
        ("POST", f"/api/drafts/{draft_id}/picks", {"player_id": "p000", "team_index": -5}, {409}),
        ("POST", f"/api/drafts/{draft_id}/picks", {"player_name": "x" * 10_000}, {404}),
        ("POST", f"/api/drafts/{draft_id}/picks", {"player_name": "🏈🔥💀" * 300}, {404}),
        ("POST", f"/api/drafts/{draft_id}/picks", {"player_name": sqlish}, {404}),
        ("POST", f"/api/drafts/{draft_id}/picks", {"player_id": sqlish}, {404}),
        ("POST", f"/api/drafts/{draft_id}/picks", {"player_id": ["p000"]}, {422}),
        ("POST", f"/api/drafts/{draft_id}/picks", {"player_id": "p000", "team_index": 1.7}, {422}),
        ("POST", f"/api/drafts/{draft_id}/picks", {"player_id": "p000", "source": "z" * 10_000}, {422}),
        ("POST", f"/api/drafts/{draft_id}/picks", {"player_id": "p000", "source": "hacked"}, {422}),
        ("PUT", f"/api/drafts/{draft_id}/picks/-3", {"player_id": "p001"}, {404}),
        ("PUT", f"/api/drafts/{draft_id}/picks/0", {"player_id": "p001"}, {404}),
        ("PUT", f"/api/drafts/{draft_id}/picks/999", {"player_id": "p001"}, {404}),
        ("PUT", f"/api/drafts/{draft_id}/picks/abc", {"player_id": "p001"}, {422}),
        ("POST", "/api/drafts/999999/picks", {"player_id": "p000"}, {404}),
        ("POST", "/api/drafts/-1/picks", {"player_id": "p000"}, {404}),
        ("POST", "/api/drafts/abc/picks", {"player_id": "p000"}, {422}),
    ]
    for method, path, body, expected in attacks:
        if body is None:
            resp = client.request(method, path)
        else:
            resp = client.request(method, path, json=body)
        assert resp.status_code in expected, (
            f"{method} {path} body={str(body)[:60]!r} -> {resp.status_code} "
            f"(expected {expected}): {resp.text[:200]}"
        )
        assert resp.status_code < 500

    # Nothing persisted, table intact, draft still perfectly usable.
    state = client.get(f"/api/drafts/{draft_id}").json()
    assert state["picks"] == []
    _assert_state_consistent(state)
    assert client.post(f"/api/drafts/{draft_id}/picks", json={"player_id": "p000"}).status_code == 200

    # Edit with an empty body reference must 422, not wipe the pick.
    assert client.put(f"/api/drafts/{draft_id}/picks/1", json={}).status_code == 422
    assert client.get(f"/api/drafts/{draft_id}").json()["picks"][0]["player_id"] == "p000"


# ---------- attack 10: voice endpoint hardening ----------


@pytest.fixture()
def voice_draft(client, patched_pool):
    """A real draft whose voice calls run through the real engine, with team
    names so team-name utterances are resolvable."""
    names = ["Dragons", "Sharks", "Wolves", "Vipers", "Comets", "Bison",
             "Owls", "Hawks", "Foxes", "Bears", "Crows", "Wasps"]
    assert client.put(
        "/api/settings", json={"teams": 12, "my_slot": 5, "team_names": names}
    ).status_code == 200
    return _new_draft(client)


def test_voice_50k_chars_is_bounded_and_clean(client, voice_draft):
    big = ("robert smith jones the third pick " * 1600)[:50_000]
    start = time.time()
    resp = client.post(f"/api/drafts/{voice_draft}/voice", json={"utterance": big})
    elapsed = time.time() - start
    assert resp.status_code == 200
    body = resp.json()
    assert set(body) == {
        "matched", "needs_confirmation", "team_index", "explicit_team",
        "best", "alternatives", "reason",
    }
    # Truncation keeps the fuzzy layers bounded — a 50k body must not be a
    # denial-of-service vector on the sync worker pool.
    assert elapsed < 3.0, f"voice took {elapsed:.2f}s on a 50k utterance"
    # Garbage may fuzzy-match, but it must NEVER be auto-commit eligible.
    if body["matched"]:
        assert body["needs_confirmation"] is True
        assert body["best"]["confidence"] < 0.92


def test_voice_garbage_inputs_clean_never_500(client, voice_draft):
    cases = [
        "",  # empty
        " ",  # whitespace
        "\x00\x01\x02",  # control chars
        "🏈" * 1000,  # emoji
        "Robert'); DROP TABLE picks;--",
        "x" * 50_000,  # one enormous token
        "the Dragons take uh",  # team name + cutoff, no player
    ]
    for utterance in cases:
        resp = client.post(f"/api/drafts/{voice_draft}/voice", json={"utterance": utterance})
        assert resp.status_code == 200, f"{utterance[:30]!r} -> {resp.status_code}"
        body = resp.json()
        if body["matched"]:  # fuzzy noise may match, but never confidently
            assert body["best"]["confidence"] < 0.92
    # missing / wrongly-typed utterance -> validation error, not 500
    assert client.post(f"/api/drafts/{voice_draft}/voice", json={}).status_code == 422
    assert client.post(
        f"/api/drafts/{voice_draft}/voice", json={"utterance": 123}
    ).status_code == 422
    # non-UTF8 body -> framework 4xx, not 500
    resp = client.request(
        "POST",
        f"/api/drafts/{voice_draft}/voice",
        content=b'\xff\xfe{"utterance": "x"}',
        headers={"content-type": "application/json"},
    )
    assert 400 <= resp.status_code < 500
    # the picks table is untouched by all of the above
    assert client.get(f"/api/drafts/{voice_draft}").json()["picks"] == []


def test_voice_utterance_that_is_a_team_name(client, voice_draft):
    resp = client.post(f"/api/drafts/{voice_draft}/voice", json={"utterance": "Dragons"})
    assert resp.status_code == 200
    body = resp.json()
    # "Dragons" names a team, not a player: it must not confidently resolve
    # to some player, and it must never auto-commit.
    if body["matched"]:
        assert body["best"]["confidence"] < 0.92


def test_voice_already_picked_player_is_refused(client, voice_draft):
    assert client.post(
        f"/api/drafts/{voice_draft}/picks", json={"player_id": "p000"}
    ).status_code == 200
    resp = client.post(
        f"/api/drafts/{voice_draft}/voice", json={"utterance": "Alpha000 Beta000"}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["matched"] is False
    assert "already drafted" in body["reason"]
    # and the endpoint never wrote anything
    assert len(client.get(f"/api/drafts/{voice_draft}").json()["picks"]) == 1


def test_voice_pool_uses_draft_settings_snapshot(client, monkeypatch):
    """The voice pool must be fetched with the draft's frozen LeagueSettings
    (never the draft id, never the mutable global settings)."""
    from draftengine.league import LeagueSettings

    pool = make_pool()
    seen: list[object] = []

    def fake_pool(settings):
        seen.append(settings)
        return pool

    monkeypatch.setattr(engine, "get_player_pool", fake_pool)
    draft_id = _new_draft(client)  # snapshot: 12 teams

    # Sabotage the global settings AFTER the draft exists.
    assert client.put("/api/settings", json={"teams": 14, "my_slot": 5}).status_code == 200

    resp = client.post(f"/api/drafts/{draft_id}/voice", json={"utterance": "Alpha000 Beta000"})
    assert resp.status_code == 200
    assert resp.json()["matched"] is True
    voice_settings = [s for s in seen if isinstance(s, LeagueSettings)]
    assert seen and all(isinstance(s, LeagueSettings) for s in seen), (
        f"get_player_pool must receive LeagueSettings, got {[type(s) for s in seen]}"
    )
    assert voice_settings[-1].teams == 12, "voice must use the draft's snapshot settings"
