"""Draft room engine: snake order math, pick state machine, player pool.

Zero-desync design: the DB is the single source of truth. Mutations run
one at a time (module lock), commit in a single transaction, and state
is always rebuilt from committed rows — never patched incrementally.
"""

import math
import threading
from dataclasses import dataclass

import pandas as pd
from fastapi import HTTPException
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError, OperationalError

from ..db import get_engine, init_db, session_scope
from ..league import LeagueSettings, load_settings
from ..names import normalize_name
from ..orm import Draft, Pick

# Columns downstream code may rely on even when a data source can't
# provide them (ensure_pool_columns fills missing ones with NaN).
POOL_OPTIONAL_COLUMNS = (
    "projected_points",
    "vorp",
    "model_rank",
    "adp",
    "adp_stdev",
    "adp_rank",
    "tier",
    "risk_flag",
)

# Serializes draft mutations so two concurrent requests can never both
# claim the same overall pick number.
_write_lock = threading.Lock()

# Where a pick may come from. Anything else (fuzz, typos, 10k-char junk)
# is rejected before it can be persisted.
VALID_PICK_SOURCES = ("manual", "voice", "sim")

# Belt-and-suspenders uniqueness: the module lock serializes writers in
# THIS process; these DB indexes make the invariants (one pick per overall
# slot, one pick per player, per draft) hold even against a second writer
# process. IF NOT EXISTS keeps them migration-safe on existing databases
# (orm.py belongs to another workstream, so the indexes are created here
# rather than as table-level constraints).
_PICK_INDEX_DDL = (
    "CREATE UNIQUE INDEX IF NOT EXISTS ux_picks_draft_overall ON picks (draft_id, overall)",
    "CREATE UNIQUE INDEX IF NOT EXISTS ux_picks_draft_player ON picks (draft_id, player_id)",
)


def ensure_pick_indexes() -> None:
    """Create the unique pick indexes once per DB engine (idempotent)."""
    engine_ = get_engine()
    if getattr(engine_, "_pick_indexes_ready", False):
        return
    init_db()
    try:
        with engine_.begin() as conn:
            for ddl in _PICK_INDEX_DDL:
                conn.execute(text(ddl))
    except OperationalError:
        # A legacy DB that already contains duplicate rows cannot take the
        # unique index; the write lock still guarantees in-process safety.
        pass
    engine_._pick_indexes_ready = True


# ---------- small value helpers (shared by recommend/grade) ----------


def float_or_none(v) -> float | None:
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(f) else f


def int_or_none(v) -> int | None:
    f = float_or_none(v)
    return None if f is None else int(f)


def str_or_none(v) -> str | None:
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return None
    return str(v)


def bool_or_false(v) -> bool:
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return False
    return bool(v)


# ---------- snake order ----------


def overall_to_team(overall: int, teams: int) -> int:
    """1-based overall pick number -> 1-based team index (snake order)."""
    r = (overall - 1) // teams + 1
    i = (overall - 1) % teams
    return i + 1 if r % 2 == 1 else teams - i


def overall_to_round(overall: int, teams: int) -> int:
    return (overall - 1) // teams + 1


def next_overall_for_team(after_overall: int, team: int, teams: int, rounds: int) -> int | None:
    """The team's next overall pick strictly after `after_overall`, or None."""
    total = teams * rounds
    for overall in range(max(after_overall, 0) + 1, total + 1):
        if overall_to_team(overall, teams) == team:
            return overall
    return None


# ---------- player pool ----------


def get_player_pool(settings: LeagueSettings) -> pd.DataFrame:
    """Draftable player pool for a draft's settings snapshot.

    Prefers the scored board (projections + ADP + VORP); falls back to the
    latest season of raw stats; 503s when no data exists at all. Tests
    monkeypatch this module-level function — callers must reach it via
    `engine.get_player_pool` attribute access.
    """
    board = None
    try:
        from ..pipeline.projections import build_board

        board = build_board(settings)
    except Exception:  # missing/corrupt artifacts degrade to season stats
        board = None
    if board is not None and not board.empty:
        return board

    from ..pipeline.dataset import load_season_stats

    stats = load_season_stats()
    if stats is not None and not stats.empty:
        latest = stats[stats["season"] == stats["season"].max()]
        pool = latest[["player_id", "name", "norm_name", "position", "team"]].copy()
        # Naive fallback projection: last season's points.
        pool["projected_points"] = latest["ppr_points"].to_numpy()
        return pool.reset_index(drop=True)

    raise HTTPException(status_code=503, detail="no player data — run a data refresh")


