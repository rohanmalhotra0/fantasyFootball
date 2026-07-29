"""Central paths and settings.

Everything on disk lives under DATA_DIR so the whole state of the app
(downloads, built datasets, model versions, the SQLite DB) can be wiped
or backed up as one directory. Override with the DRAFTENGINE_DATA_DIR
env var (tests point it at a tmpdir).
"""

import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


def data_dir() -> Path:
    d = Path(os.environ.get("DRAFTENGINE_DATA_DIR", REPO_ROOT / "data"))
    d.mkdir(parents=True, exist_ok=True)
    return d


def cache_dir() -> Path:
    d = data_dir() / "cache"
    d.mkdir(parents=True, exist_ok=True)
    return d


def models_dir() -> Path:
    d = data_dir() / "models"
    d.mkdir(parents=True, exist_ok=True)
    return d


def db_path() -> Path:
    return data_dir() / "draftengine.sqlite3"


# Seasons covered by the pipeline. nflverse player_stats releases cover
# 1999+ with the same legacy URL pattern (see data/nflverse.py for what
# is actually populated per era).
STATS_YEARS = list(range(1999, 2026))
ADP_YEARS = [*range(2017, 2025), 2026]  # 2025 is broken server-side at FFC
CURRENT_SEASON = 2026
