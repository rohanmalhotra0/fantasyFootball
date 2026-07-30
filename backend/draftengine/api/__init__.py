from importlib import import_module, util

from fastapi import FastAPI

ROUTER_MODULES = (
    "routes_dashboard",
    "routes_backtest",
    "routes_rankings",
    "routes_settings",
    "routes_draft",
    "routes_voice",
    "routes_admin",
    "routes_analysis",
    "routes_players",
)


def register_routes(app: FastAPI) -> None:
    """Attach all routers.

    A router module that does not exist yet is skipped (feature phases land
    incrementally); a router module that exists but fails to import is a
    real bug and must raise loudly, not vanish into a 404.
    """
    for module_name in ROUTER_MODULES:
        if util.find_spec(f"{__package__}.{module_name}") is None:
            continue
        module = import_module(f".{module_name}", __package__)
        app.include_router(module.router)
