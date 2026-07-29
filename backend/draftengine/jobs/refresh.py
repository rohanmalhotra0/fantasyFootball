"""Full data refresh: download -> build -> train -> validate -> stage.

A refreshed model is only STAGED (saved with metrics); it never becomes
active silently. Activation happens in the admin UI after the user sees
the new validation numbers, or via activate=True from the CLI.
"""

import logging
from datetime import datetime, timezone

from ..config import ADP_YEARS, STATS_YEARS
from ..data import ffc, nflverse
from ..db import init_db, session_scope
from ..pipeline import dataset, model, registry

log = logging.getLogger(__name__)

VALIDATION_YEARS = [2022, 2023, 2024, 2025]


def run_full_refresh(activate: bool = False) -> dict:
    init_db()
    summary: dict = {"started_at": datetime.now(timezone.utc).isoformat(), "adp_errors": {}}

    for year in STATS_YEARS:
        nflverse.download_stats(year)
    for year in ADP_YEARS:
        try:
            ffc.fetch_adp(year)
        except Exception as exc:  # ADP is best-effort: FFC breaks, we don't
            summary["adp_errors"][year] = str(exc)
            log.warning("ADP fetch failed for %s: %s", year, exc)

    weekly = nflverse.load_weekly()
    season_stats = dataset.build_season_stats(weekly)
    season_stats.to_parquet(dataset.season_stats_path(), index=False)

    target_seasons = list(range(model.FIRST_TARGET_SEASON, max(STATS_YEARS) + 2))
    features = dataset.build_features(season_stats, target_seasons)
    features.to_parquet(dataset.features_path(), index=False)

    adp_by_year = {y: ffc.load_adp(y) for y in VALIDATION_YEARS}
    results, _ = model.walk_forward_validate(features, VALIDATION_YEARS, adp_by_year)
    metrics = [r.to_dict() for r in results]

    production = model.train_production_model(features)
    version = registry.save_version(production, metrics, dataset.FEATURE_COLUMNS)
    _record_version_row(version, metrics)
    if activate or registry.active_version() is None:
        # First model ever auto-activates (there is nothing to compare
        # against); later refreshes stage only.
        registry.activate(version)
        summary["activated"] = True

    summary["finished_at"] = datetime.now(timezone.utc).isoformat()
    summary["version"] = version
    summary["metrics"] = metrics
    _record_refresh(summary)
    return summary


def _record_version_row(version: str, metrics: list[dict]) -> None:
    from ..orm import ModelVersionRow

    spearmans = [m["spearman_model"] for m in metrics]
    with session_scope() as session:
        session.merge(
            ModelVersionRow(
                version=version,
                metrics={"years": metrics},
                spearman_mean=sum(spearmans) / len(spearmans) if spearmans else None,
            )
        )


def _record_refresh(summary: dict) -> None:
    from ..orm import KeyValue

    with session_scope() as session:
        row = session.get(KeyValue, "last_refresh")
        payload = {
            "finished_at": summary["finished_at"],
            "version": summary.get("version"),
            "adp_errors": {str(k): v for k, v in summary["adp_errors"].items()},
        }
        if row is None:
            session.add(KeyValue(key="last_refresh", value=payload))
        else:
            row.value = payload
            row.updated_at = datetime.utcnow()


def last_refresh() -> dict | None:
    from ..orm import KeyValue

    with session_scope() as session:
        row = session.get(KeyValue, "last_refresh")
        return row.value if row else None
