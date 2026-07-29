"""Seed the ADP cache from a board_2026.csv-style export.

The repo carries board_2026.csv (output of the original research pipeline,
containing real FFC PPR ADP for the current season). In environments where
fantasyfootballcalculator.com is unreachable, this seeds the same cache
file that data.ffc.fetch_adp would have written, so value_gap, survival
probabilities, and draft-room math all work. stdev is not in the export,
so we use a documented heuristic (sigma grows with ADP); a real refresh
overwrites this file with true numbers.
"""

import json
from pathlib import Path

import pandas as pd

from ..config import REPO_ROOT
from .ffc import adp_path


def seed_adp_from_board(
    csv_path: Path | None = None, year: int = 2026, teams: int = 12, scoring: str = "ppr"
) -> Path | None:
    csv_path = csv_path or REPO_ROOT / "board_2026.csv"
    if not csv_path.exists():
        return None
    out = adp_path(year, teams, scoring)
    if out.exists():
        return out  # never clobber a real fetch
    board = pd.read_csv(csv_path)
    players = []
    for i, r in enumerate(board.sort_values("adp", kind="stable").itertuples(), start=1):
        players.append(
            {
                "player_id": 900000 + i,
                "name": r.name,
                "position": r.position,
                "team": None,
                "adp": float(r.adp),
                "adp_formatted": "",
                "stdev": round(max(2.0, 0.12 * float(r.adp)), 2),
                "high": float(r.adp),
                "low": float(r.adp),
                "times_drafted": 0,
                "bye": None,
            }
        )
    body = {
        "status": "Success",
        "meta": {"type": "seed", "source": str(csv_path.name), "note": "stdev estimated"},
        "players": players,
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(body))
    return out
