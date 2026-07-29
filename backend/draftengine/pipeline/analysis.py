"""Insights: aging curves, weekly consistency, and positional era trends.

Pure pandas functions (compute_*) over the season_stats / weekly frames —
no league settings involved, everything is fixed-PPR descriptive stats.
The public loaders (aging_curves / consistency / position_trends) read the
cached files and memoize at module level keyed by file mtime, so a data
refresh invalidates automatically and repeat requests are free.

Left-censoring: experience = season - first_season, where first_season is
the player's earliest season IN OUR DATA. For players who debuted in the
very first covered season (1999 in a full nflverse history build; 2015
with this repo's cache) the true debut year is unknown — a 10-year vet
looks like a rookie. Those players are excluded from the aging buckets;
everyone debuting after the first covered season has a known debut.
"""

import math

import pandas as pd

from ..data import nflverse
from . import dataset

POSITIONS = ("QB", "RB", "WR", "TE")

# --- aging ---
AGING_MIN_GAMES = 8  # sub-8-game seasons are mostly injuries; they add noise, not signal
EXPERIENCE_CAP = 12  # bucket 12 means "12 or more years in"

# --- consistency ---
CONSISTENCY_MIN_GAMES = 6
BOOM_POINTS = 20.0  # a week you win because of
BUST_POINTS = 5.0  # a week you lose because of

# --- trends ---
# Replacement level = the Nth-best season at the position (a 12-team
# league's streamable baseline): QB13 / RB28 / WR34 / TE13.
REPLACEMENT_CUTOFFS = {"QB": 13, "RB": 28, "WR": 34, "TE": 13}
TOP_N_AVG = 12

# Full-PPR per-stat weights used to split league scoring into pass /
# rush / receiving components (matches ScoringSettings defaults; kept
# literal here so the module stays settings-free).
_PASS_WEIGHTS = {"passing_yards": 0.04, "passing_tds": 4.0, "interceptions": -2.0}
_RUSH_WEIGHTS = {"rushing_yards": 0.1, "rushing_tds": 6.0}
_RECV_WEIGHTS = {"receptions": 1.0, "receiving_yards": 0.1, "receiving_tds": 6.0}


def _num(value, ndigits: int) -> float:
    """Round to a JSON-safe float: NaN/inf become 0.0, never leak."""
    f = float(value)
    if math.isnan(f) or math.isinf(f):
        return 0.0
    return round(f, ndigits)


# ---------------------------------------------------------------- aging


def compute_aging_curves(season_stats: pd.DataFrame) -> dict:
    """Mean/median PPR output by years of experience, per position.

    Only seasons with >= AGING_MIN_GAMES games count, and players whose
    first_season equals the data's first covered season are dropped
    (left-censored: their real debut may predate the data — see module
    docstring). Experience caps at EXPERIENCE_CAP into a "12+" bucket.
    """
    df = season_stats[season_stats["position"].isin(POSITIONS)]
    first_covered = int(df["season"].min())
    df = df[(df["games"] >= AGING_MIN_GAMES) & (df["first_season"] > first_covered)].copy()
    df["exp_bucket"] = (df["season"] - df["first_season"]).clip(upper=EXPERIENCE_CAP)

    positions = []
    for pos in POSITIONS:
        pos_df = df[df["position"] == pos]
        if pos_df.empty:
            continue
        buckets = []
        for exp, grp in pos_df.groupby("exp_bucket"):
            exp = int(exp)
            buckets.append(
                {
                    "experience": exp,
                    "label": f"{exp}+" if exp == EXPERIENCE_CAP else str(exp),
                    "n": int(len(grp)),
                    "mean_points": _num(grp["ppr_points"].mean(), 1),
                    "median_points": _num(grp["ppr_points"].median(), 1),
                    "mean_ppg": _num(grp["ppg"].mean(), 2),
                    "median_ppg": _num(grp["ppg"].median(), 2),
                }
            )
        peak = max(buckets, key=lambda b: b["mean_points"])
        for b in buckets:
            b["ratio_vs_peak"] = (
                _num(b["mean_points"] / peak["mean_points"], 3) if peak["mean_points"] > 0 else 0.0
            )
        positions.append(
            {"position": pos, "peak_experience": peak["experience"], "buckets": buckets}
        )

    return {
        "positions": positions,
        "min_games": AGING_MIN_GAMES,
        "left_censored_first_season": first_covered,
        "note": (
            f"Seasons with {AGING_MIN_GAMES}+ games only. Players who first appear in "
            f"{first_covered} (the first covered season) are excluded: their real debut "
            "may be earlier, so their experience is unknown (left-censored)."
        ),
    }


# ----------------------------------------------------------- consistency


