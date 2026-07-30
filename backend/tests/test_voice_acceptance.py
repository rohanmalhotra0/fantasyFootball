"""Acceptance suite for the voice endpoint.

50 utterances against a ~120-player pool. The bar:
  (a) >= 45/50 resolve correctly (match, or confirmation with the correct
      player among best+alternatives, or matched=False for garbage)
  (b) ZERO silent wrongs: no auto-commit-eligible response (conf >= 0.92,
      lead >= 0.08) whose best player is not the expected one
  (c) every noisy/garbage line is matched=False (or correct)

Plus endpoint behavior tests: already-drafted, team mismatch, defaults.
"""

import pandas as pd
import pytest

import draftengine.api.routes_voice as routes_voice
from draftengine.api.schemas import DraftState, PickOut
from draftengine.league import LeagueSettings
from draftengine.names import normalize_name

# ---------- fixed pool: ~60 stars + ~60 fillers ----------

STARS = [
    ("Bijan Robinson", "RB"), ("Christian McCaffrey", "RB"), ("Ja'Marr Chase", "WR"),
    ("Davante Adams", "WR"), ("Tyreek Hill", "WR"), ("Amon-Ra St. Brown", "WR"),
    ("CeeDee Lamb", "WR"), ("Jahmyr Gibbs", "RB"), ("Breece Hall", "RB"),
    ("Justin Jefferson", "WR"), ("A.J. Brown", "WR"), ("Kenneth Walker III", "RB"),
    ("Marvin Harrison Jr.", "WR"), ("De'Von Achane", "RB"), ("Saquon Barkley", "RB"),
    ("Josh Allen", "QB"), ("Lamar Jackson", "QB"), ("Patrick Mahomes", "QB"),
    ("Travis Kelce", "TE"), ("Sam LaPorta", "TE"), ("Puka Nacua", "WR"),
    ("Garrett Wilson", "WR"), ("Nico Collins", "WR"), ("Rashee Rice", "WR"),
    ("Isiah Pacheco", "RB"), ("James Cook", "RB"), ("Kyren Williams", "RB"),
    ("Jonathan Taylor", "RB"), ("Alvin Kamara", "RB"), ("Derrick Henry", "RB"),
    ("Josh Jacobs", "RB"), ("Travis Etienne", "RB"), ("Aaron Jones", "RB"),
    ("James Conner", "RB"), ("DJ Moore", "WR"), ("DK Metcalf", "WR"),
    ("Marquise Brown", "WR"), ("Tank Dell", "WR"), ("DeVonta Smith", "WR"),
    ("Tee Higgins", "WR"), ("Chris Olave", "WR"), ("Drake London", "WR"),
    ("Jaylen Waddle", "WR"), ("Deebo Samuel", "WR"), ("George Kittle", "TE"),
    ("Mark Andrews", "TE"), ("Trey McBride", "TE"), ("Jalen Hurts", "QB"),
    ("Joe Burrow", "QB"), ("Justin Herbert", "QB"), ("C.J. Stroud", "QB"),
    ("Jordan Love", "QB"), ("Stefon Diggs", "WR"), ("Mike Evans", "WR"),
    ("Chris Godwin", "WR"), ("Calvin Ridley", "WR"), ("Zay Flowers", "WR"),
    ("Brian Robinson Jr.", "RB"), ("Michael Pittman Jr.", "WR"), ("Cooper Kupp", "WR"),
    ("Terry McLaurin", "WR"), ("Rachaad White", "RB"),
]

