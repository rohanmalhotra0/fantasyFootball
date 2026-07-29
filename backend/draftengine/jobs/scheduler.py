"""APScheduler wiring: nightly data refresh at 06:00.

Opt-in via the DRAFTENGINE_SCHEDULE=1 env var so dev servers and tests
never spawn background jobs. The refreshed model is only staged
(activate=False) — activation stays a human decision in the admin UI.

Integration note (do NOT wire from here): main.py's lifespan should call
start_scheduler() on startup and stop_scheduler() on shutdown:

    from .jobs.scheduler import start_scheduler, stop_scheduler

    @asynccontextmanager
    async def lifespan(app):
        start_scheduler()
        yield
        stop_scheduler()
"""

import logging
import os

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

log = logging.getLogger(__name__)

JOB_ID = "daily-refresh"

_scheduler: BackgroundScheduler | None = None


def _scheduled_refresh() -> None:
    from . import refresh

    try:
        summary = refresh.run_full_refresh(activate=False)
        log.info("scheduled refresh staged model %s", summary.get("version"))
    except Exception:  # never let a bad night kill the scheduler thread
        log.exception("scheduled refresh failed")


def start_scheduler() -> BackgroundScheduler | None:
    """Start the daily refresh scheduler; returns None unless DRAFTENGINE_SCHEDULE=1.

    Idempotent: a second call returns the already-running scheduler.
    """
    global _scheduler
    if os.environ.get("DRAFTENGINE_SCHEDULE") != "1":
        return None
    if _scheduler is not None:
        return _scheduler
    scheduler = BackgroundScheduler(daemon=True)
    scheduler.add_job(
        _scheduled_refresh,
        CronTrigger(hour=6, minute=0),
        id=JOB_ID,
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )
    scheduler.start()
    _scheduler = scheduler
    return scheduler


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
