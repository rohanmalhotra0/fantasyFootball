# DraftEngine

A fantasy football drafting aid with two modes:

1. **Research mode** — historical data, model backtests, rankings.
2. **Draft room mode** — live draft tracking, pick recommendations, voice pick entry.

## Quick start

```bash
make setup     # install backend (uv) + frontend (npm) deps
make data      # download nflverse stats + FFC ADP, build dataset, train model
make dev       # run backend :8000 + frontend :5173 together
```

Open http://localhost:5173.

## Layout

```
backend/    FastAPI app, data pipeline, model, draft engine  (Python 3.11, uv)
frontend/   React + Vite + TypeScript + Tailwind + Recharts
e2e/        Playwright end-to-end tests
data/       local cache of downloads, datasets, model versions (gitignored)
```

## Commands

| Command              | What it does                                    |
| -------------------- | ----------------------------------------------- |
| `make setup`         | install all dependencies                        |
| `make dev`           | backend + frontend dev servers                  |
| `make data`          | fetch data, build dataset, train + validate     |
| `make test`          | pytest + vitest                                 |
| `make e2e`           | Playwright end-to-end suite                     |
| `make lint`          | ruff + tsc --noEmit                             |

## Data sources

- **Weekly player stats** — nflverse releases, 2015–2025.
- **ADP** — FantasyFootballCalculator API (needs a browser User-Agent; 2025
  is broken server-side, 2017–2024 and 2026 work).

Both are fetched by `make data` / the Data Admin page and cached under
`data/cache/`. Nothing in the app reads from a network at request time.

## Accessibility

Built for readability first: large type, strong contrast, short labels,
one primary action at a time in the draft room, and color is never the only
signal. See `frontend/src/styles/README.md`.
