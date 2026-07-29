"""Insights API: aging curves, weekly consistency, positional era trends.

Response models live here (not in schemas.py) — the Insights page is the
only consumer. All numbers come from pipeline.analysis, which guarantees
JSON-safe floats (no NaN/inf) and does its own mtime-keyed caching.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..pipeline import analysis

router = APIRouter(prefix="/api")

NO_STATS_DETAIL = "No season stats yet — run a refresh from the Data page first."


# ---------- aging ----------


class AgingBucket(BaseModel):
    experience: int
    label: str  # "0".."11", "12+"
    n: int
    mean_points: float
    median_points: float
    mean_ppg: float
    median_ppg: float
    ratio_vs_peak: float  # this bucket's mean_points / the position's peak bucket


class PositionAgingCurve(BaseModel):
    position: str
    peak_experience: int
    buckets: list[AgingBucket]


class AgingCurvesResponse(BaseModel):
    positions: list[PositionAgingCurve]
    min_games: int
    left_censored_first_season: int  # debuts in this season are excluded (unknown true debut)
    note: str


# ---------- consistency ----------


class ConsistencyPlayer(BaseModel):
    player_id: str
    name: str
    position: str
    team: str | None
    games: int
    total_points: float
    ppg: float  # weekly mean
    stdev: float
    cv: float | None  # stdev / mean; None when mean <= 0
    boom_rate: float  # share of weeks >= boom_threshold
    bust_rate: float  # share of weeks < bust_threshold
    floor: float  # 25th percentile week
    ceiling: float  # 75th percentile week


class ConsistencyResponse(BaseModel):
    season: int
    min_games: int
    boom_threshold: float
    bust_threshold: float
    players: list[ConsistencyPlayer]  # sorted by ppg, best first


# ---------- trends ----------


class PositionTrend(BaseModel):
    total_points: float
    share: float  # of all PPR points scored that season
    top12_avg: float
    replacement_points: float


class SeasonTrend(BaseModel):
    season: int
    total_points: float
    positions: dict[str, PositionTrend]
    pass_share: float
    rush_share: float
    receiving_share: float


class TrendsResponse(BaseModel):
    seasons: list[SeasonTrend]
    replacement_cutoffs: dict[str, int]
    note: str


# ---------- routes ----------


@router.get("/analysis/aging", response_model=AgingCurvesResponse)
def analysis_aging() -> AgingCurvesResponse:
    data = analysis.aging_curves()
    if data is None:
        raise HTTPException(status_code=404, detail=NO_STATS_DETAIL)
    return AgingCurvesResponse(**data)


@router.get("/analysis/consistency/{season}", response_model=ConsistencyResponse)
def analysis_consistency(season: int) -> ConsistencyResponse:
    data = analysis.consistency(season)
    if data is None:
        raise HTTPException(
            status_code=404,
            detail=(
                f"Weekly stats for {season} are not cached — "
                "run a refresh where nflverse is reachable."
            ),
        )
    return ConsistencyResponse(**data)


@router.get("/analysis/trends", response_model=TrendsResponse)
def analysis_trends() -> TrendsResponse:
    data = analysis.position_trends()
    if data is None:
        raise HTTPException(status_code=404, detail=NO_STATS_DETAIL)
    return TrendsResponse(**data)
