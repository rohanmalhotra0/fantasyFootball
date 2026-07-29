"""Current-season board: model projections + ADP + VORP + tiers + risk.

The board is rebuilt on demand from cached artifacts (features parquet,
active model, cached ADP) and the *current* league settings — so a
settings change instantly re-prices every player.
"""

import pandas as pd

from ..config import CURRENT_SEASON, data_dir
from ..league import LeagueSettings
from .dataset import FEATURE_COLUMNS, load_features
from .registry import load_model
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
    "experience",
    "lag1_games",
    "lag1_ppr_points",
]


def build_board(settings: LeagueSettings, season: int = CURRENT_SEASON) -> pd.DataFrame | None:
    """Returns the scored board or None when pipeline artifacts are missing."""
    features = load_features()
    model = load_model()
    if features is None or model is None:
        return None
    rows = features[features["target_season"] == season].copy()
    if rows.empty:
        return None
    rows["projected_points"] = model.predict(rows[FEATURE_COLUMNS])

    adp = _load_current_adp(settings, season)
    if adp is not None:
        rows = rows.merge(
            adp[["norm_name", "position", "adp", "adp_stdev", "adp_rank"]],
            on=["norm_name", "position"],
            how="outer",
            indicator=True,
        )
        # ADP-only rows are rookies / returners the model can't project;
        # they stay on the board with ADP info and no projection.
        adp_only = rows["_merge"] == "right_only"
        rows.loc[adp_only, "projected_points"] = float("nan")
        rows = rows.drop(columns=["_merge"])
        names = adp.set_index(["norm_name", "position"])["name"]
        missing_name = rows["name"].isna()
        keys = list(zip(rows.loc[missing_name, "norm_name"], rows.loc[missing_name, "position"], strict=True))
        rows.loc[missing_name, "name"] = [names.get(k) for k in keys]
        missing_id = rows["player_id"].isna()
        rows.loc[missing_id, "player_id"] = "adp_" + rows.loc[missing_id, "norm_name"].str.replace(" ", "_")

    modeled = rows["projected_points"].notna()
    scored = add_vorp(rows[modeled], settings)
    rows = pd.concat([scored, rows[~modeled]], ignore_index=True)
    rows["tier"] = assign_tiers(rows[rows["projected_points"].notna()]).reindex(rows.index)
    rows["risk_flag"] = risk_flags(rows).fillna(False) if "lag1_games" in rows else False

    for col in BOARD_COLUMNS:
        if col not in rows.columns:
            rows[col] = None
    board = rows[BOARD_COLUMNS].copy()
    board = board.sort_values(
        ["vorp"], ascending=False, na_position="last"
    ).reset_index(drop=True)
    return board


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
