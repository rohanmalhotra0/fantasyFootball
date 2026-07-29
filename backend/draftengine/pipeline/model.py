"""XGBoost next-season PPR model with walk-forward validation.

Port of the user's train_model.py. For each validation year Y the model
is fit only on rows whose target season is before Y, then scored on Y —
no look-ahead. Baselines: naive (last season's points) and consensus ADP.
"""

from dataclasses import dataclass, field

import numpy as np
import pandas as pd
import xgboost as xgb
from scipy.stats import spearmanr

from .dataset import FEATURE_COLUMNS

# Tuned on target seasons 2019-2021 only (frozen before touching the
# 2022-2025 eval years); beats the naive last-season baseline in all four
# eval years on both all-player and top-200 Spearman. Stronger
# regularization than the original config — the training set is small
# (~2-4k rows), so shallow/slow/heavy-min-child wins.
XGB_PARAMS = {
    "n_estimators": 300,
    "max_depth": 3,
    "learning_rate": 0.03,
    "subsample": 0.7,
    "colsample_bytree": 0.8,
    "min_child_weight": 15,
    "objective": "reg:squarederror",
    "random_state": 42,
    "n_jobs": 4,
}

FIRST_TARGET_SEASON = 2001  # earliest season with two lag years (data starts 1999)


def fit_model(train: pd.DataFrame) -> xgb.XGBRegressor:
    model = xgb.XGBRegressor(**XGB_PARAMS)
    model.fit(train[FEATURE_COLUMNS], train["ppr_points_target"])
    return model


@dataclass
class YearValidation:
    season: int
    n_players: int
    spearman_model: float
    spearman_naive: float
    mae_model: float
    # Drafted-subset comparison (players present in that year's ADP); None
    # when ADP for the year isn't cached.
    n_drafted: int | None = None
    spearman_model_drafted: float | None = None
    spearman_naive_drafted: float | None = None
    spearman_adp_drafted: float | None = None
    per_position: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {k: v for k, v in self.__dict__.items()}


def _spearman(a, b) -> float:
    rho = spearmanr(a, b).statistic
    return float(rho) if not np.isnan(rho) else 0.0


def validate_year(
    features: pd.DataFrame,
    year: int,
    adp: pd.DataFrame | None = None,
) -> tuple[YearValidation, pd.DataFrame]:
    """Train on target seasons < year, score on == year."""
    train = features[
        (features["target_season"] < year) & features["ppr_points_target"].notna()
    ]
    holdout = features[
        (features["target_season"] == year) & features["ppr_points_target"].notna()
    ].copy()
    if train.empty or holdout.empty:
        raise ValueError(f"no data to validate year {year}")

    model = fit_model(train)
    holdout["predicted"] = model.predict(holdout[FEATURE_COLUMNS])
    holdout["naive"] = holdout["lag1_ppr_points"]
    actual = holdout["ppr_points_target"]

    per_position = {}
    for pos, group in holdout.groupby("position"):
        per_position[pos] = {
            "n": int(len(group)),
            "spearman_model": _spearman(group["predicted"], group["ppr_points_target"]),
            "spearman_naive": _spearman(group["naive"], group["ppr_points_target"]),
            "mae_model": float((group["predicted"] - group["ppr_points_target"]).abs().mean()),
        }

    result = YearValidation(
        season=year,
        n_players=int(len(holdout)),
        spearman_model=_spearman(holdout["predicted"], actual),
        spearman_naive=_spearman(holdout["naive"], actual),
        mae_model=float((holdout["predicted"] - actual).abs().mean()),
        per_position=per_position,
    )

    if adp is not None and not adp.empty:
        merged = holdout.merge(
            adp[["norm_name", "position", "adp_rank"]],
            on=["norm_name", "position"],
            how="inner",
        )
        if len(merged) >= 10:
            result.n_drafted = int(len(merged))
            result.spearman_model_drafted = _spearman(
                merged["predicted"], merged["ppr_points_target"]
            )
            result.spearman_naive_drafted = _spearman(
                merged["naive"], merged["ppr_points_target"]
            )
            # ADP is "picked earlier = better", so compare negated rank.
            result.spearman_adp_drafted = _spearman(
                -merged["adp_rank"], merged["ppr_points_target"]
            )

    return result, holdout


def walk_forward_validate(
    features: pd.DataFrame,
    years: list[int],
    adp_by_year: dict[int, pd.DataFrame | None] | None = None,
) -> tuple[list[YearValidation], pd.DataFrame]:
    """Validate each year independently; returns results + all predictions."""
    adp_by_year = adp_by_year or {}
    results = []
    frames = []
    for year in years:
        res, holdout = validate_year(features, year, adp_by_year.get(year))
        results.append(res)
        frames.append(holdout)
    return results, pd.concat(frames, ignore_index=True)


def train_production_model(features: pd.DataFrame) -> xgb.XGBRegressor:
    """Fit on every completed season for current-season predictions."""
    train = features[features["ppr_points_target"].notna()]
    return fit_model(train)


def predict(model: xgb.XGBRegressor, rows: pd.DataFrame) -> np.ndarray:
    return model.predict(rows[FEATURE_COLUMNS])
