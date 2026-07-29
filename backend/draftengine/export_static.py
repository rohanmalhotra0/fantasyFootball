"""Export every research GET endpoint as static JSON for GitHub Pages.

The Pages deployment has no backend, so the frontend (built with
VITE_STATIC_API=1) reads these snapshots instead. Mutating endpoints and
the live draft room are disabled there with a visible read-only notice.

Usage: python -m draftengine.export_static <output_dir>
"""

import json
import sys
from pathlib import Path

from fastapi.testclient import TestClient

from .main import create_app

# GET paths to snapshot; {year} expands over available backtest years.
STATIC_PATHS = [
    "/api/health",
    "/api/dashboard",
    "/api/settings",
    "/api/rankings",
    "/api/backtest/years",
    "/api/admin/models",
    "/api/admin/refresh/status",
]


def export(out_dir: Path) -> list[str]:
    written: list[str] = []
    with TestClient(create_app()) as client:
        paths = list(STATIC_PATHS)
        years_resp = client.get("/api/backtest/years")
        if years_resp.status_code == 200:
            paths += [f"/api/backtest/{y}" for y in years_resp.json().get("years", [])]
        for path in paths:
            resp = client.get(path)
            if resp.status_code != 200:
                print(f"skip {path}: HTTP {resp.status_code}")
                continue
            target = out_dir / f"{path.lstrip('/')}.json"
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(json.dumps(resp.json()))
            written.append(path)
    return written


def main() -> int:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("static-api")
    written = export(out)
    print(f"exported {len(written)} endpoints to {out}")
    return 0 if written else 1


if __name__ == "__main__":
    raise SystemExit(main())
