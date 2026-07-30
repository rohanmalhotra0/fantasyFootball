"""League settings: teams, scoring, roster slots, draft format.

Stored as one JSON blob in the key_value table; every piece of value math
(replacement levels, VORP, recommendations) reads from here.
"""

from pydantic import BaseModel, Field, model_validator

from .db import session_scope
from .scoring import ScoringSettings

SETTINGS_KEY = "league_settings"


class RosterSlots(BaseModel):
    qb: int = Field(default=1, ge=0, le=4)
    rb: int = Field(default=2, ge=0, le=8)
    wr: int = Field(default=2, ge=0, le=8)
    te: int = Field(default=1, ge=0, le=4)
    flex: int = Field(default=1, ge=0, le=6)
    superflex: int = Field(default=0, ge=0, le=2)
    k: int = Field(default=1, ge=0, le=2)
    dst: int = Field(default=1, ge=0, le=2)
    bench: int = Field(default=6, ge=0, le=20)

    @model_validator(mode="after")
    def _at_least_one_slot(self) -> "RosterSlots":
        if self.total < 1:
            raise ValueError("roster needs at least one slot")
        return self

    @property
    def starters(self) -> int:
        return self.qb + self.rb + self.wr + self.te + self.flex + self.superflex + self.k + self.dst

    @property
    def total(self) -> int:
        return self.starters + self.bench


class LeagueSettings(BaseModel):
    teams: int = Field(default=12, ge=8, le=16)
    scoring_preset: str = "ppr"  # ppr | half | standard | custom
    scoring: ScoringSettings = ScoringSettings()
    roster: RosterSlots = RosterSlots()
    draft_type: str = "snake"  # snake | auction
    my_slot: int = Field(default=5, ge=1, le=16)
    team_names: list[str] = []

    @model_validator(mode="after")
    def _slot_within_league(self) -> "LeagueSettings":
        # Enforced at model level so bad input surfaces as a 422 field
        # error, never a 500 from save_settings.
        if self.my_slot > self.teams:
            raise ValueError(
                f"my_slot is {self.my_slot} but the league only has {self.teams} teams"
            )
        return self

    def team_name(self, index: int) -> str:
        """1-based team index -> display name."""
        if 0 < index <= len(self.team_names) and self.team_names[index - 1].strip():
            return self.team_names[index - 1]
        return f"Team {index}"


def load_settings() -> LeagueSettings:
    from .orm import KeyValue

    with session_scope() as session:
        row = session.get(KeyValue, SETTINGS_KEY)
        if row is None:
            return LeagueSettings()
        return LeagueSettings.model_validate(row.value)


def save_settings(settings: LeagueSettings) -> LeagueSettings:
    from datetime import datetime

    from .orm import KeyValue

    if settings.my_slot > settings.teams:
        raise ValueError("my_slot cannot exceed team count")
    with session_scope() as session:
        row = session.get(KeyValue, SETTINGS_KEY)
        payload = settings.model_dump()
        if row is None:
            session.add(KeyValue(key=SETTINGS_KEY, value=payload))
        else:
            row.value = payload
            row.updated_at = datetime.utcnow()
    return settings