FILLERS = [
    ("Marcus Ashford", "RB"), ("Trent Bellamy", "WR"), ("Cole Caruthers", "TE"),
    ("Wade Draper", "QB"), ("Reid Fairbanks", "RB"), ("Miles Granger", "WR"),
    ("Owen Hollis", "TE"), ("Blake Ingraham", "QB"), ("Shane Jessup", "RB"),
    ("Grant Kirkwood", "WR"), ("Dean Lachlan", "TE"), ("Ross Mercer", "QB"),
    ("Paul Norwood", "RB"), ("Seth Ogden", "WR"), ("Neil Pemberton", "TE"),
    ("Carl Quimby", "QB"), ("Evan Rutledge", "RB"), ("Troy Sablan", "WR"),
    ("Gene Thorne", "TE"), ("Hank Underwood", "QB"), ("Raul Vasquez", "RB"),
    ("Kurt Wexford", "WR"), ("Dale Yancey", "TE"), ("Bruce Zeller", "QB"),
    ("Glen Abernathy", "RB"), ("Todd Bickford", "WR"), ("Rex Crandall", "TE"),
    ("Vince Dunmore", "QB"), ("Hal Eastman", "RB"), ("Curt Falkner", "WR"),
    ("Wes Gorman", "TE"), ("Ray Hutchins", "QB"), ("Sid Irwin", "RB"),
    ("Max Jarrell", "WR"), ("Ned Knowles", "TE"), ("Vern Loxley", "QB"),
    ("Gus Marchetti", "RB"), ("Ivan Nesbitt", "WR"), ("Burt Ostrander", "TE"),
    ("Cliff Pafford", "QB"), ("Dirk Quiller", "RB"), ("Emil Renner", "WR"),
    ("Fritz Stroman", "TE"), ("Gil Tibbets", "QB"), ("Hugh Upshaw", "RB"),
    ("Ike Vandermeer", "WR"), ("Joel Wickham", "TE"), ("Karl Yarborough", "QB"),
    ("Lyle Zabel", "RB"), ("Milo Colfax", "WR"), ("Nate Denholm", "TE"),
    ("Otis Eversole", "QB"), ("Pete Farnsworth", "RB"), ("Quinn Garvey", "WR"),
    ("Rolf Hadley", "TE"), ("Stan Iverson", "QB"), ("Toby Jenks", "RB"),
    ("Uri Kestrel", "WR"),
]

TEAM_NAMES = [
    "Dragons", "Sharks", "Wolves", "Eagles Nest", "Team Rocket", "Vipers",
    "Golden Bears", "Night Owls", "Red Storm", "Iron Wolves", "Blue Crew",
    "The Hammers",
]
ON_CLOCK = 5


def build_pool() -> pd.DataFrame:
    rows = [
        {
            "player_id": f"p{i:03d}",
            "name": name,
            "norm_name": normalize_name(name),
            "position": pos,
        }
        for i, (name, pos) in enumerate(STARS + FILLERS)
    ]
    assert len(rows) >= 115
    return pd.DataFrame(rows)


def build_state(picks: list[PickOut] | None = None, on_clock: int | None = ON_CLOCK) -> DraftState:
    return DraftState(
        id=1,
        status="active",
        teams=12,
        rounds=15,
        my_slot=5,
        team_names=TEAM_NAMES,
        settings=LeagueSettings(teams=12, my_slot=5, team_names=TEAM_NAMES),
        current_overall=(len(picks) + 1 if picks is not None else 1) if on_clock else None,
        on_clock_team=on_clock,
        current_round=1,
        picks=picks or [],
        total_picks=180,
    )


def stub_engine(monkeypatch, state: DraftState, pool: pd.DataFrame) -> None:
    monkeypatch.setattr(routes_voice, "_get_state", lambda draft_id: state)
    monkeypatch.setattr(routes_voice, "_get_player_pool", lambda draft_id: pool)


def pick_of(pool: pd.DataFrame, name: str, overall: int, team: int) -> PickOut:
    row = pool[pool["name"] == name].iloc[0]
    return PickOut(
        overall=overall,
        round=1,
        team_index=team,
        player_id=row["player_id"],
        player_name=row["name"],
        position=row["position"],
        source="manual",
    )


# ---------- the 50 utterances: (text, expected player or None, kind) ----------

