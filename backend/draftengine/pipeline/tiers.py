"""Tiering + risk flags for the big board."""

import numpy as np
import pandas as pd

MAX_TIERS = 8


def assign_tiers(board: pd.DataFrame, points_col: str = "projected_points") -> pd.Series:
    """Gap-based tiers within each position.

    A new tier starts where the drop to the next player exceeds the
    position's typical gap (mean + 1 std of consecutive drops among the
    top 40). Deterministic, explainable, and stable — preferred over
    k-means because tier edges land exactly on the visible cliffs.
    """
    tiers = pd.Series(1, index=board.index, dtype=int)
    for _, group in board.groupby("position"):
        ordered = group.sort_values(points_col, ascending=False)
        pts = ordered[points_col].to_numpy()
        if len(pts) < 3:
            continue
        top = pts[: min(len(pts), 40)]
        drops = -np.diff(top)
        threshold = max(float(drops.mean() + drops.std()), 1e-6)
        tier = 1
        out = [1]
        for d in -np.diff(pts):
            if d > threshold and tier < MAX_TIERS:
                tier += 1
            out.append(tier)
        tiers.loc[ordered.index] = out
    return tiers


def risk_flags(board: pd.DataFrame) -> pd.Series:
    """Flag projections leaning on an injury/holdout-shortened season.

    True when last season was short (<= 10 games) but the season before
    showed real involvement — the model is extrapolating from limited
    recent evidence.
    """
    short_lag1 = board["lag1_games"].fillna(0) <= 10
    real_lag2 = board["has_lag2"].astype(bool) & (board["lag2_games"].fillna(0) >= 8)
    return (short_lag1 & real_lag2).fillna(False)
