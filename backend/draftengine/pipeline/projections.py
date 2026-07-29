"""Current-season board: model projections + ADP + VORP + tiers + risk.

The board is rebuilt on demand from cached artifacts (features parquet,
active model, cached ADP) and the *current* league settings — so a
settings change instantly re-prices every player.

Scoring awareness: the model is trained on PPR points. For any other
(linear) scoring config we translate each player's projection using his
own prior-season stat mix: ratio = points(lag1 stats, league scoring) /
points(lag1 stats, PPR). A low-reception RB keeps ~his projection in
standard scoring while a target hog loses more — transparent, testable,
and it keeps VORP/replacement math consistent with the league settings.
"""

import numpy as np
import pandas as pd

from ..config import CURRENT_SEASON, data_dir
from ..league import LeagueSettings
from ..scoring import ScoringSettings, apply_scoring
from .dataset import FEATURE_COLUMNS, load_features, load_season_stats
from .registry import active_version, load_model
from .tiers import assign_tiers, risk_flags
from .value import add_vorp

BOARD_COLUMNS = [
    "player_id",
    "name",
    "position",
    "team",
    "projected_points",
    "vorp",
    "model_rank",
    "adp",
    "adp_stdev",
    "adp_rank",
    "value_gap",
    "tier",
    "risk_flag",
    "unmodeled",
    "experience",
    "lag1_games",
    "lag1_ppr_points",
]

_INT_COLUMNS = ["model_rank", "adp_rank", "value_gap", "tier"]

# mtime-keyed caches: build_board runs on every pick during a live draft.
_cache: dict[str, tuple[float, object]] = {}


def _cached(path, loader):
    key = str(path)
    try:
        mtime = path.stat().st_mtime
    except FileNotFoundError:
        _cache.pop(key, None)
        return None
    hit = _cache.get(key)
    if hit and hit[0] == mtime:
        return hit[1]
    value = loader()
    _cache[key] = (mtime, value)
    return value


def build_board(settings: LeagueSettings, season: int = CURRENT_SEASON) -> pd.DataFrame | None:
    """Returns the scored board or None when pipeline artifacts are missing."""
    features = _cached(data_dir() / "features.parquet", load_features)
    model_version = active_version()
    model = _cached(
        data_dir() / "models" / str(model_version) / "model.json", load_model
    ) if model_version else None
    if features is None or model is None:
        return None
    rows = features[features["target_season"] == season].copy()
    if rows.empty:
        return None
    rows["projected_points"] = model.predict(rows[FEATURE_COLUMNS]).astype(float)
    rows["projected_points"] *= _scoring_ratio(rows, settings, season)

    adp = _load_current_adp(settings, season)
    if adp is not None:
        adp = adp.drop_duplicates(subset=["norm_name", "position"], keep="first")
        rows = rows.merge(
            adp[["norm_name", "position", "name", "adp", "adp_stdev", "adp_rank"]].rename(
                columns={"name": "adp_name"}
            ),
            on=["norm_name", "position"],
            how="outer",
        )
        # ADP-only rows are rookies / returners the model can't project;
        # they stay on the board with ADP info and no projection.
        rows["unmodeled"] = rows["player_id"].isna()
        missing_name = rows["name"].isna()
        rows.loc[missing_name, "name"] = rows.loc[missing_name, "adp_name"]
        missing_id = rows["player_id"].isna()
        rows.loc[missing_id, "player_id"] = "adp_" + rows.loc[
            missing_id, "norm_name"
        ].str.replace(" ", "_", regex=False)
    else:
        rows["unmodeled"] = False

    modeled = rows["projected_points"].notna()
    scored = add_vorp(rows[modeled], settings)
    rest = rows[~modeled].reindex(columns=scored.columns)
    rows = pd.concat([scored, rest], ignore_index=True)

    modeled_mask = rows["projected_points"].notna()
    rows["tier"] = (
        assign_tiers(rows[modeled_mask]).reindex(rows.index)
        if modeled_mask.any()
        else np.nan
    )
    rows["risk_flag"] = (
        risk_flags(rows).fillna(False) if "lag1_games" in rows.columns else False
    )

    for col in BOARD_COLUMNS:
        if col not in rows.columns:
            rows[col] = None

    board = rows[BOARD_COLUMNS + ["norm_name"]].copy()
    # Sort: modeled players by VORP; ADP-only rows interleave nowhere near
    # the bottom — give them a sort key from their ADP neighbourhood.
    board["_sort"] = board["vorp"].astype(float)
    if board["_sort"].isna().any() and board["adp_rank"].notna().any():
        modeled_sorted = board[board["_sort"].notna()].sort_values("_sort", ascending=False)
        vorp_by_rank = modeled_sorted["_sort"].to_numpy()
        unmod = board["_sort"].isna() & board["adp_rank"].notna()
        idx = board.loc[unmod, "adp_rank"].astype(float).clip(1, len(vorp_by_rank)).astype(int) - 1
        board.loc[unmod, "_sort"] = vorp_by_rank[idx.to_numpy()] - 0.01 if len(vorp_by_rank) else 0.0
    board = board.sort_values(
        ["_sort", "adp"], ascending=[False, True], na_position="last", kind="stable"
    ).drop(columns=["_sort"]).reset_index(drop=True)

    # JSON/pydantic safety: int-typed columns become nullable Int64, float
    # NaN -> None happens at the API layer, string NaN -> None here.
    for col in _INT_COLUMNS:
        board[col] = pd.to_numeric(board[col], errors="coerce").round().astype("Int64")
    board["team"] = board["team"].where(board["team"].notna(), None)
    board["unmodeled"] = board["unmodeled"].fillna(False).astype(bool)
    board["risk_flag"] = board["risk_flag"].fillna(False).astype(bool)
    return board


def _scoring_ratio(rows: pd.DataFrame, settings: LeagueSettings, season: int) -> pd.Series:
    """Per-player projection multiplier translating PPR -> league scoring."""
    if settings.scoring == ScoringSettings():  # default full PPR: no-op
        return pd.Series(1.0, index=rows.index)
    season_stats = _cached(data_dir() / "season_stats.parquet", load_season_stats)
    if season_stats is None:
        return pd.Series(1.0, index=rows.index)
    lag1 = season_stats[season_stats["season"] == season - 1].copy()
    league_pts = apply_scoring(lag1, settings.scoring)
    ppr_pts = apply_scoring(lag1, ScoringSettings())
    ratio = (league_pts / ppr_pts.replace(0, np.nan)).clip(0.5, 1.5)
    lag1 = lag1.assign(_ratio=ratio.fillna(1.0))
    mapped = rows.merge(
        lag1[["player_id", "_ratio"]], on="player_id", how="left"
    )["_ratio"]
    mapped.index = rows.index
    return mapped.fillna(1.0)


def _load_current_adp(settings: LeagueSettings, season: int) -> pd.DataFrame | None:
    from ..data.ffc import load_adp

    scoring = settings.scoring_preset if settings.scoring_preset in ("ppr", "half", "standard") else "ppr"
    ffc_scoring = {"ppr": "ppr", "half": "half-ppr", "standard": "standard"}[scoring]
    for teams in (settings.teams, 12):
        adp = load_adp(season, teams=teams, scoring=ffc_scoring)
        if adp is None and ffc_scoring != "ppr":
            adp = load_adp(season, teams=teams, scoring="ppr")
        if adp is not None:
            return adp
    return None


def board_cache_path():
    return data_dir() / "board.parquet"
