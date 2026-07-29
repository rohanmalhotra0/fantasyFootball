/**
 * Shared helpers for the DraftEngine e2e suite.
 *
 * All API access goes straight to the backend (http://localhost:8000) via a
 * Playwright APIRequestContext — independent of the browser context, so it
 * keeps working while pages are offline. Types below mirror the subset of
 * backend/draftengine/api/schemas.py the specs need.
 */
import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test'

export const API_BASE = 'http://localhost:8000'

// ---------------------------------------------------------------------------
// API shapes (subset of backend/draftengine/api/schemas.py)
// ---------------------------------------------------------------------------

export interface PickOut {
  overall: number
  round: number
  team_index: number
  player_id: string
  player_name: string
  position: string
  source: string
}

export interface DraftState {
  id: number
  status: string
  teams: number
  rounds: number
  my_slot: number
  team_names: string[]
  current_overall: number | null
  on_clock_team: number | null
  current_round: number | null
  picks: PickOut[]
  total_picks: number
}

export interface Recommendation {
  player_id: string
  name: string
  position: string
  team: string | null
  projected_points: number | null
  vorp: number | null
  adp: number | null
  survival_prob: number | null
  tier: number | null
  risk_flag: boolean
  reason: string
}

export interface RecommendationsResponse {
  on_clock_team: number | null
  my_turn: boolean
  picks_until_my_turn: number | null
  recommendations: Recommendation[]
  adp_available: boolean
}

export interface BoardPlayer {
  player_id: string
  name: string
  position: string
  team: string | null
  vorp: number | null
  model_rank: number | null
  adp: number | null
  tier: number | null
  pinned: boolean
  banned: boolean
}

export interface RankingsResponse {
  players: BoardPlayer[]
  adp_available: boolean
  model_version: string | null
  season: number
}

export interface RosterSlots {
  qb: number
  rb: number
  wr: number
  te: number
  flex: number
  superflex: number
  k: number
  dst: number
  bench: number
}

export interface LeagueSettings {
  teams: number
  scoring_preset: string
  roster: RosterSlots
  draft_type: string
  my_slot: number
  team_names: string[]
}

export interface SettingsResponse {
  settings: LeagueSettings
  replacement_counts: Record<string, number>
  rounds: number
}

export interface MakePickRequest {
  player_id?: string
  player_name?: string
  team_index?: number
  source?: string
}

export interface PlayerEditRequest {
  player_id: string
  pinned?: boolean
  banned?: boolean
  manual_rank?: number
  clear_manual_rank?: boolean
}

/** Defaults from backend/draftengine/league.py (scoring omitted: the backend
 *  fills ScoringSettings defaults, which equal the ppr preset). */
export const DEFAULT_SETTINGS: LeagueSettings = {
  teams: 12,
  scoring_preset: 'ppr',
  roster: { qb: 1, rb: 2, wr: 2, te: 1, flex: 1, superflex: 0, k: 1, dst: 1, bench: 6 },
  draft_type: 'snake',
  my_slot: 5,
  team_names: [],
}

// ---------------------------------------------------------------------------
// Raw API helpers
// ---------------------------------------------------------------------------

async function asJson<T>(respPromise: ReturnType<APIRequestContext['get']>, what: string): Promise<T> {
  const resp = await respPromise
  expect(resp.ok(), `${what} -> HTTP ${resp.status()}`).toBeTruthy()
  return (await resp.json()) as T
}

export async function createDraft(request: APIRequestContext): Promise<DraftState> {
  // The backend schema declares CreateDraftResponse{draft}, while the
  // frontend client types the same call as a bare DraftState — accept both.
  const body = await asJson<DraftState | { draft: DraftState }>(
    request.post(`${API_BASE}/api/drafts`),
    'POST /api/drafts',
  )
  return 'draft' in body ? body.draft : body
}

export async function getDraftState(request: APIRequestContext, draftId: number): Promise<DraftState> {
  return asJson<DraftState>(request.get(`${API_BASE}/api/drafts/${draftId}`), `GET /api/drafts/${draftId}`)
}

export async function makePick(
  request: APIRequestContext,
  draftId: number,
  pick: MakePickRequest,
): Promise<DraftState> {
  return asJson<DraftState>(
    request.post(`${API_BASE}/api/drafts/${draftId}/picks`, { data: pick }),
    `POST /api/drafts/${draftId}/picks (${pick.player_id ?? pick.player_name})`,
  )
}

export async function undoLastPick(request: APIRequestContext, draftId: number): Promise<DraftState> {
  return asJson<DraftState>(
    request.post(`${API_BASE}/api/drafts/${draftId}/undo`),
    `POST /api/drafts/${draftId}/undo`,
  )
}

export async function getRecs(request: APIRequestContext, draftId: number): Promise<RecommendationsResponse> {
  return asJson<RecommendationsResponse>(
    request.get(`${API_BASE}/api/drafts/${draftId}/recommendations`),
    `GET /api/drafts/${draftId}/recommendations`,
  )
}

