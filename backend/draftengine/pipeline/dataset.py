"""Weekly stats -> season totals -> lagged feature table.

Port of the user's build_dataset.py: predict next-season PPR points from
two years of lagged usage/production features plus experience.
"""

import pandas as pd

from ..config import data_dir
from ..names import normalize_name
from ..scoring import ScoringSettings, apply_scoring

SUM_COLS = [
    "completions",
    "attempts",
    "passing_yards",
    "passing_tds",
    "interceptions",
    "carries",
    "rushing_yards",
    "rushing_tds",
    "receptions",
    "targets",
    "receiving_yards",
    "receiving_tds",
    "fumbles_lost",
    "two_pt_conversions",
    "special_teams_tds",
    "fantasy_points",
    "fantasy_points_ppr",
]
MEAN_COLS = ["target_share", "air_yards_share", "wopr"]

# Per-season stats carried into each lag. Usage + production + efficiency.
LAG_FEATURES = [
    "ppr_points",
    "ppg",
    "games",
    "attempts",
    "passing_yards",
    "passing_tds",
    "interceptions",
    "carries",
    "rushing_yards",
    "rushing_tds",
    "targets",
    "receptions",
    "receiving_yards",
    "receiving_tds",
    "target_share",
    "wopr",
    "yards_per_touch",
]


def build_season_stats(weekly: pd.DataFrame) -> pd.DataFrame:
    """Aggregate normalized weekly rows to one row per (player_id, season)."""
    grouped = weekly.groupby(["player_id", "season"])
    agg = grouped.agg(
        games=("week", "nunique"),
        name=("player_display_name", "last"),
        position=("position", "last"),
        team=("recent_team", "last"),
        **{c: (c, "sum") for c in SUM_COLS},
        **{f"{c}": (c, "mean") for c in MEAN_COLS},
    ).reset_index()

    agg["ppr_points"] = agg["fantasy_points_ppr"]
    agg["ppg"] = agg["ppr_points"] / agg["games"].clip(lower=1)
    touches = agg["carries"].fillna(0) + agg["receptions"].fillna(0)
    total_yards = agg["rushing_yards"].fillna(0) + agg["receiving_yards"].fillna(0)
    agg["yards_per_touch"] = (total_yards / touches.clip(lower=1)).where(touches > 0, 0.0)
    agg["norm_name"] = agg["name"].map(normalize_name)

    first_season = agg.groupby("player_id")["season"].min().rename("first_season")
    agg = agg.merge(first_season, on="player_id")
    return agg


def season_points_for(season_stats: pd.DataFrame, scoring: ScoringSettings) -> pd.Series:
    """Season fantasy points under an arbitrary scoring config."""
    return apply_scoring(season_stats, scoring)


def build_features(season_stats: pd.DataFrame, target_seasons: list[int]) -> pd.DataFrame:
    """One row per (player, target season) with lag1/lag2 features.

    A row exists only when the player logged at least one game in
    target_season - 1 (the model does not project rookies or players who
    sat out the prior year — those fall back to ADP in the app).
    The target ppr_points_target is NaN for a not-yet-played season.
    """
    stats = season_stats.set_index(["player_id", "season"])
    rows = []
    for target in target_seasons:
        lag1 = season_stats[season_stats["season"] == target - 1]
        for r in lag1.itertuples():
            row: dict = {
                "player_id": r.player_id,
                "target_season": target,
                "name": r.name,
                "norm_name": r.norm_name,
                "position": r.position,
                "team": r.team,
                "experience": target - r.first_season,
            }
            for feat in LAG_FEATURES:
                row[f"lag1_{feat}"] = getattr(r, feat)
            lag2_key = (r.player_id, target - 2)
            has_lag2 = lag2_key in stats.index
            row["has_lag2"] = int(has_lag2)
            for feat in LAG_FEATURES:
                row[f"lag2_{feat}"] = stats.loc[lag2_key, feat] if has_lag2 else 0.0
            target_key = (r.player_id, target)
            row["ppr_points_target"] = (
                stats.loc[target_key, "ppr_points"] if target_key in stats.index else None
            )
            row["games_target"] = (
                stats.loc[target_key, "games"] if target_key in stats.index else None
            )
            rows.append(row)
    df = pd.DataFrame(rows)
    for pos in ["QB", "RB", "WR", "TE"]:
        df[f"pos_{pos}"] = (df["position"] == pos).astype(int)
    return df


FEATURE_COLUMNS = (
    [f"lag1_{f}" for f in LAG_FEATURES]
    + [f"lag2_{f}" for f in LAG_FEATURES]
    + ["experience", "has_lag2", "pos_QB", "pos_RB", "pos_WR", "pos_TE"]
)


def season_stats_path():
    return data_dir() / "season_stats.parquet"


def features_path():
    return data_dir() / "features.parquet"


def load_season_stats() -> pd.DataFrame | None:
    p = season_stats_path()
    return pd.read_parquet(p) if p.exists() else None


def load_features() -> pd.DataFrame | None:
    p = features_path()
    return pd.read_parquet(p) if p.exists() else None