def compute_consistency(weekly: pd.DataFrame, season: int) -> dict:
    """Week-to-week profile per player for one season.

    Players with >= CONSISTENCY_MIN_GAMES games get: weekly mean, sample
    stdev, coefficient of variation (None when mean <= 0), boom/bust
    rates, and 25th/75th percentile weeks (floor/ceiling).
    """
    df = weekly[(weekly["season"] == season) & (weekly["position"].isin(POSITIONS))]
    players = []
    for pid, grp in df.groupby("player_id"):
        grp = grp.sort_values("week")
        pts = grp["fantasy_points_ppr"].fillna(0.0).astype(float)
        games = int(grp["week"].nunique())
        if games < CONSISTENCY_MIN_GAMES:
            continue
        mean = float(pts.mean())
        stdev = float(pts.std(ddof=1))
        team = grp["recent_team"].iloc[-1]
        players.append(
            {
                "player_id": str(pid),
                "name": str(grp["player_display_name"].iloc[-1]),
                "position": str(grp["position"].iloc[-1]),
                "team": None if pd.isna(team) else str(team),
                "games": games,
                "total_points": _num(pts.sum(), 1),
                "ppg": _num(mean, 2),
                "stdev": _num(stdev, 2),
                "cv": _num(stdev / mean, 3) if mean > 0 else None,
                "boom_rate": _num((pts >= BOOM_POINTS).mean(), 3),
                "bust_rate": _num((pts < BUST_POINTS).mean(), 3),
                "floor": _num(pts.quantile(0.25), 2),
                "ceiling": _num(pts.quantile(0.75), 2),
            }
        )
    players.sort(key=lambda p: -p["ppg"])
    return {
        "season": season,
        "min_games": CONSISTENCY_MIN_GAMES,
        "boom_threshold": BOOM_POINTS,
        "bust_threshold": BUST_POINTS,
        "players": players,
    }


# ---------------------------------------------------------------- trends


def compute_position_trends(season_stats: pd.DataFrame) -> dict:
    """League-wide scoring structure by season.

    Per season: each position's total PPR points and share of all points,
    the average of its top-12 seasons, its replacement-level points (the
    REPLACEMENT_CUTOFFS[pos]-th best season, or the worst available when
    fewer players exist), plus the pass/rush/receiving split of scoring.
    """
    df = season_stats[season_stats["position"].isin(POSITIONS)]
    seasons = []
    for season, sdf in df.groupby("season"):
        total = float(sdf["ppr_points"].sum())
        positions = {}
        for pos in POSITIONS:
            pts = sdf.loc[sdf["position"] == pos, "ppr_points"].sort_values(ascending=False)
            if pts.empty:
                continue
            cutoff = min(REPLACEMENT_CUTOFFS[pos], len(pts))
            positions[pos] = {
                "total_points": _num(pts.sum(), 1),
                "share": _num(pts.sum() / total, 4) if total > 0 else 0.0,
                "top12_avg": _num(pts.head(TOP_N_AVG).mean(), 1),
                "replacement_points": _num(pts.iloc[cutoff - 1], 1),
            }

        def component(weights: dict[str, float], frame: pd.DataFrame = sdf) -> float:
            return float(sum(frame[col].fillna(0).sum() * w for col, w in weights.items()))

        pass_pts = component(_PASS_WEIGHTS)
        rush_pts = component(_RUSH_WEIGHTS)
        recv_pts = component(_RECV_WEIGHTS)
        comp_total = pass_pts + rush_pts + recv_pts
        seasons.append(
            {
                "season": int(season),
                "total_points": _num(total, 1),
                "positions": positions,
                "pass_share": _num(pass_pts / comp_total, 4) if comp_total > 0 else 0.0,
                "rush_share": _num(rush_pts / comp_total, 4) if comp_total > 0 else 0.0,
                "receiving_share": _num(recv_pts / comp_total, 4) if comp_total > 0 else 0.0,
            }
        )
    return {
        "seasons": seasons,
        "replacement_cutoffs": dict(REPLACEMENT_CUTOFFS),
        "note": (
            "Full-PPR points from cached weekly data. Replacement level = the "
            "QB13 / RB28 / WR34 / TE13 season at each position."
        ),
    }


# ------------------------------------------------- cached public loaders

# name -> (mtime key, computed payload). One entry per name; a refresh
# rewrites the file, the mtime key changes, and the entry is rebuilt.
_cache: dict[str, tuple[tuple, dict]] = {}


def _cached(name: str, key: tuple, build) -> dict:
    hit = _cache.get(name)
    if hit is not None and hit[0] == key:
        return hit[1]
    value = build()
    _cache[name] = (key, value)
    return value


def aging_curves() -> dict | None:
    """Aging curves from the season_stats parquet; None until it exists."""
    path = dataset.season_stats_path()
    if not path.exists():
        return None
    key = (str(path), path.stat().st_mtime)
    return _cached("aging", key, lambda: compute_aging_curves(pd.read_parquet(path)))


def consistency(season: int) -> dict | None:
    """Weekly consistency for one season from the CACHED nflverse file.

    Never downloads at request time: if the season's weekly file is not
    already cached, returns None (the route turns that into a 404).
    """
    path = nflverse.stats_path(season)
    if not path.exists():
        return None
    key = (str(path), path.stat().st_mtime)
    return _cached(
        f"consistency:{season}",
        key,
        lambda: compute_consistency(nflverse.load_weekly([season]), season),
    )


def position_trends() -> dict | None:
    """Era trends from the season_stats parquet; None until it exists."""
    path = dataset.season_stats_path()
    if not path.exists():
        return None
    key = (str(path), path.stat().st_mtime)
    return _cached("trends", key, lambda: compute_position_trends(pd.read_parquet(path)))