UTTERANCES = [
    # 30 clean, various phrasings incl team prefixes
    ("Bijan Robinson", "Bijan Robinson", "clean"),
    ("Pick 14, Team 3 takes Bijan Robinson", "Bijan Robinson", "clean"),
    ("team seven selects Christian McCaffrey", "Christian McCaffrey", "clean"),
    ("the Dragons take Ja'Marr Chase", "Ja'Marr Chase", "clean"),
    ("Davante Adams to team 4", "Davante Adams", "clean"),
    ("I'll take Tyreek Hill", "Tyreek Hill", "clean"),
    ("next pick is Amon-Ra St. Brown", "Amon-Ra St. Brown", "clean"),
    ("CeeDee Lamb", "CeeDee Lamb", "clean"),
    ("Jahmyr Gibbs", "Jahmyr Gibbs", "clean"),
    ("okay um Breece Hall", "Breece Hall", "clean"),
    ("Justin Jefferson overall", "Justin Jefferson", "clean"),
    ("A.J. Brown", "A.J. Brown", "clean"),
    ("Kenneth Walker III", "Kenneth Walker III", "clean"),
    ("Marvin Harrison Jr.", "Marvin Harrison Jr.", "clean"),
    ("De'Von Achane", "De'Von Achane", "clean"),
    ("Saquon Barkley", "Saquon Barkley", "clean"),
    ("Josh Allen", "Josh Allen", "clean"),
    ("Lamar Jackson", "Lamar Jackson", "clean"),
    ("Patrick Mahomes", "Patrick Mahomes", "clean"),
    ("Travis Kelce", "Travis Kelce", "clean"),
    ("Sam LaPorta", "Sam LaPorta", "clean"),
    ("Puka Nacua", "Puka Nacua", "clean"),
    ("Garrett Wilson", "Garrett Wilson", "clean"),
    ("Nico Collins", "Nico Collins", "clean"),
    ("Rashee Rice", "Rashee Rice", "clean"),
    ("team 2 takes James Cook", "James Cook", "clean"),
    ("so uh Kyren Williams", "Kyren Williams", "clean"),
    ("with the 14th pick Team 6 selects Derrick Henry", "Derrick Henry", "clean"),
    ("Josh Jacobs to the Sharks", "Josh Jacobs", "clean"),
    ("Jonathan Taylor", "Jonathan Taylor", "clean"),
    # 15 mispronounced / partial (STT-realistic corruptions)
    ("jamar chase", "Ja'Marr Chase", "misheard"),
    ("devonte adams", "Davante Adams", "misheard"),
    ("tyreek heel", "Tyreek Hill", "misheard"),
    ("amon ra saint brown", "Amon-Ra St. Brown", "misheard"),
    ("kenneth walker the third", "Kenneth Walker III", "misheard"),
    ("puka nakua", "Puka Nacua", "misheard"),
    ("isaiah pacheco", "Isiah Pacheco", "misheard"),
    ("kyren", "Kyren Williams", "misheard"),
    ("bijan", "Bijan Robinson", "misheard"),
    ("saint brown", "Amon-Ra St. Brown", "misheard"),
    ("cmc", "Christian McCaffrey", "misheard"),
    ("bees on robinson", "Bijan Robinson", "misheard"),
    ("b john robinson", "Bijan Robinson", "misheard"),
    ("mccaffrey", "Christian McCaffrey", "misheard"),
    ("hollywood brown", "Marquise Brown", "misheard"),
    # 5 noisy / garbage / cutoffs
    ("uh the um next pick", None, "garbage"),
    ("asdf qwerty", None, "garbage"),
    ("okay so um", None, "garbage"),
    ("the dragons take uh", None, "garbage"),
    ("sa", None, "garbage"),
]


def _auto_commit_eligible(resp: dict) -> bool:
    """Mirror of the UI policy: would this response auto-commit after 5s?"""
    if not resp["matched"] or resp["best"] is None:
        return False
    best = resp["best"]["confidence"]
    second = resp["alternatives"][0]["confidence"] if resp["alternatives"] else 0.0
    return best >= 0.92 and (best - second) >= 0.08


