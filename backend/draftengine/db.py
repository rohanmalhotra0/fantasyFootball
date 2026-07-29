"""SQLite via SQLAlchemy.

SQLite is the default store; nothing here is SQLite-specific beyond the
connection URL, so switching to Postgres is a config change.
"""

import threading
from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import db_path


class Base(DeclarativeBase):
    pass


_engine = None
_session_factory = None
_engine_lock = threading.Lock()


def get_engine():
    global _engine, _session_factory
    if _engine is None:
        with _engine_lock:
            if _engine is None:  # double-checked: refresh threads race here
                engine = create_engine(
                    f"sqlite:///{db_path()}",
                    connect_args={"check_same_thread": False},
                )

                @event.listens_for(engine, "connect")
                def _set_sqlite_pragma(dbapi_connection, _):
                    cursor = dbapi_connection.cursor()
                    cursor.execute("PRAGMA journal_mode=WAL")
                    cursor.execute("PRAGMA foreign_keys=ON")
                    cursor.close()

                # Publish the engine last: session_scope gates on _engine,
                # so the factory must exist before _engine is visible.
                _session_factory = sessionmaker(bind=engine, expire_on_commit=False)
                _engine = engine
    return _engine


def reset_engine() -> None:
    """Drop the cached engine (tests switch DRAFTENGINE_DATA_DIR between runs)."""
    global _engine, _session_factory
    if _engine is not None:
        _engine.dispose()
    _engine = None
    _session_factory = None


def init_db() -> None:
    # Import models so their tables are registered on Base before create_all.
    from . import orm  # noqa: F401

    Base.metadata.create_all(get_engine())


@contextmanager
def session_scope() -> Iterator[Session]:
    get_engine()
    session = _session_factory()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