/** Make the objectively best available pick via the API for whichever team is
 *  on the clock. Returns the updated state. */
export async function draftBestViaApi(request: APIRequestContext, draftId: number): Promise<DraftState> {
  const recs = await getRecs(request, draftId)
  const best = recs.recommendations[0]
  expect(best, `expected non-empty recommendations for draft ${draftId}`).toBeTruthy()
  return makePick(request, draftId, { player_id: best.player_id, source: 'manual' })
}

export async function getRankings(request: APIRequestContext): Promise<RankingsResponse> {
  return asJson<RankingsResponse>(request.get(`${API_BASE}/api/rankings`), 'GET /api/rankings')
}

export async function editPlayer(request: APIRequestContext, edit: PlayerEditRequest): Promise<RankingsResponse> {
  return asJson<RankingsResponse>(
    request.post(`${API_BASE}/api/rankings/edits`, { data: edit }),
    `POST /api/rankings/edits (${edit.player_id})`,
  )
}

export async function getSettings(request: APIRequestContext): Promise<SettingsResponse> {
  return asJson<SettingsResponse>(request.get(`${API_BASE}/api/settings`), 'GET /api/settings')
}

export async function putSettings(
  request: APIRequestContext,
  settings: LeagueSettings,
): Promise<SettingsResponse> {
  return asJson<SettingsResponse>(
    request.put(`${API_BASE}/api/settings`, { data: settings }),
    'PUT /api/settings',
  )
}

/** Restore the stock league config (12 teams, slot 5, default roster). Later
 *  specs assume this shape — call in afterAll of anything that mutates it. */
export async function resetSettings(request: APIRequestContext): Promise<SettingsResponse> {
  return putSettings(request, DEFAULT_SETTINGS)
}

// ---------------------------------------------------------------------------
// Name/text utilities
// ---------------------------------------------------------------------------

const NAME_SUFFIXES = new Set(['jr', 'jr.', 'sr', 'sr.', 'ii', 'iii', 'iv', 'v'])

/** Last name of a player, skipping generational suffixes — grid cells and
 *  panels may abbreviate first names, so we match on the surname only. */
export function lastName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/)
  while (parts.length > 1 && NAME_SUFFIXES.has(parts[parts.length - 1].toLowerCase())) {
    parts.pop()
  }
  return parts[parts.length - 1]
}

/** Locator for the body rows of a testid'd table. */
export function tableRows(page: Page, testId: string): Locator {
  return page.getByTestId(testId).locator('tbody tr')
}

// ---------------------------------------------------------------------------
// Draft-board sync assertions
// ---------------------------------------------------------------------------

/** The room renders one tab panel at a time; switch before asserting. */
export async function openTab(page: Page, tab: 'next' | 'board' | 'teams'): Promise<void> {
  const button = page.getByTestId(`tab-${tab}`)
  await expect(button).toBeVisible()
  if ((await button.getAttribute('aria-selected')) !== 'true') {
    await button.click()
  }
}

/** Snapshot of every grid-cell-{overall} element's text, keyed by overall. */
export async function gridCellTexts(page: Page): Promise<Record<number, string>> {
  return page.evaluate(() => {
    const out: Record<number, string> = {}
    for (const el of Array.from(document.querySelectorAll('[data-testid^="grid-cell-"][data-player-id]'))) {
      const id = el.getAttribute('data-testid') ?? ''
      const overall = Number(id.slice('grid-cell-'.length))
      if (!Number.isNaN(overall)) out[overall] = (el.textContent ?? '').trim()
    }
    return out
  })
}

/** A cell counts as "filled" when it contains a word of 3+ letters (player
 *  names always do; empty-cell adornments like "3.04" / pick numbers do not).
 *  There is no data-testid distinguishing filled cells, so this heuristic is
 *  the contract we assert against. */
function countFilled(cells: Record<number, string>): number {
  return Object.values(cells).filter((t) => /[A-Za-z]{3,}/.test(t)).length
}

/**
 * Zero-desync check: poll the page's board grid until the number of filled
 * cells equals the API pick count, then verify every API pick's surname
 * appears in its own grid cell.
 */
export async function assertBoardInSync(
  page: Page,
  request: APIRequestContext,
  draftId: number,
  opts: { timeout?: number } = {},
): Promise<DraftState> {
  const timeout = opts.timeout ?? 15_000
  const state = await getDraftState(request, draftId)

  await openTab(page, 'board')
  await expect
    .poll(async () => countFilled(await gridCellTexts(page)), {
      timeout,
      message: `board grid should show exactly ${state.picks.length} filled cells (draft ${draftId})`,
    })
    .toBe(state.picks.length)

  const cells = await gridCellTexts(page)
  for (const pick of state.picks) {
    expect(
      cells[pick.overall] ?? '',
      `grid-cell-${pick.overall} should show ${pick.player_name}`,
    ).toContain(lastName(pick.player_name))
  }
  return state
}

