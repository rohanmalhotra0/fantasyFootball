"""Database tables. Created in db.init_db()."""

from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


class KeyValue(Base):
    """Small typed scratch store (league settings, last refresh, active model)."""

    __tablename__ = "key_value"

    key: Mapped[str] = mapped_column(String, primary_key=True)
    value: Mapped[dict] = mapped_column(JSON)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class PlayerEdit(Base):
    """User overrides on the big board: pin, ban, manual rank."""

    __tablename__ = "player_edits"

    player_id: Mapped[str] = mapped_column(String, primary_key=True)
    pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    banned: Mapped[bool] = mapped_column(Boolean, default=False)
    manual_rank: Mapped[int | None] = mapped_column(Integer, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Draft(Base):
    __tablename__ = "drafts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    status: Mapped[str] = mapped_column(String, default="active")  # active | complete
    # Frozen copy of LeagueSettings at draft creation: mid-draft settings
    # changes must not corrupt an in-progress draft.
    settings: Mapped[dict] = mapped_column(JSON)
    rounds: Mapped[int] = mapped_column(Integer)

    picks: Mapped[list["Pick"]] = relationship(
        back_populates="draft", cascade="all, delete-orphan", order_by="Pick.overall"
    )


class Pick(Base):
    __tablename__ = "picks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    draft_id: Mapped[int] = mapped_column(ForeignKey("drafts.id"), index=True)
    overall: Mapped[int] = mapped_column(Integer)  # 1-based overall pick number
    round: Mapped[int] = mapped_column(Integer)
    team_index: Mapped[int] = mapped_column(Integer)  # 1-based drafting team
    player_id: Mapped[str] = mapped_column(String)
    player_name: Mapped[str] = mapped_column(String)
    position: Mapped[str] = mapped_column(String)
    source: Mapped[str] = mapped_column(String, default="manual")  # manual | voice | sim
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    draft: Mapped[Draft] = relationship(back_populates="picks")


class ModelVersionRow(Base):
    """Mirror of the file registry for queryability from the admin API."""

    __tablename__ = "model_versions"

    version: Mapped[str] = mapped_column(String, primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    note: Mapped[str] = mapped_column(String, default="")
    metrics: Mapped[dict] = mapped_column(JSON)
    active: Mapped[bool] = mapped_column(Boolean, default=False)
    spearman_mean: Mapped[float | None] = mapped_column(Float, nullable=True)
