"""League settings: teams, scoring, roster slots, draft format.

Stored as one JSON blob in the key_value table; every piece of value math
(replacement levels, VORP, recommendations) reads from here.
"""

from pydantic import BaseModel, Field

from .db import session_scope
from .scoring import ScoringSettings

SETTINGS_KEY = "league_settings"


class RosterSlots(BaseModel):
    qb: int = 1
    rb: int = 2
    wr: int = 2
    te: int = 1
    flex: int = 1
    superflex: int = 0
    k: int = 1
    dst: int = 1
    bench: int = 6

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
