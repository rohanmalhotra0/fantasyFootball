import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { overallToTeam, useDraftStore } from '../lib/draftStore'
import type { DraftState, LeagueSettings, PickOut } from '../lib/types'

const SETTINGS: LeagueSettings = {
  teams: 12,
  scoring_preset: 'ppr',
  scoring: {
    pass_yd: 0.04,
    pass_td: 4,
    interception: -2,
    rush_yd: 0.1,
    rush_td: 6,
    reception: 1,
    rec_yd: 0.1,
    rec_td: 6,
    fumble_lost: -2,
    two_pt: 2,
    special_teams_td: 6,
  },
  roster: { qb: 1, rb: 2, wr: 2, te: 1, flex: 1, superflex: 0, k: 1, dst: 1, bench: 6 },
  draft_type: 'snake',
  my_slot: 5,
  team_names: [],
}

function pick(overall: number, playerId: string): PickOut {
  return {
    overall,
    round: Math.ceil(overall / 12),
    team_index: overallToTeam(overall, 12),
    player_id: playerId,
    player_name: `Player ${playerId}`,
    position: 'RB',
    source: 'manual',
  }
}

function makeState(picks: PickOut[], overrides: Partial<DraftState> = {}): DraftState {
  const next = picks.length + 1
  return {
    id: 1,
    status: 'active',
    teams: 12,
    rounds: 15,
    my_slot: 5,
    team_names: [],
    settings: SETTINGS,
    current_overall: next,
    on_clock_team: overallToTeam(next, 12),
    current_round: Math.ceil(next / 12),
    picks,
    total_picks: 180,
    ...overrides,
  }
}

interface Route {
  payload: unknown
  status?: number
}