def _candidate_names(resp: dict) -> list[str]:
    names = []
    if resp["best"] is not None:
        names.append(resp["best"]["name"])
    names.extend(a["name"] for a in resp["alternatives"])
    return names


def _fmt_failure_table(rows: list[tuple]) -> str:
    lines = ["", "utterance                                | expected            | got"]
    lines.append("-" * 100)
    for utterance, expected, resp, why in rows:
        got = resp["best"]["name"] if resp["best"] else "-"
        conf = resp["best"]["confidence"] if resp["best"] else 0.0
        lines.append(
            f"{utterance[:40]:40s} | {str(expected)[:19]:19s} | "
            f"{got} ({conf}) matched={resp['matched']} [{why}]"
        )
    return "\n".join(lines)


def test_fifty_utterance_acceptance(client, monkeypatch):
    pool = build_pool()
    stub_engine(monkeypatch, build_state(), pool)

    failures: list[tuple] = []       # criterion (a)
    silent_wrong: list[tuple] = []   # criterion (b)
    garbage_bad: list[tuple] = []    # criterion (c)

    for utterance, expected, kind in UTTERANCES:
        r = client.post("/api/drafts/1/voice", json={"utterance": utterance})
        assert r.status_code == 200, f"{utterance!r} -> HTTP {r.status_code}"
        resp = r.json()

        if expected is None:
            ok = resp["matched"] is False
            if not ok:
                garbage_bad.append((utterance, expected, resp, "garbage matched"))
        else:
            ok = resp["matched"] and expected in _candidate_names(resp)
        if not ok:
            failures.append((utterance, expected, resp, kind))

        # (b) an auto-commit-eligible answer must never name the wrong player
        if _auto_commit_eligible(resp):
            best_name = resp["best"]["name"]
            if expected is None or best_name != expected:
                silent_wrong.append((utterance, expected, resp, "SILENT WRONG"))

    if failures or silent_wrong or garbage_bad:
        print(_fmt_failure_table(failures + silent_wrong + garbage_bad))

    assert not silent_wrong, f"silent-wrong answers: {_fmt_failure_table(silent_wrong)}"
    assert not garbage_bad, f"garbage matched: {_fmt_failure_table(garbage_bad)}"
    passed = len(UTTERANCES) - len(failures)
    assert passed >= 45, f"only {passed}/50 acceptable: {_fmt_failure_table(failures)}"


# ---------- endpoint behavior ----------


def test_already_drafted_player_is_refused(client, monkeypatch):
    pool = build_pool()
    picks = [pick_of(pool, "Bijan Robinson", 1, 1)]
    stub_engine(monkeypatch, build_state(picks=picks), pool)

    r = client.post("/api/drafts/1/voice", json={"utterance": "Bijan Robinson"})
    resp = r.json()
    assert r.status_code == 200
    assert resp["matched"] is False
    assert resp["best"] is None
    assert resp["reason"] == '"Bijan Robinson" is already drafted'


def test_other_players_still_match_after_picks(client, monkeypatch):
    pool = build_pool()
    picks = [pick_of(pool, "Bijan Robinson", 1, 1)]
    stub_engine(monkeypatch, build_state(picks=picks), pool)

    r = client.post("/api/drafts/1/voice", json={"utterance": "Justin Jefferson"})
    resp = r.json()
    assert resp["matched"] is True
    assert resp["best"]["name"] == "Justin Jefferson"
    # picked players never appear as candidates
    assert "Bijan Robinson" not in _candidate_names(resp)


def test_explicit_team_mismatch_flags_confirmation(client, monkeypatch):
    stub_engine(monkeypatch, build_state(), build_pool())  # team 5 on the clock

    r = client.post("/api/drafts/1/voice", json={"utterance": "Team 3 takes Bijan Robinson"})
    resp = r.json()
    assert resp["matched"] is True
    assert resp["needs_confirmation"] is True
    assert resp["team_index"] == 3
    assert resp["explicit_team"] is True
    assert "Team 3 isn't on the clock — Team 5 is" in resp["reason"]


