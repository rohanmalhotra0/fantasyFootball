# PROMPT: Build "DraftEngine" - Fantasy Football Draft Aid Web App

Copy everything below this line into your coding agent (Claude Code recommended).

---

## Role

You are a senior full-stack engineer and ML engineer. Build a production-quality fantasy football drafting aid called DraftEngine. Work in phases. Do not move to the next phase until the current phase passes its acceptance tests. Spin up subagents where supported: one for implementation, one for writing tests, one for adversarial QA that tries to break each feature.

## Product summary

A web app with two modes:

1. Research mode - explore historical data, model backtests, and rankings before draft day
2. Draft room mode - a live drafting aid that tracks every pick (mine and opponents'), shows who is on the clock, recommends my next pick, and updates my team outlook in real time. Includes a voice mode that listens to the draft being called out and logs picks automatically.

## Existing assets (integrate, do not rebuild from scratch)

The user already has a working Python pipeline:
- Data: nflverse weekly player stats 2015-2025
  - 2015-2024: https://github.com/nflverse/nflverse-data/releases/download/player_stats/player_stats_{YEAR}.csv
  - 2025: https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_2025.csv
- ADP: FantasyFootballCalculator API (requires a browser User-Agent header)
  - https://fantasyfootballcalculator.com/api/v1/adp/ppr?teams=12&year={YEAR} (2017-2024 and 2026 work; 2025 is broken server-side)
- Model: XGBoost regressor predicting next-season PPR points from 2 years of lagged usage/production features plus experience. Walk-forward validated 2022-2025. Beats consensus ADP each year (Spearman ~0.52 vs ~0.48 on drafted players).
- Value logic: VORP with replacement levels QB13 / RB28 / WR34 / TE13 for 12-team leagues, plus value_gap = adp_rank - model_rank.

Recreate this pipeline as a proper backend module with tests. Ask the user for their existing scripts (build_dataset.py, train_model.py, value_analysis.py) and port them.

## Tech stack

- Backend: Python, FastAPI, SQLite (upgrade path to Postgres), pandas, XGBoost, APScheduler for data refresh jobs
- Frontend: React + Vite, TypeScript, Tailwind, Recharts for charts
- Voice: browser Web Speech API for speech-to-text (no server cost), with an optional Whisper API fallback toggle
- Tests: pytest for backend, Vitest for frontend units, Playwright for end-to-end
- Real-time: WebSocket between draft room clients and backend

## Accessibility requirement (non-negotiable)

The user has dyslexia and ADHD. Across the whole app:
- High readability: generous font size, strong contrast, short labels, no walls of text
- One primary action visible at a time in the draft room
- Color is never the only signal - always pair with icons or text
- Recommendations must be scannable in under 3 seconds: big card, player name, one-line reason

## Pages and features

### 1. Dashboard (home)
- Cards: model validation summary (year-over-year Spearman vs naive vs ADP), last data refresh time, current league settings, "Enter Draft Room" button
- Value heatmap (avg VORP by round x position, 2017-2024) and hit-rate heatmap rendered from live data, not static images

### 2. Backtest Explorer
- Year selector 2017-2025
- For each year: model rank vs actual finish scatter, ADP vs actual finish scatter, biggest hits and busts tables, per-position error breakdown
- A "what would the model have drafted" simulator: replay any historical year, model auto-drafts from a slot vs ADP-following opponents, show final roster and total points vs league median
- Export any table to CSV

### 3. Rankings / Big Board
- Current-year board: model projection, model VORP, consensus ADP, value_gap, tier (k-means or gap-based tiering on projections), risk flag when the projection is driven by an injured or holdout prior season
- Filters: position, tier, value only. Search with fuzzy matching
- Editable: user can pin, ban, or manually re-rank players. Persist edits

### 4. League Settings
- Teams (8-16), scoring (PPR, half, standard, custom per-stat), roster slots (QB, RB, WR, TE, FLEX, SFLEX, K, DST, bench), snake or auction, my draft slot
- All value math (replacement levels, VORP) must recompute from these settings, not hardcoded

### 5. Draft Room (the core)
- Draft board grid: every team, every pick, snake order, current pick highlighted
- "On the clock" banner with team name and countdown timer
- Next Up panel: top 5 recommendations with a one-line reason each ("Best VORP left", "Last elite TE before cliff", "Fills your RB2 hole")
- Recommendation engine considers: model VORP, positional scarcity (drop-off to next tier), my roster needs, picks until my next turn, and probability each player survives until then (estimate from ADP variance)
- My Team panel: roster slots filling up, projected weekly points, strength/weakness by position vs league average
- Opponent tracker: each team's roster and inferred needs, used to predict their next picks
- Undo, edit, and manual pick entry always available
- Post-draft report: grade my draft, value gained vs ADP per pick, exportable

### 6. Voice Mode (in Draft Room)
- Toggle mic on. App listens continuously
- Parse utterances like "Pick 14, Team 3 takes Bijan Robinson" or just "Bijan Robinson" and log the pick to the current on-the-clock team
- Fuzzy name matching against the remaining player pool (handle Jr, initials, nicknames, mispronunciations via phonetic matching like double metaphone)
- Every voice-logged pick shows a 5-second confirmation toast with an undo button before committing
- Optional spoken response ("You are on the clock, I suggest...") via browser speech synthesis, toggleable
- Must degrade gracefully: if mic permission denied or browser unsupported, hide voice UI and show manual entry

### 7. Data admin
- One-click "refresh data" pulls latest stats and ADP, retrains model, shows new validation numbers before swapping in (never silently replace a model)
- Store every model version with its validation metrics

## Agent workflow and testing (do this, it is not optional)

- Phase 0: scaffold repo, CI running pytest + vitest + playwright on every commit
- Phase 1: data pipeline + model as backend modules. Acceptance: reproduce validation numbers within 0.02 Spearman, all endpoints typed and tested
- Phase 2: Research mode pages. Acceptance: Playwright e2e passes, charts render from API not static files
- Phase 3: League settings + rankings. Acceptance: changing settings changes VORP everywhere, snapshot tests prove it
- Phase 4: Draft room without voice. Acceptance: full 12-team 15-round mock draft simulated by a tester agent via the API and via Playwright clicking the UI, zero desyncs between board, rosters, and recommendations. Undo works at any point
- Phase 5: Voice mode. Acceptance: feed 50 scripted utterances (including 15 with mispronounced or partial names and 5 with background noise transcription errors), at least 45 map to the correct player or trigger the confirmation prompt, never a silent wrong pick
- Phase 6: adversarial QA agent tries: duplicate picks, drafting an already-taken player, refreshing mid-draft (state must persist and restore), two browser tabs open, network drop and reconnect, 16-team superflex settings
- After every phase: run the full regression suite, then write a short changelog entry

## Definition of perfect

- A first-time user can set up their league and finish a live draft with zero instructions
- Every recommendation has a visible reason
- No pick is ever lost: state persists to the database on every event
- Lighthouse accessibility score 95+
- The user can rerun the entire historical backtest from the UI and get the same numbers as the research pipeline

Start with Phase 0 and show me the repo structure before writing feature code.
