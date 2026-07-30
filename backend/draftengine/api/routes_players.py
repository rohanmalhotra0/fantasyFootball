"""Player career API: per-season history + head-to-head compare.

Response models live here (not in schemas.py) — the player card/compare
views are the only consumers. Reads the season_stats parquet through
dataset.load_season_stats(), memoized at module level keyed by file
mtime (same pattern as pipeline.analysis), so a data refresh
invalidates automatically and repeat requests are free.

Accepted ids:
  * real nflverse ids ('00-0034796')
  * the board's synthetic ADP-only ids ('adp_jamarr_chase') — resolved
    by norm_name; useful when a board row turned out to have history
    under a different id join. The response echoes the requested id so
    the frontend can correlate it with its board rows.
"""

import math

import pandas as pd
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..pipeline import dataset

router = APIRouter(prefix="/api")

NO_STATS_DETAIL = "No season stats yet — run a refresh from the Data page first."

_ADP_PREFIX = "adp_"


# ---------- response models (mirrored in frontend types) ----------


class CareerSeason(BaseModel):
    season: int
    games: int
    ppr_points: float
    ppg: float
    receptions: int
    targets: int
    carries: int


class PlayerCareerResponse(BaseModel):
    player_id: str
    name: str
    position: str
    seasons: list[CareerSeason]


class CompareResponse(BaseModel):
    players: list[PlayerCareerResponse]


# ---------- cached season_stats loader ----------

# (path, mtime) -> frame. One entry; a refresh rewrites the file, the
# key changes, and the frame is reloaded.
_cache: tuple[tuple, pd.DataFrame] | None = None


def _season_stats() -> pd.DataFrame | None:
    global _cache
    path = dataset.season_stats_path()
    if not path.exists():
        return None
    key = (str(path), path.stat().st_mtime)
    if _cache is not None and _cache[0] == key:
        return _cache[1]
    df = dataset.load_season_stats()
    if df is None:
        return None
    _cache = (key, df)
    return df


# ---------- NaN-safe coercion ----------


def _num(value, ndigits: int) -> float:
    """Round to a JSON-safe float: NaN/inf become 0.0, never leak."""
    f = float(value)
    if math.isnan(f) or math.isinf(f):
        return 0.0
    return round(f, ndigits)


def _int(value) -> int:
    """Parquet counting stats are floats in some builds — cast NaN-safely."""
    f = float(value)
    if math.isnan(f) or math.isinf(f):
        return 0
    return int(round(f))


def _text(value) -> str:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return ""
    return str(value)


# ---------- resolution + payload ----------


def _resolve_rows(stats: pd.DataFrame, player_id: str) -> pd.DataFrame:
    """All season rows for the id; empty frame when unresolvable.

    A synthetic 'adp_<norm_name>' board id falls back to a norm_name
    match ('adp_jamarr_chase' -> 'jamarr chase'). Norm names can collide
    across eras, so on a collision we keep the player whose career is
    most recent — the board's ADP rows are current players.
    """
    rows = stats[stats["player_id"] == player_id]
    if rows.empty and player_id.startswith(_ADP_PREFIX):
        norm = player_id[len(_ADP_PREFIX) :].replace("_", " ")
        matches = stats[stats["norm_name"] == norm]
        if not matches.empty:
            latest_id = matches.loc[matches["season"].idxmax(), "player_id"]
            rows = stats[stats["player_id"] == latest_id]
    return rows


def _career(rows: pd.DataFrame, requested_id: str) -> PlayerCareerResponse:
    rows = rows.sort_values("season")
    last = rows.iloc[-1]
    seasons = [
        CareerSeason(
            season=int(r.season),
            games=_int(r.games),
            ppr_points=_num(r.ppr_points, 1),
            ppg=_num(r.ppg, 1),
            receptions=_int(r.receptions),
            targets=_int(r.targets),
            carries=_int(r.carries),
        )
        for r in rows.itertuples()
    ]
    return PlayerCareerResponse(
        player_id=requested_id,
        name=_text(last["name"]),
        position=_text(last["position"]),
        seasons=seasons,
    )


def _not_found_detail(ids: list[str]) -> str:
    shown = ", ".join(f"'{i}'" for i in ids)
    return (
        f"No career stats for {shown} — rookies and ADP-only players "
        "have no NFL seasons on record yet."
    )


# ---------- routes ----------


@router.get("/players/compare", response_model=CompareResponse)
def players_compare(a: str, b: str) -> CompareResponse:
    stats = _season_stats()
    if stats is None:
        raise HTTPException(status_code=404, detail=NO_STATS_DETAIL)
    resolved = [(pid, _resolve_rows(stats, pid)) for pid in (a, b)]
    missing = [pid for pid, rows in resolved if rows.empty]
    if missing:
        raise HTTPException(status_code=404, detail=_not_found_detail(missing))
    return CompareResponse(players=[_career(rows, pid) for pid, rows in resolved])


@router.get("/players/{player_id}/career", response_model=PlayerCareerResponse)
def player_career(player_id: str) -> PlayerCareerResponse:
    stats = _season_stats()
    if stats is None:
        raise HTTPException(status_code=404, detail=NO_STATS_DETAIL)
    rows = _resolve_rows(stats, player_id)
    if rows.empty:
        raise HTTPException(status_code=404, detail=_not_found_detail([player_id]))
    return _career(rows, player_id)