def test_no_explicit_team_defaults_to_on_clock(client, monkeypatch):
    stub_engine(monkeypatch, build_state(), build_pool())

    r = client.post("/api/drafts/1/voice", json={"utterance": "Bijan Robinson"})
    resp = r.json()
    assert resp["team_index"] == ON_CLOCK
    assert resp["explicit_team"] is False
    assert "isn't on the clock" not in resp["reason"]


def test_matching_explicit_team_has_no_mismatch_note(client, monkeypatch):
    stub_engine(monkeypatch, build_state(), build_pool())

    r = client.post("/api/drafts/1/voice", json={"utterance": "Team 5 takes Bijan Robinson"})
    resp = r.json()
    assert resp["team_index"] == 5
    assert resp["explicit_team"] is True
    assert "isn't on the clock" not in resp["reason"]


def test_empty_utterance_is_polite_no_match(client, monkeypatch):
    stub_engine(monkeypatch, build_state(), build_pool())

    r = client.post("/api/drafts/1/voice", json={"utterance": "uh um okay"})
    resp = r.json()
    assert resp["matched"] is False
    assert resp["needs_confirmation"] is False
    assert resp["best"] is None
    assert resp["alternatives"] == []


def test_low_confidence_asks_for_full_name(client, monkeypatch):
    stub_engine(monkeypatch, build_state(), build_pool())

    r = client.post("/api/drafts/1/voice", json={"utterance": "zzz xxx yyy"})
    resp = r.json()
    assert resp["matched"] is False
    assert resp["reason"] == "No confident match — try the full name"


def test_ambiguous_single_token_demands_confirmation(client, monkeypatch):
    stub_engine(monkeypatch, build_state(), build_pool())

    r = client.post("/api/drafts/1/voice", json={"utterance": "brown"})
    resp = r.json()
    assert resp["matched"] is True
    assert resp["needs_confirmation"] is True
    assert len(resp["alternatives"]) >= 1
    assert not _auto_commit_eligible(resp)  # three Browns -> no 5s auto-commit
    browns = [n for n in _candidate_names(resp) if "Brown" in n]
    assert len(browns) >= 2


def test_response_matches_schema_exactly(client, monkeypatch):
    stub_engine(monkeypatch, build_state(), build_pool())

    r = client.post("/api/drafts/1/voice", json={"utterance": "Bijan Robinson"})
    resp = r.json()
    assert set(resp) == {
        "matched",
        "needs_confirmation",
        "team_index",
        "explicit_team",
        "best",
        "alternatives",
        "reason",
    }
    assert set(resp["best"]) == {"player_id", "name", "position", "confidence"}


def test_endpoint_never_writes_a_pick(client, monkeypatch):
    """The voice endpoint is read-only: state picks are untouched."""
    pool = build_pool()
    state = build_state()
    stub_engine(monkeypatch, state, pool)

    client.post("/api/drafts/1/voice", json={"utterance": "Bijan Robinson"})
    assert state.picks == []
    assert len(pool) == len(STARS) + len(FILLERS)


def test_engine_missing_returns_503(client):
    # Without stubs the lazy import of draftengine.draft.engine decides the
    # outcome: 503 while the engine module doesn't exist yet, otherwise the
    # real engine answers (404 for an unknown draft id is also acceptable).
    r = client.post("/api/drafts/999999/voice", json={"utterance": "Bijan Robinson"})
    assert r.status_code in (404, 503)


def test_confidence_policy_constants():
    # The UI contract: these thresholds are load-bearing for the toast flows.
    assert routes_voice.AUTO_COMMIT_CONFIDENCE == pytest.approx(0.92)
    assert routes_voice.AUTO_COMMIT_LEAD == pytest.approx(0.08)
    assert routes_voice.MATCH_FLOOR == pytest.approx(0.60)