/** my-team-panel must list every pick belonging to my slot. */
export async function assertMyTeamPanel(page: Page, state: DraftState): Promise<void> {
  const panel = page.getByTestId('my-team-panel')
  await expect(panel).toBeVisible()
  for (const pick of state.picks.filter((p) => p.team_index === state.my_slot)) {
    await expect(panel, `my-team-panel should list ${pick.player_name}`).toContainText(
      lastName(pick.player_name),
    )
  }
}

// ---------------------------------------------------------------------------
// Mock draft runner
// ---------------------------------------------------------------------------

export interface MockDraftOptions {
  /** UI-vs-API sync checkpoint frequency (default: every 20 picks). */
  checkpointEvery?: number
  /** After this many picks are on the board, exercise undo-button + re-pick. */
  undoAtPick?: number
}

/**
 * Drive a full mock draft to completion.
 *
 * - My turns (my_turn per the API): waits for draft-best-button — which only
 *   renders on my turn, so its appearance proves the WS pushed the state to
 *   the UI — and clicks it.
 * - Opponent turns: picks the API's top recommendation via REST, then polls
 *   the API pick count (fast; no UI wait per pick).
 * - Every `checkpointEvery` picks: full grid-vs-API zero-desync assertion
 *   plus my-team-panel contents.
 * - At `undoAtPick`: clicks undo-button, asserts the grid cell empties and
 *   the API agrees, then re-picks.
 */
export async function mockDraftRunner(
  page: Page,
  request: APIRequestContext,
  draftId: number,
  opts: MockDraftOptions = {},
): Promise<DraftState> {
  const checkpointEvery = opts.checkpointEvery ?? 20
  let undoPending = opts.undoAtPick != null

  let state = await getDraftState(request, draftId)
  const totalPicks = state.teams * state.rounds
  let made = state.picks.length

  const apiPickCount = async () => (await getDraftState(request, draftId)).picks.length

  while (made < totalPicks) {
    const recs = await getRecs(request, draftId)

    if (recs.my_turn) {
      await openTab(page, 'next')
      const btn = page.getByTestId('draft-best-button')
      await expect(btn, `draft-best-button should appear on my turn (pick ${made + 1})`).toBeVisible({
        timeout: 15_000,
      })
      await btn.click()
    } else {
      const best = recs.recommendations[0]
      expect(best, `recommendations should be non-empty at pick ${made + 1}`).toBeTruthy()
      await makePick(request, draftId, { player_id: best.player_id, source: 'manual' })
    }

    await expect
      .poll(apiPickCount, { timeout: 15_000, message: `pick ${made + 1} should land in the API` })
      .toBe(made + 1)
    made += 1

    if (undoPending && opts.undoAtPick != null && made >= opts.undoAtPick) {
      undoPending = false
      state = await getDraftState(request, draftId)
      const undone = state.picks[state.picks.length - 1]

      await page.getByTestId('undo-button').click()
      await expect
        .poll(apiPickCount, { timeout: 15_000, message: 'undo should remove the last pick server-side' })
        .toBe(made - 1)
      await expect
        .poll(async () => (await gridCellTexts(page))[undone.overall] ?? '', {
          timeout: 15_000,
          message: `grid-cell-${undone.overall} should empty after undo`,
        })
        .not.toContain(lastName(undone.player_name))

      // Re-pick so the draft continues (button when it's my clock, API otherwise).
      const again = await getRecs(request, draftId)
      if (again.my_turn) {
        const btn = page.getByTestId('draft-best-button')
        await expect(btn).toBeVisible({ timeout: 15_000 })
        await btn.click()
      } else {
        await makePick(request, draftId, { player_id: again.recommendations[0].player_id, source: 'manual' })
      }
      await expect
        .poll(apiPickCount, { timeout: 15_000, message: 'the board should be re-filled after undo' })
        .toBe(made)
    }

    if (made % checkpointEvery === 0 || made === totalPicks) {
      state = await assertBoardInSync(page, request, draftId)
      await assertMyTeamPanel(page, state)
    }
  }

  return getDraftState(request, draftId)
}

// ---------------------------------------------------------------------------
// Misc page helpers
// ---------------------------------------------------------------------------

/** Resolve the draft id after clicking create-draft: prefer the /draft/:id
 *  URL; fall back to the newest draft in the API list. */
export async function resolveDraftId(page: Page, request: APIRequestContext): Promise<number> {
  try {
    await page.waitForURL(/\/draft\/\d+/, { timeout: 10_000 })
    const match = page.url().match(/\/draft\/(\d+)/)
    if (match) return Number(match[1])
  } catch {
    // fall through to the API listing
  }
  const drafts = await asJson<Array<{ id: number }>>(request.get(`${API_BASE}/api/drafts`), 'GET /api/drafts')
  expect(drafts.length, 'at least one draft should exist after create-draft').toBeGreaterThan(0)
  return drafts.reduce((max, d) => Math.max(max, d.id), 0)
}
