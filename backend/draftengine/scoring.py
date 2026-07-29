"""League scoring: turn raw stat lines into fantasy points.

All point math flows through ScoringSettings so custom per-stat leagues
work everywhere (season totals, projections, VORP) — never read the
pre-computed fantasy_points_ppr column except as a cross-check.
"""

from pydantic import BaseModel

import pandas as pd


class ScoringSettings(BaseModel):
    pass_yd: float = 0.04
    pass_td: float = 4.0
    interception: float = -2.0
    rush_yd: float = 0.1
    rush_td: float = 6.0
    reception: float = 1.0  # PPR by default; 0.5 = half, 0 = standard
    rec_yd: float = 0.1
    rec_td: float = 6.0
    fumble_lost: float = -2.0
    two_pt: float = 2.0
    special_teams_td: float = 6.0

    @classmethod
    def preset(cls, name: str) -> "ScoringSettings":
        presets = {
            "ppr": cls(),
            "half": cls(reception=0.5),
            "standard": cls(reception=0.0),
        }
        if name not in presets:
            raise ValueError(f"unknown scoring preset: {name}")
        return presets[name]


# stat column -> ScoringSettings field
STAT_WEIGHTS: dict[str, str] = {
    "passing_yards": "pass_yd",
    "passing_tds": "pass_td",
    "interceptions": "interception",
    "rushing_yards": "rush_yd",
    "rushing_tds": "rush_td",
    "receptions": "reception",
    "receiving_yards": "rec_yd",
    "receiving_tds": "rec_td",
    "fumbles_lost": "fumble_lost",
    "two_pt_conversions": "two_pt",
    "special_teams_tds": "special_teams_td",
}


def apply_scoring(stats: pd.DataFrame, scoring: ScoringSettings) -> pd.Series:
    """Compute fantasy points for each row of a stat table.

    Works on any table that has the STAT_WEIGHTS columns (weekly rows or
    season totals — the math is linear so both give identical sums).
    """
    points = pd.Series(0.0, index=stats.index)
    for col, field in STAT_WEIGHTS.items():
        if col in stats.columns:
            points = points + stats[col].fillna(0) * getattr(scoring, field)
    return points
