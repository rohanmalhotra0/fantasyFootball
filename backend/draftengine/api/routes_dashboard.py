"""Research dashboard: model trust panel, refresh state, historical heatmaps."""

from fastapi import APIRouter

from ..jobs import refresh
from ..league import load_settings
from ..pipeline import dataset, history, registry
from .schemas import DashboardResponse

router = APIRouter(prefix="/api")

_PRESET_LABELS = {
    "ppr": "PPR",
    "half": "Half-PPR",
    "standard": "Standard",
    "custom": "Custom",
}


@router.get("/dashboard", response_model=DashboardResponse)
def get_dashboard() -> DashboardResponse:
    settings = load_settings()

    versions = registry.list_versions()
    active = next((v for v in versions if v.get("active")), None)
    validation = list(active.get("metrics") or []) if active else []

    data_ready = dataset.features_path().exists() and registry.load_model() is not None
    vorp_heatmap, hit_rate_heatmap = history.build_heatmaps(settings)

    label = _PRESET_LABELS.get(settings.scoring_preset, settings.scoring_preset)
    summary = f"{settings.teams}-team {label} {settings.draft_type}, pick {settings.my_slot}"

    return DashboardResponse(
        validation=validation,
        last_refresh=refresh.last_refresh(),
        model_version=registry.active_version(),
        settings_summary=summary,
        data_ready=data_ready,
        adp_available=vorp_heatmap is not None,
        vorp_heatmap=vorp_heatmap,
        hit_rate_heatmap=hit_rate_heatmap,
    )
