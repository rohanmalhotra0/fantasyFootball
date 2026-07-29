"""nflverse weekly player stats: download, cache, normalize.

Two source formats:
  2015-2024  player_stats/player_stats_{year}.csv       (offense only)
  2025+      stats_player/stats_player_week_{year}.csv  (all positions, renamed cols)

Everything downstream sees one schema (the 2015-2024 names), QB/RB/WR/TE
only, regular season only.
"""

import os
from pathlib import Path

import httpx
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
        if missing:
            raise ValueError(f"nflverse {year}: missing expected columns {missing}")
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
