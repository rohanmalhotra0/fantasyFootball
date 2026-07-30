"""League settings API.

PUT here is what makes every piece of value math settings-driven: the
board, VORP, and replacement levels are all recomputed from the stored
settings on the next read.
"""

from fastapi import APIRouter, HTTPException

from ..league import LeagueSettings, load_settings, save_settings
from ..pipeline.value import replacement_counts
from .schemas import SettingsResponse

router = APIRouter(prefix="/api")


def _settings_response(settings: LeagueSettings) -> SettingsResponse:
    return SettingsResponse(
        settings=settings,
        replacement_counts=replacement_counts(settings),
        rounds=settings.roster.total,
    )


@router.get("/settings", response_model=SettingsResponse)
def get_settings() -> SettingsResponse:
    return _settings_response(load_settings())


@router.put("/settings", response_model=SettingsResponse)
def put_settings(body: LeagueSettings) -> SettingsResponse:
    if body.my_slot > body.teams:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Your draft slot ({body.my_slot}) cannot be higher than the "
                f"number of teams ({body.teams}). Pick a slot from 1 to {body.teams}."
            ),
        )
    save_settings(body)
    return _settings_response(load_settings())