def ensure_pool_columns(pool: pd.DataFrame) -> pd.DataFrame:
    """Copy of the pool with norm_name + all optional columns present."""
    pool = pool.copy()
    if "norm_name" not in pool.columns:
        pool["norm_name"] = pool["name"].map(normalize_name)
    for col in POOL_OPTIONAL_COLUMNS:
        if col not in pool.columns:
            pool[col] = float("nan")
    return pool


def resolve_player(pool: pd.DataFrame, player_id: str | None, player_name: str | None) -> dict:
    """Resolve a player reference against the pool.

    By id, else exact normalized-name match, else 404. Fuzzy matching is
    deliberately NOT done here — that is the voice module's job.
    """
    if player_id:
        rows = pool[pool["player_id"] == player_id]
        if rows.empty:
            raise HTTPException(status_code=404, detail=f"unknown player id: {player_id}")
    elif player_name:
        norm = normalize_name(player_name)
        rows = pool[pool["norm_name"] == norm]
        if rows.empty:
            raise HTTPException(
                status_code=404, detail=f"no player found matching '{player_name}'"
            )
    else:
        raise HTTPException(status_code=422, detail="player_id or player_name is required")
    row = rows.iloc[0]
    return {
        "player_id": str(row["player_id"]),
        "name": str(row["name"]),
        "position": str(row["position"]),
    }


# ---------- draft state ----------


@dataclass
class DraftContext:
    """Read-only snapshot of a draft for recommend/grade computations."""

    id: int
    status: str
    rounds: int
    settings: LeagueSettings
    picks: list[dict]  # ordered by overall


def _get_draft(session, draft_id: int) -> Draft:
    draft = session.get(Draft, draft_id)
    if draft is None:
        raise HTTPException(status_code=404, detail=f"draft {draft_id} not found")
    return draft


def _pick_out(p: Pick) -> dict:
    return {
        "overall": p.overall,
        "round": p.round,
        "team_index": p.team_index,
        "player_id": p.player_id,
        "player_name": p.player_name,
        "position": p.position,
        "source": p.source,
    }


def create_draft() -> dict:
    """Create a draft from the CURRENT league settings, frozen at creation.

    Mid-draft settings changes must never affect an active draft, so the
    settings are snapshotted into the draft row.
    """
    init_db()
    settings = load_settings()
    with session_scope() as session:
        draft = Draft(
            settings=settings.model_dump(),
            rounds=settings.roster.total,
            status="active",
        )
        session.add(draft)
        session.flush()
        draft_id = draft.id
    return get_state(draft_id)


def list_drafts() -> list[dict]:
    init_db()
    with session_scope() as session:
        drafts = session.scalars(select(Draft).order_by(Draft.id.desc())).all()
        return [
            {
                "id": d.id,
                "created_at": d.created_at.isoformat(),
                "status": d.status,
                "teams": LeagueSettings.model_validate(d.settings).teams,
                "rounds": d.rounds,
                "picks_made": len(d.picks),
            }
            for d in drafts
        ]


def get_state(draft_id: int) -> dict:
    """Full state snapshot, shaped exactly like schemas.DraftState."""
    with session_scope() as session:
        draft = _get_draft(session, draft_id)
        settings = LeagueSettings.model_validate(draft.settings)
        picks = sorted(draft.picks, key=lambda p: p.overall)
        teams = settings.teams
        rounds = draft.rounds
        total_picks = teams * rounds
        complete = len(picks) >= total_picks
        status = "complete" if complete else "active"
        if draft.status != status:
            draft.status = status  # persisted on session_scope commit
        current_overall = None if complete else len(picks) + 1
        return {
            "id": draft.id,
            "status": status,
            "teams": teams,
            "rounds": rounds,
            "my_slot": settings.my_slot,
            "team_names": [settings.team_name(i) for i in range(1, teams + 1)],
            "settings": settings.model_dump(),
            "current_overall": current_overall,
            "on_clock_team": None if complete else overall_to_team(current_overall, teams),
            "current_round": None if complete else overall_to_round(current_overall, teams),
            "picks": [_pick_out(p) for p in picks],
            "total_picks": total_picks,
        }


def get_context(draft_id: int) -> DraftContext:
    with session_scope() as session:
        draft = _get_draft(session, draft_id)
        return DraftContext(
            id=draft.id,
            status=draft.status,
            rounds=draft.rounds,
            settings=LeagueSettings.model_validate(draft.settings),
            picks=[_pick_out(p) for p in sorted(draft.picks, key=lambda p: p.overall)],
        )


# ---------- mutations ----------


