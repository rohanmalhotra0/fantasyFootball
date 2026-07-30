"""nflverse weekly player stats: download, cache, normalize.

Two source formats:
  1999-2024  player_stats/player_stats_{year}.csv       (offense only)
  2025+      stats_player/stats_player_week_{year}.csv  (all positions, renamed cols)

Everything downstream sees one schema (the 1999-2024 names), QB/RB/WR/TE
only, regular season only.

Per-era availability (legacy release; header is a unified 53-column
schema all the way back to 1999, so gaps show up as NaN values, not as
missing columns):

  1999+  full core: completions/attempts, passing/rushing/receiving
         yards + TDs, interceptions, carries, targets, receptions,
         per-phase fumbles-lost and 2pt conversions, special_teams_tds,
         fantasy_points, fantasy_points_ppr. target_share is populated
         for weeks where the team logged targets (~80% of rows, same
         rate as modern years).
  2006+  air_yards_share and wopr (air-yards tracking starts with the
         2006 play-by-play; both are 100% NaN for 1999-2005).

load_weekly is tolerant of columns that are absent from a year's file:
any KEEP_COLUMNS column not present becomes an all-NaN column, except
the REQUIRED_COLUMNS core (identity keys, basic yardage/TD/reception
counting stats, fantasy points) which still hard-fails when missing.
Downstream, NaNs flow into season means (skipped) and lag features
(XGBoost handles NaN natively).
"""

import os
from pathlib import Path

import httpx
import numpy as np
import pandas as pd

from ..config import STATS_YEARS, cache_dir

LEGACY_URL = "https://github.com/nflverse/nflverse-data/releases/download/player_stats/player_stats_{year}.csv"
NEW_URL = "https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_{year}.csv"
NEW_FORMAT_FROM = 2025

FANTASY_POSITIONS = ["QB", "RB", "WR", "TE"]

# new-format column -> legacy column
_RENAMES = {
    "team": "recent_team",
    "passing_interceptions": "interceptions",
    "sacks_suffered": "sacks",
    "sack_yards_lost": "sack_yards",
}

KEEP_COLUMNS = [
    "player_id",
    "player_display_name",
    "position",
    "recent_team",
    "season",
    "week",
    "season_type",
    "completions",
    "attempts",
    "passing_yards",
    "passing_tds",
    "interceptions",
    "sack_fumbles_lost",
    "passing_2pt_conversions",
    "carries",
    "rushing_yards",
    "rushing_tds",
    "rushing_fumbles_lost",
    "rushing_2pt_conversions",
    "receptions",
    "targets",
    "receiving_yards",
    "receiving_tds",
    "receiving_fumbles_lost",
    "receiving_2pt_conversions",
    "target_share",
    "air_yards_share",
    "wopr",
    "special_teams_tds",
    "fantasy_points",
    "fantasy_points_ppr",
]

# Core subset of KEEP_COLUMNS that must exist in every year's file:
# identity keys plus the basic counting stats and fantasy points. Any
# other KEEP_COLUMNS column missing from a year is filled with NaN.
REQUIRED_COLUMNS = [
    "player_id",
    "player_display_name",
    "position",
    "recent_team",
    "season",
    "week",
    "season_type",
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
    "fantasy_points_ppr",
]


class OfflineError(RuntimeError):
    pass


def stats_path(year: int) -> Path:
    return cache_dir() / "nflverse" / f"player_stats_{year}.csv"


def download_stats(year: int, force: bool = False) -> Path:
    path = stats_path(year)
    if path.exists() and not force:
        return path
    if os.environ.get("DRAFTENGINE_OFFLINE"):
        raise OfflineError(f"stats for {year} not cached and DRAFTENGINE_OFFLINE is set")
    url = (NEW_URL if year >= NEW_FORMAT_FROM else LEGACY_URL).format(year=year)
    path.parent.mkdir(parents=True, exist_ok=True)
    with httpx.Client(follow_redirects=True, timeout=120) as client:
        resp = client.get(url)
        resp.raise_for_status()
        path.write_bytes(resp.content)
    return path


def load_weekly(years: list[int] | None = None) -> pd.DataFrame:
    """Load + normalize weekly rows for the given seasons (default: all)."""
    years = years or STATS_YEARS
    frames = []
    for year in years:
        df = pd.read_csv(download_stats(year), low_memory=False)
        df = df.rename(columns={k: v for k, v in _RENAMES.items() if k in df.columns})
        df = df[df["season_type"] == "REG"]
        df = df[df["position"].isin(FANTASY_POSITIONS)]
        missing = [c for c in KEEP_COLUMNS if c not in df.columns]
        missing_required = [c for c in missing if c in REQUIRED_COLUMNS]
        if missing_required:
            raise ValueError(
                f"nflverse {year}: missing required columns {missing_required}"
            )
        for col in missing:  # optional (e.g. advanced-usage) columns -> NaN
            df[col] = np.nan
        frames.append(df[KEEP_COLUMNS])
    out = pd.concat(frames, ignore_index=True)
    # One combined fumbles-lost + 2pt column so scoring stays simple.
    out["fumbles_lost"] = (
        out["sack_fumbles_lost"].fillna(0)
        + out["rushing_fumbles_lost"].fillna(0)
        + out["receiving_fumbles_lost"].fillna(0)
    )
    out["two_pt_conversions"] = (
        out["passing_2pt_conversions"].fillna(0)
        + out["rushing_2pt_conversions"].fillna(0)
        + out["receiving_2pt_conversions"].fillna(0)
    )
    return out
