# Changelog

## Phase 5 — Voice mode
- Continuous browser speech recognition with auto-restart; server-side
  parsing (team refs, word numbers, filler stripping) and matching
  (normalized exact → fuzzy → double metaphone, nickname aliases).
- 5-second undo toast; auto-commit only at ≥0.92 confidence with a 0.08
  lead, otherwise explicit confirmation with alternatives. Voice can
  never silently log a wrong pick (50-utterance acceptance suite).
- Spoken replies (toggle, persisted); full degradation to manual entry
  when the mic or API is unavailable.

## Phase 4 — Draft room
- Snake draft engine with settings snapshot per draft, strict on-clock
  validation, undo/edit at any depth, DB persistence on every event.
- WebSocket full-state broadcasts; client refetches state before every
  socket resume — reconnects and multi-tab stay in sync by construction.
- Recommendations with one-line reasons (need, tier cliff, survival
  probability from ADP variance, pinned), my-team outlook, opponent
  tracker with inferred needs, post-draft report with letter grade and
  per-pick value vs ADP.

## Phase 3 — Settings + Big Board
- League settings (teams, scoring presets + custom per-stat, roster
  slots incl. superflex, draft slot) drive replacement levels, VORP and
  projections everywhere; live replacement preview in the UI.
- Big Board: fuzzy search, position/tier/value filters, tier badges,
  risk + ADP-only flags, pin/ban/manual re-rank persisted.

## Phase 2 — Research mode
- Dashboard: validation summary (model vs naive vs ADP), refresh state,
  VORP + hit-rate heatmaps computed from historical ADP × results.
- Backtest explorer 2018–2025: rank-vs-finish scatters, hits/busts,
  per-position errors, historical draft replay simulator, CSV export.

## Phase 1 — Pipeline + model
- nflverse weekly stats 2015–2025 (both file formats), FFC ADP client
  (browser UA, seeded fallback), 2-year lagged features + experience.
- XGBoost walk-forward validation 2022–2025; tuned params beat the naive
  baseline all four years (Spearman 0.754/0.714/0.705/0.769) and beat
  ADP on drafted players (ADP ≈ 0.45); staged model registry.

## Phase 0 — Scaffold
- Monorepo: FastAPI backend (uv), React/Vite/TS/Tailwind frontend,
  Playwright e2e. CI: pytest + ruff, tsc + vitest + build, e2e.
- GitHub Pages demo workflow (research mode, read-only, real ADP data).