def make_pick(
    draft_id: int,
    player_id: str | None = None,
    player_name: str | None = None,
    team_index: int | None = None,
    source: str = "manual",
) -> dict:
    """Record the next pick. Commits before returning state to broadcast."""
    if source not in VALID_PICK_SOURCES:
        # Reject before touching the DB: nothing absurd may be persisted.
        shown = source if len(source) <= 40 else source[:40] + "…"
        raise HTTPException(
            status_code=422,
            detail=f"invalid pick source {shown!r} — expected one of {VALID_PICK_SOURCES}",
        )
    with _write_lock:
        ensure_pick_indexes()
        try:
            with session_scope() as session:
                draft = _get_draft(session, draft_id)
                settings = LeagueSettings.model_validate(draft.settings)
                teams = settings.teams
                total = teams * draft.rounds
                picks = sorted(draft.picks, key=lambda p: p.overall)
                if draft.status == "complete" or len(picks) >= total:
                    raise HTTPException(
                        status_code=409, detail="draft is complete — undo a pick to make changes"
                    )
                overall = len(picks) + 1
                on_clock = overall_to_team(overall, teams)
                if team_index is not None and team_index != on_clock:
                    raise HTTPException(
                        status_code=409,
                        detail=(
                            f"Team {team_index} is not on the clock — "
                            f"{settings.team_name(on_clock)} (team {on_clock}) is on the clock"
                        ),
                    )
                pool = ensure_pool_columns(get_player_pool(settings))
                player = resolve_player(pool, player_id, player_name)
                dupe = next((p for p in picks if p.player_id == player["player_id"]), None)
                if dupe is not None:
                    raise HTTPException(
                        status_code=409,
                        detail=(
                            f"{player['name']} was already picked "
                            f"(overall #{dupe.overall} by {settings.team_name(dupe.team_index)})"
                        ),
                    )
                session.add(
                    Pick(
                        draft_id=draft_id,
                        overall=overall,
                        round=overall_to_round(overall, teams),
                        team_index=on_clock,
                        player_id=player["player_id"],
                        player_name=player["name"],
                        position=player["position"],
                        source=source,
                    )
                )
            # Transaction committed here (session_scope exit) — safe to snapshot.
        except IntegrityError as exc:
            # Invariant: picks are unique per (draft, overall) and per
            # (draft, player). The write lock makes this unreachable from a
            # single process; the DB index net catches a concurrent writer
            # from another process — surface it as the same 409.
            raise HTTPException(
                status_code=409, detail="pick conflict — that slot or player was just taken"
            ) from exc
    return get_state(draft_id)


def undo_last(draft_id: int) -> dict:
    """Delete the highest-overall pick; reopens a completed draft."""
    with _write_lock:
        with session_scope() as session:
            draft = _get_draft(session, draft_id)
            picks = sorted(draft.picks, key=lambda p: p.overall)
            if not picks:
                raise HTTPException(status_code=409, detail="no picks to undo")
            session.delete(picks[-1])
            if draft.status == "complete":
                draft.status = "active"
    return get_state(draft_id)


def edit_pick(
    draft_id: int,
    overall: int,
    player_id: str | None = None,
    player_name: str | None = None,
) -> dict:
    """Replace the player on an existing pick (fix a mis-logged pick)."""
    with _write_lock:
        ensure_pick_indexes()
        try:
            with session_scope() as session:
                draft = _get_draft(session, draft_id)
                settings = LeagueSettings.model_validate(draft.settings)
                picks = sorted(draft.picks, key=lambda p: p.overall)
                target = next((p for p in picks if p.overall == overall), None)
                if target is None:
                    raise HTTPException(
                        status_code=404,
                        detail=f"no pick at overall #{overall} in draft {draft_id}",
                    )
                pool = ensure_pool_columns(get_player_pool(settings))
                player = resolve_player(pool, player_id, player_name)
                dupe = next(
                    (
                        p
                        for p in picks
                        if p.player_id == player["player_id"] and p.overall != overall
                    ),
                    None,
                )
                if dupe is not None:
                    raise HTTPException(
                        status_code=409,
                        detail=(
                            f"{player['name']} was already picked "
                            f"(overall #{dupe.overall} by {settings.team_name(dupe.team_index)})"
                        ),
                    )
                target.player_id = player["player_id"]
                target.player_name = player["name"]
                target.position = player["position"]
        except IntegrityError as exc:
            # Same invariant as make_pick: the DB uniqueness net converts a
            # cross-process race into a clean conflict, never a 500.
            raise HTTPException(
                status_code=409, detail="pick conflict — that player was just taken"
            ) from exc
    return get_state(draft_id)
