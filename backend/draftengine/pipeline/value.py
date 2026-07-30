"""VORP and value math, driven entirely by league settings.

Port of the user's value_analysis.py, generalized: replacement level for a
position = the projected points of the last starter-quality player, where
"how many start" comes from the league's roster slots and team count —
never hardcoded. For a 12-team 1QB/2RB/3WR(flex)/1TE league this lands on
the familiar QB13 / RB28 / WR34 / TE13 (rounded league-size math below).
"""

import pandas as pd

from ..league import LeagueSettings

# Share of FLEX starts by position, league-wide. Calibrated so the default
# 12-team 1QB/2RB/2WR/1TE/1FLEX league reproduces the reference replacement
# levels QB13 / RB28 / WR34 / TE13 exactly.
FLEX_SHARE = {"RB": 0.25, "WR": 0.75, "TE": 0.0}
SUPERFLEX_QB_SHARE = 0.8


def replacement_counts(settings: LeagueSettings) -> dict[str, int]:
    """How many players at each position are 'startable' league-wide."""
    teams = settings.teams
    slots = settings.roster
    counts: dict[str, float] = {
        "QB": teams * slots.qb,
        "RB": teams * slots.rb,
        "WR": teams * slots.wr,
        "TE": teams * slots.te,
        "K": teams * slots.k,
        "DST": teams * slots.dst,
    }
    flex_total = teams * slots.flex
    for pos, share in FLEX_SHARE.items():
        counts[pos] += flex_total * share
    sflex_total = teams * slots.superflex
    counts["QB"] += sflex_total * SUPERFLEX_QB_SHARE
    for pos, share in FLEX_SHARE.items():
        counts[pos] += sflex_total * (1 - SUPERFLEX_QB_SHARE) * share
    # +1: replacement level is the first player BEYOND the startable pool.
    return {pos: int(round(n)) + 1 for pos, n in counts.items() if n > 0}


def replacement_levels(
    projections: pd.DataFrame, settings: LeagueSettings, points_col: str = "projected_points"
) -> dict[str, float]:
    """Projected points of the replacement-level player per position."""
    counts = replacement_counts(settings)
    levels = {}
    for pos, count in counts.items():
        pool = (
            projections[projections["position"] == pos]
            .dropna(subset=[points_col])
            .sort_values(points_col, ascending=False, kind="stable")
            .reset_index(drop=True)
        )
        if pool.empty:
            continue
        idx = min(count - 1, len(pool) - 1)
        levels[pos] = float(pool.loc[idx, points_col])
    return levels


def add_vorp(
    projections: pd.DataFrame, settings: LeagueSettings, points_col: str = "projected_points"
) -> pd.DataFrame:
    """Attach vorp, model_rank, and (when ADP present) value_gap columns."""
    out = projections.copy()
    levels = replacement_levels(out, settings, points_col)
    # A position with no startable slots (or no replacement level) gets its
    # replacement pinned to the position's best player: nobody there can
    # have positive value over replacement.
    pos_max = out.groupby("position")[points_col].transform("max")
    out["replacement_points"] = out["position"].map(levels)
    out["replacement_points"] = out["replacement_points"].fillna(pos_max).fillna(0.0)
    out["vorp"] = out[points_col] - out["replacement_points"]
    out["model_rank"] = (
        out["vorp"].rank(ascending=False, method="first").astype("Int64")
    )
    if "adp_rank" in out.columns:
        out["value_gap"] = out["adp_rank"] - out["model_rank"]
    return out
