"""Backtest lab: walk-forward validation of a past season + draft simulation.

The per-year fit takes ~1-2s, so results are cached at module level keyed
by (year, features file, mtime, ADP presence) — the first request pays,
repeats are instant, and a data refresh invalidates via the mtime.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..data import ffc
from ..league import load_settings
from ..pipeline import dataset, model
from .schemas import (
    BacktestYearResponse,
    HitBustRow,
    ScatterPoint,
    SimulationRequest,
    SimulationResponse,
    YearMetrics,
)

router = APIRouter(prefix="/api")

BACKTEST_YEARS = list(range(2017, 2026))
TOP_N_FOR_HITS = 100

_year_cache: dict[tuple, BacktestYearResponse] = {}


class BacktestYearsResponse(BaseModel):
    years: list[int]


@router.get("/backtest/years", response_model=BacktestYearsResponse)
def backtest_years() -> BacktestYearsResponse:
    features = dataset.load_features()
    if features is None:
        return BacktestYearsResponse(years=[])
    with_actuals = features[features["ppr_points_target"].notna()]
    seasons = {int(s) for s in with_actuals["target_season"].unique()}
    # A year is backtestable when it has actuals AND there is at least one
    # earlier season with actuals to train on (walk-forward needs history).
    years = [y for y in BACKTEST_YEARS if y in seasons and any(s < y for s in seasons)]
    return BacktestYearsResponse(years=years)


@router.get("/backtest/{year}", response_model=BacktestYearResponse)
def backtest_year(year: int) -> BacktestYearResponse:
    if year not in BACKTEST_YEARS:
        raise HTTPException(status_code=404, detail=f"No backtest data for {year}.")
    fpath = dataset.features_path()
    if not fpath.exists():
        raise HTTPException(status_code=404, detail=f"No backtest data for {year}.")
    adp = ffc.load_adp(year)
    adp_available = adp is not None and not adp.empty
    key = (year, str(fpath), fpath.stat().st_mtime, adp_available)
    if key not in _year_cache:
        features = dataset.load_features()
        try:
            result, holdout = model.validate_year(features, year, adp=adp)
        except ValueError as exc:
            raise HTTPException(
                status_code=404, detail=f"No backtest data for {year}."
            ) from exc
        _year_cache[key] = _build_payload(year, result, holdout, adp if adp_available else None)
    return _year_cache[key]


def _build_payload(year: int, result, holdout, adp) -> BacktestYearResponse:
    holdout = holdout.copy()
    holdout["rank"] = holdout["predicted"].rank(ascending=False, method="first").astype(int)
    holdout["actual_rank"] = (
        holdout["ppr_points_target"].rank(ascending=False, method="first").astype(int)
    )

    model_scatter = [
        ScatterPoint(
            player_id=str(r.player_id),
            name=str(r.name),
            position=str(r.position),
            rank=int(r.rank),
            actual_rank=int(r.actual_rank),
            predicted=float(r.predicted),
            actual=float(r.ppr_points_target),
        )
        for r in holdout.sort_values("rank").itertuples()
    ]

    adp_scatter = None
    if adp is not None:
        merged = holdout.merge(
            adp[["norm_name", "position", "adp_rank"]],
            on=["norm_name", "position"],
            how="inner",
        )
        adp_scatter = [
            ScatterPoint(
                player_id=str(r.player_id),
                name=str(r.name),
                position=str(r.position),
                rank=int(r.adp_rank),
                actual_rank=int(r.actual_rank),
                predicted=float(r.predicted),
                actual=float(r.ppr_points_target),
            )
            for r in merged.sort_values("adp_rank").itertuples()
        ]

    top = holdout[holdout["rank"] <= TOP_N_FOR_HITS].copy()
    top["diff"] = top["actual_rank"] - top["rank"]

    def _rows(frame) -> list[HitBustRow]:
        return [
            HitBustRow(
                name=str(r.name),
                position=str(r.position),
                rank=int(r.rank),
                actual_rank=int(r.actual_rank),
                predicted=float(r.predicted),
                actual=float(r.ppr_points_target),
                diff=int(r.diff),
            )
            for r in frame.itertuples()
        ]

    busts = _rows(top.sort_values("diff", ascending=False).head(10))
    hits = _rows(top.sort_values("diff", ascending=True).head(10))

    return BacktestYearResponse(
        season=year,
        metrics=YearMetrics(**result.to_dict()),
        model_scatter=model_scatter,
        adp_scatter=adp_scatter,
        hits=hits,
        busts=busts,
        adp_available=adp is not None,
    )


@router.post("/backtest/{year}/simulate", response_model=SimulationResponse)
def simulate(year: int, body: SimulationRequest) -> SimulationResponse:
    # Imported lazily: the simulate module ships separately; until it (and
    # its data) are in place this endpoint reports 503, not a crash.
    try:
        from ..pipeline.simulate import simulate_draft
    except ImportError as exc:  # covers ModuleNotFoundError too
        raise HTTPException(status_code=503, detail="simulator warming up") from exc
    try:
        return simulate_draft(year, body.slot, load_settings())
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail="simulator warming up") from exc
