"""Historical outcome heatmaps: what did each draft round actually return?

For every season that has BOTH cached ADP and season stats (2017-2024),
every drafted QB/RB/WR/TE is matched to that season's actual points by
(norm_name, position). Their realized VORP is actual points minus that
season's actual replacement level, where "how many are startable" comes
from the current league settings (value.replacement_counts) — so the
heatmaps re-price when the league changes shape.

Results are cached at module level keyed by the settings-derived counts
and the source files' mtimes; a data refresh invalidates naturally.
"""

import math

from ..config import data_dir
from ..data import ffc
from ..league import LeagueSettings
from . import dataset
from .value import replacement_counts

HISTORY_YEARS = list(range(2017, 2025))
POSITIONS = ["QB", "RB", "WR", "TE"]
MAX_ROUND = 15

_cache: dict[tuple, tuple[dict | None, dict | None]] = {}


def _cache_key(settings: LeagueSettings) -> tuple:
    counts = replacement_counts(settings)
    stats_path = dataset.season_stats_path()
    adp_mtimes = tuple(
        (year, ffc.adp_path(year).stat().st_mtime if ffc.adp_path(year).exists() else None)
        for year in HISTORY_YEARS
    )
    return (
        settings.teams,
        tuple(sorted(counts.items())),
        str(data_dir()),
        stats_path.stat().st_mtime if stats_path.exists() else None,
        adp_mtimes,
    )


def build_heatmaps(settings: LeagueSettings) -> tuple[dict | None, dict | None]:
    """(vorp_heatmap, hit_rate_heatmap) as schemas.Heatmap dicts, or (None, None)."""
    key = _cache_key(settings)
    if key not in _cache:
        _cache[key] = _build(settings)
    return _cache[key]


def _build(settings: LeagueSettings) -> tuple[dict | None, dict | None]:
    season_stats = dataset.load_season_stats()
    if season_stats is None:
        return (None, None)
    counts = replacement_counts(settings)

    samples: dict[tuple[int, str], list[float]] = {}
    years_used: list[int] = []
    for year in HISTORY_YEARS:
        adp = ffc.load_adp(year)
        if adp is None or adp.empty:
            continue
        year_stats = season_stats[
            (season_stats["season"] == year) & (season_stats["position"].isin(POSITIONS))
        ].copy()
        if year_stats.empty:
            continue
        years_used.append(year)
        year_stats["ppr_points"] = year_stats["ppr_points"].fillna(0.0)

        # Actual points per drafted identity + per-position replacement level.
        points = year_stats.groupby(["norm_name", "position"])["ppr_points"].max().to_dict()
        levels: dict[str, float] = {}
        for pos in POSITIONS:
            pool = sorted(
                year_stats.loc[year_stats["position"] == pos, "ppr_points"].tolist(),
                reverse=True,
            )
            n = counts.get(pos)
            if pool and n:
                levels[pos] = float(pool[min(n, len(pool)) - 1])

        for row in adp.itertuples():
            pos = row.position
            if pos not in POSITIONS:
                continue
            rnd = min(max(1, math.ceil(float(row.adp) / settings.teams)), MAX_ROUND)
            actual = float(points.get((row.norm_name, pos), 0.0))
            samples.setdefault((rnd, pos), []).append(actual - levels.get(pos, 0.0))

    if not years_used:
        return (None, None)

    rows = [f"R{i}" for i in range(1, MAX_ROUND + 1)]
    vorp_values: list[list[float | None]] = []
    hit_values: list[list[float | None]] = []
    for rnd in range(1, MAX_ROUND + 1):
        vorp_row: list[float | None] = []
        hit_row: list[float | None] = []
        for pos in POSITIONS:
            vals = samples.get((rnd, pos))
            if not vals:
                vorp_row.append(None)
                hit_row.append(None)
            else:
                vorp_row.append(round(sum(vals) / len(vals), 1))
                hit_row.append(round(sum(1 for v in vals if v > 0) / len(vals), 3))
        vorp_values.append(vorp_row)
        hit_values.append(hit_row)

    span = f"{min(years_used)}-{max(years_used)}"
    vorp_heatmap = {
        "rows": rows,
        "cols": list(POSITIONS),
        "values": vorp_values,
        "note": (
            f"Average actual points over replacement for players drafted at each "
            f"round and position, {span}."
        ),
    }
    hit_rate_heatmap = {
        "rows": rows,
        "cols": list(POSITIONS),
        "values": hit_values,
        "note": f"Share of picks that finished above replacement level, {span}.",
    }
    return (vorp_heatmap, hit_rate_heatmap)
