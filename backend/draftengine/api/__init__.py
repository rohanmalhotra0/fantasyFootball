from fastapi import FastAPI


def register_routes(app: FastAPI) -> None:
    """Attach all routers. Feature routers are added phase by phase."""
    # Imported here so the app factory stays importable while routers are
    # still being built out.
    from importlib import import_module

    for module_name in (
        "routes_dashboard",
        "routes_backtest",
        "routes_rankings",
        "routes_settings",
        "routes_draft",
        "routes_admin",
    ):
        try:
            module = import_module(f".{module_name}", __package__)
        except ModuleNotFoundError:
            continue
        app.include_router(module.router)
