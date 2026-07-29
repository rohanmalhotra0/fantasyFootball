"""FantasyFootballCalculator ADP client.

The API rejects non-browser user agents, so we always send a desktop UA.
Server-side quirk: year=2025 is broken at FFC (2017-2024 and 2026 work).

Responses are cached as JSON under data/cache/adp/ so drafts and
backtests never hit the network at request time.
"""

import json
import os
from pathlib import Path

import httpx
import pandas as pd

from ..config import cache_dir
from ..names import normalize_name
from .nflverse import OfflineError

API_URL = "https://fantasyfootballcalculator.com/api/v1/adp/{scoring}"
BROWSER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
)
BROKEN_YEARS = {2025}

# FFC position labels -> ours
_POSITIONS = {"QB": "QB", "RB": "RB", "WR": "WR", "TE": "TE", "PK": "K", "DEF": "DST"}


def adp_path(year: int, teams: int = 12, scoring: str = "ppr") -> Path:
    return cache_dir() / "adp" / f"adp_{scoring}_{teams}_{year}.json"


def fetch_adp(year: int, teams: int = 12, scoring: str = "ppr", force: bool = False) -> Path:
    """Download ADP for a season into the cache; returns the cache path."""
    path = adp_path(year, teams, scoring)
    if path.exists() and not force:
        return path
    if year in BROKEN_YEARS:
        raise ValueError(f"FFC ADP for {year} is broken server-side")
    if os.environ.get("DRAFTENGINE_OFFLINE"):
        raise OfflineError(f"ADP {year} not cached and DRAFTENGINE_OFFLINE is set")
    with httpx.Client(timeout=60, headers={"User-Agent": BROWSER_UA}) as client:
        resp = client.get(API_URL.format(scoring=scoring), params={"teams": teams, "year": year})
        resp.raise_for_status()
        body = resp.json()
    if body.get("status") != "Success" or not body.get("players"):
        raise ValueError(f"FFC returned no ADP data for {year}: {body.get('status')}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(body))
    return path


def load_adp(year: int, teams: int = 12, scoring: str = "ppr") -> pd.DataFrame | None:
    """Load cached ADP as a tidy frame, or None when it was never fetched."""
    path = adp_path(year, teams, scoring)
    if not path.exists():
        return None
    body = json.loads(path.read_text())
    rows = []
    for p in body["players"]:
        pos = _POSITIONS.get(p["position"])
        if pos is None:
            continue
        rows.append(
            {
                "adp_player_id": p["player_id"],
                "name": p["name"],
                "norm_name": normalize_name(p["name"]),
                "position": pos,
                "team": p.get("team"),
                "adp": float(p["adp"]),
                "adp_stdev": float(p.get("stdev") or 0.0),
                "high": float(p.get("high") or p["adp"]),
                "low": float(p.get("low") or p["adp"]),
                "times_drafted": int(p.get("times_drafted") or 0),
                "bye": p.get("bye"),
                "season": year,
            }
        )
    df = pd.DataFrame(rows).sort_values("adp").reset_index(drop=True)
    df["adp_rank"] = df.index + 1
    return df
