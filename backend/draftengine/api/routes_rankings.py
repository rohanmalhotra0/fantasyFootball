"""Big-board rankings: model board merged with the user's pins/bans/manual ranks.

Sort contract (kept simple and predictable for the UI):
  1. pinned players first, ordered by their effective rank
  2. modeled players by manual_rank (if set) else model_rank
  3. unmodeled (ADP-only) players appended by adp_rank
  4. banned players always last
NaN floats coming out of pandas are sanitized to None before pydantic
sees them (json.dumps would otherwise emit invalid `NaN` literals).
"""

import math
from datetime import datetime

from fastapi import APIRouter

from ..config import CURRENT_SEASON
from ..db import session_scope
from ..league import load_settings
from ..orm import PlayerEdit
from ..pipeline import projections, registry
from .schemas import PlayerEditRequest, RankingsResponse

router = APIRouter(prefix="/api")

_UNRANKED = 10**9  # sorts after every real rank


def _clean_float(value) -> float | None:
    """NaN/inf/None -> None; everything else -> float."""
    if value is None:
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(f) or math.isinf(f):
        return None
    return f


def _clean_int(value) -> int | None:
    f = _clean_float(value)
    return None if f is None else int(round(f))


def _clean_str(value) -> str | None:
    if value is None:
        return None
    if isinstance(value, float) and math.isnan(value):
        return None
    return str(value)


def _clean_bool(value) -> bool:
    if value is None:
        return False
    if isinstance(value, float) and math.isnan(value):
        return False
    return bool(value)


def _load_edits() -> dict[str, PlayerEdit]:
    with session_scope() as session:
        rows = session.query(PlayerEdit).all()
    return {row.player_id: row for row in rows}


def _sort_key(p: dict) -> tuple:
    if p["banned"]:
        group = 3
    elif p["pinned"]:
        group = 0
    elif not p["unmodeled"]:
        group = 1
    else:
        group = 2
    base = p["adp_rank"] if p["unmodeled"] else p["model_rank"]
    if p["manual_rank"] is not None:
        effective, manual_first = p["manual_rank"], 0
    else:
        effective, manual_first = base, 1
    return (
        group,
        effective if effective is not None else _UNRANKED,
        manual_first,
        base if base is not None else _UNRANKED,
    )


def _build_rankings() -> RankingsResponse:
    settings = load_settings()
    board = projections.build_board(settings)
    model_version = registry.active_version()
    if board is None:
        return RankingsResponse(
            players=[], adp_available=False, model_version=model_version, season=CURRENT_SEASON
        )

    edits = _load_edits()
    players: list[dict] = []
    for row in board.to_dict("records"):
        player_id = str(row.get("player_id"))
        edit = edits.get(player_id)
        projected = _clean_float(row.get("projected_points"))
        players.append(
            {
                "player_id": player_id,
                "name": _clean_str(row.get("name")) or player_id,
                "position": _clean_str(row.get("position")) or "",
                "team": _clean_str(row.get("team")),
                "projected_points": projected,
                "vorp": _clean_float(row.get("vorp")),
                "model_rank": _clean_int(row.get("model_rank")),
                "adp": _clean_float(row.get("adp")),
                "adp_rank": _clean_int(row.get("adp_rank")),
                "value_gap": _clean_int(row.get("value_gap")),
                "tier": _clean_int(row.get("tier")),
                "risk_flag": _clean_bool(row.get("risk_flag")),
                "unmodeled": projected is None,
                "pinned": bool(edit.pinned) if edit else False,
                "banned": bool(edit.banned) if edit else False,
                "manual_rank": edit.manual_rank if edit else None,
            }
        )
    players.sort(key=_sort_key)
    return RankingsResponse(
        players=players,
        adp_available=any(p["adp"] is not None for p in players),
        model_version=model_version,
        season=CURRENT_SEASON,
    )


@router.get("/rankings", response_model=RankingsResponse)
def get_rankings() -> RankingsResponse:
    return _build_rankings()


@router.post("/rankings/edits", response_model=RankingsResponse)
def edit_player(body: PlayerEditRequest) -> RankingsResponse:
    with session_scope() as session:
        row = session.get(PlayerEdit, body.player_id)
        if row is None:
            row = PlayerEdit(player_id=body.player_id, pinned=False, banned=False, manual_rank=None)
            session.add(row)
        if body.pinned is not None:
            row.pinned = body.pinned
        if body.banned is not None:
            row.banned = body.banned
        if body.clear_manual_rank:
            row.manual_rank = None
        elif body.manual_rank is not None:
            row.manual_rank = body.manual_rank
        row.updated_at = datetime.utcnow()
    return _build_rankings()