function stubFetch(routes: Record<string, Route>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${String(input)}`
    const route = routes[key]
    if (!route) throw new Error(`no fetch mock for ${key}`)
    const status = route.status ?? 200
    return {
      ok: status < 400,
      status,
      statusText: `HTTP ${status}`,
      json: async () => route.payload,
    } as Response
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

beforeEach(() => {
  vi.useFakeTimers()
  useDraftStore.getState().reset()
})

afterEach(() => {
  useDraftStore.getState().reset() // clears the debounce timer
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('applyState dedupe', () => {
  it('applies a newer snapshot (more picks)', () => {
    const store = useDraftStore.getState()
    store.applyState(makeState([pick(1, 'a')]))
    store.applyState(makeState([pick(1, 'a'), pick(2, 'b')]))
    expect(useDraftStore.getState().state?.picks).toHaveLength(2)
  })

  it('ignores an older snapshot for the same draft (WS/REST race)', () => {
    const store = useDraftStore.getState()
    store.applyState(makeState([pick(1, 'a'), pick(2, 'b')]))
    store.applyState(makeState([pick(1, 'a')])) // stale echo
    expect(useDraftStore.getState().state?.picks).toHaveLength(2)
  })

  it('applies an equal-length snapshot (status changes still land)', () => {
    const store = useDraftStore.getState()
    store.applyState(makeState([pick(1, 'a')]))
    store.applyState(makeState([pick(1, 'a')], { status: 'complete', current_overall: null }))
    expect(useDraftStore.getState().state?.status).toBe('complete')
  })

  it('always applies a snapshot from a different draft id', () => {
    const store = useDraftStore.getState()
    store.applyState(makeState([pick(1, 'a'), pick(2, 'b')]))
    store.applyState(makeState([], { id: 2 }))
    expect(useDraftStore.getState().state?.id).toBe(2)
    expect(useDraftStore.getState().state?.picks).toHaveLength(0)
  })

  it('force=true applies fewer picks (undo)', () => {
    const store = useDraftStore.getState()
    store.applyState(makeState([pick(1, 'a'), pick(2, 'b')]))
    store.applyState(makeState([pick(1, 'a')]), true)
    expect(useDraftStore.getState().state?.picks).toHaveLength(1)
  })
})

describe('debounced derived refetch', () => {
  it('fetches recommendations + outlooks 150ms after a state change, once per burst', async () => {
    const recs = {
      on_clock_team: 2,
      my_turn: false,
      picks_until_my_turn: 3,
      recommendations: [],
      my_outlook: null,
      adp_available: true,
    }
    const outlooks = { teams: [] }
    const fetchMock = stubFetch({
      'GET /api/drafts/1/recommendations': { payload: recs },
      'GET /api/drafts/1/outlooks': { payload: outlooks },
    })

    const store = useDraftStore.getState()
    store.applyState(makeState([pick(1, 'a')]))
    store.applyState(makeState([pick(1, 'a'), pick(2, 'b')])) // within the window

    expect(fetchMock).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(200)

    const urls = fetchMock.mock.calls.map((c) => String(c[0]))
    expect(urls).toContain('/api/drafts/1/recommendations')
    expect(urls).toContain('/api/drafts/1/outlooks')
    expect(fetchMock).toHaveBeenCalledTimes(2) // debounced: one burst, one refetch
    expect(useDraftStore.getState().recs).toEqual(recs)
  })

  it('does not refetch when the draft is complete', async () => {
    const fetchMock = stubFetch({})
    useDraftStore
      .getState()
      .applyState(makeState([pick(1, 'a')], { status: 'complete', current_overall: null }))
    await vi.advanceTimersByTimeAsync(300)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('mutations', () => {
  it('makePick POSTs and applies the response state immediately', async () => {
    const before = makeState([pick(1, 'a')])
    const after = makeState([pick(1, 'a'), pick(2, 'b')])
    const fetchMock = stubFetch({
      'POST /api/drafts/1/picks': { payload: after },
    })
    useDraftStore.getState().applyState(before)

    const ok = await useDraftStore.getState().makePick({ player_id: 'b' })

    expect(ok).toBe(true)
    expect(useDraftStore.getState().state?.picks).toHaveLength(2)
    expect(useDraftStore.getState().error).toBeNull()
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('/api/drafts/1/picks')
    expect(JSON.parse(String(init?.body))).toEqual({ player_id: 'b', source: 'manual' })
  })

  it('surfaces the server 409 message verbatim and keeps state', async () => {
    stubFetch({
      'POST /api/drafts/1/picks': {
        payload: { detail: 'Justin Jefferson was already drafted' },
        status: 409,
      },
    })
    useDraftStore.getState().applyState(makeState([pick(1, 'a')]))

    const ok = await useDraftStore.getState().makePick({ player_id: 'a' })

    expect(ok).toBe(false)
    expect(useDraftStore.getState().error).toBe('Justin Jefferson was already drafted')
    expect(useDraftStore.getState().state?.picks).toHaveLength(1)
  })

  it('undoPick applies a shorter state (force path)', async () => {
    const before = makeState([pick(1, 'a'), pick(2, 'b')])
    const after = makeState([pick(1, 'a')])
    stubFetch({ 'POST /api/drafts/1/undo': { payload: after } })
    useDraftStore.getState().applyState(before)

    const ok = await useDraftStore.getState().undoPick()

    expect(ok).toBe(true)
    expect(useDraftStore.getState().state?.picks).toHaveLength(1)
  })

  it('editPick PUTs to the pick and applies the response', async () => {
    const before = makeState([pick(1, 'a'), pick(2, 'b')])
    const after = makeState([pick(1, 'a'), pick(2, 'c')])
    const fetchMock = stubFetch({ 'PUT /api/drafts/1/picks/2': { payload: after } })
    useDraftStore.getState().applyState(before)

    const ok = await useDraftStore.getState().editPick(2, 'c')

    expect(ok).toBe(true)
    expect(useDraftStore.getState().state?.picks[1].player_id).toBe('c')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
