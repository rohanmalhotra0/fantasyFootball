import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The room opens a real WebSocket; stub the whole module so tests stay
// deterministic (reconnect/backoff is ws.ts's own concern).
vi.mock('../lib/ws', () => ({
  connectDraft: vi.fn(() => () => {}),
}))

import { overallToTeam, useDraftStore } from '../lib/draftStore'
import DraftRoom from '../pages/DraftRoom'
import type {
  BoardPlayer,
  DraftState,
  LeagueSettings,
  PickOut,
  Recommendation,
  RecommendationsResponse,
  SettingsResponse,
  TeamOutlook,
} from '../lib/types'

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

const SETTINGS_RESPONSE: SettingsResponse = {
  settings: SETTINGS,
  replacement_counts: { QB: 12, RB: 30 },
  rounds: 15,
}

function pick(overall: number, playerId: string, name: string): PickOut {
  return {
    overall,
    round: Math.ceil(overall / 12),
    team_index: overallToTeam(overall, 12),
    player_id: playerId,
    player_name: name,
    position: 'RB',
    source: 'manual',
  }
}

const TEAM_NAMES = Array.from({ length: 12 }, (_, i) => (i === 6 ? 'Gadget Gurus' : `Team ${i + 1}`))

function roomState(overrides: Partial<DraftState> = {}): DraftState {
  return {
    id: 5,
    status: 'active',
    teams: 12,
    rounds: 15,
    my_slot: 5,
    team_names: TEAM_NAMES,
    settings: SETTINGS,
    current_overall: 31,
    on_clock_team: 7,
    current_round: 3,
    picks: [pick(1, 'p1', 'Bijan Robinson'), pick(2, 'p2', 'CeeDee Lamb')],
    total_picks: 180,
    ...overrides,
  }
}

function rec(id: string, name: string, reason: string): Recommendation {
  return {
    player_id: id,
    name,
    position: 'WR',
    team: 'MIN',
    projected_points: 210.4,
    vorp: 55.2,
    adp: 3.1,
    survival_prob: 0.72,
    tier: 1,
    risk_flag: false,
    reason,
  }
}

function outlook(teamIndex: number, name: string): TeamOutlook {
  return {
    team_index: teamIndex,
    name,
    slots: [
      { slot: 'QB', player_name: null, position: null },
      { slot: 'RB', player_name: 'Bijan Robinson', position: 'RB' },
      { slot: 'RB', player_name: null, position: null },
    ],
    projected_points: 1400,
    needs: ['RB', 'WR'],
  }
}

function recsResponse(myTurn: boolean): RecommendationsResponse {
  return {
    on_clock_team: 7,
    my_turn: myTurn,
    picks_until_my_turn: myTurn ? 0 : 4,
    recommendations: [
      rec('r1', 'Justin Jefferson', 'Fills your WR1 hole'),
      rec('r2', 'Saquon Barkley', 'Best RB left by a mile'),
    ],
    my_outlook: outlook(5, 'Team 5'),
    adp_available: true,
  }
}

function boardPlayer(id: string, name: string): BoardPlayer {
  return {
    player_id: id,
    name,
    position: 'WR',
    team: 'MIN',
    projected_points: 200,
    vorp: 40,
    model_rank: 1,
    adp: 2,
    adp_rank: 2,
    value_gap: 1,
    tier: 1,
    risk_flag: false,
    unmodeled: false,
    pinned: false,
    banned: false,
    manual_rank: null,
  }
}

interface Route_ {
  payload: unknown
  status?: number
}

function stubFetch(routes: Record<string, Route_>) {
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

function roomRoutes(myTurn: boolean): Record<string, Route_> {
  return {
    'GET /api/drafts/5': { payload: roomState() },
    'GET /api/drafts/5/recommendations': { payload: recsResponse(myTurn) },
    'GET /api/drafts/5/outlooks': {
      payload: { teams: [outlook(5, 'Team 5'), outlook(7, 'Gadget Gurus')] },
    },
    'GET /api/rankings': {
      payload: {
        players: [boardPlayer('r1', 'Justin Jefferson'), boardPlayer('x9', 'Puka Nacua')],
        adp_available: true,
        model_version: 'v1',
        season: 2026,
      },
    },
  }
}

function Probe() {
  const { draftId } = useParams()
  return <div data-testid="room-probe">room {draftId}</div>
}

function renderLobby() {
  return render(
    <MemoryRouter initialEntries={['/draft']}>
      <Routes>
        <Route path="/draft" element={<DraftRoom />} />
        <Route path="/draft/:draftId" element={<Probe />} />
      </Routes>
    </MemoryRouter>,
  )
}

function renderRoom() {
  return render(
    <MemoryRouter initialEntries={['/draft/5']}>
      <Routes>
        <Route path="/draft/:draftId" element={<DraftRoom />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  useDraftStore.getState().reset()
})

afterEach(() => {
  useDraftStore.getState().reset()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('lobby (no draft id)', () => {
  it('lists drafts with resume labels, the league summary, and the create button', async () => {
    stubFetch({
      'GET /api/drafts': {
        payload: [
          {
            id: 3,
            created_at: '2026-07-29T10:00:00Z',
            status: 'active',
            teams: 12,
            rounds: 15,
            picks_made: 30,
          },
        ],
      },
      'GET /api/settings': { payload: SETTINGS_RESPONSE },
    })
    renderLobby()

    expect(
      await screen.findByRole('button', { name: /Resume draft #3 — R3, pick 31/ }),
    ).toBeInTheDocument()
    expect(screen.getByTestId('create-draft')).toHaveTextContent('Start new draft')
    expect(await screen.findByText(/12-team PPR snake, pick 5, 15 rounds/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Change it first/ })).toHaveAttribute(
      'href',
      '/settings',
    )
  })

  it('creates a draft and navigates to its room', async () => {
    stubFetch({
      'GET /api/drafts': { payload: [] },
      'GET /api/settings': { payload: SETTINGS_RESPONSE },
      'POST /api/drafts': { payload: roomState({ id: 7, picks: [] }) },
    })
    renderLobby()

    await userEvent.click(await screen.findByTestId('create-draft'))

    expect(await screen.findByTestId('room-probe')).toHaveTextContent('room 7')
  })
})

describe('room (with draft id)', () => {
  it('renders the banner with the on-clock team, progress, and timer', async () => {
    stubFetch(roomRoutes(false))
    renderRoom()

    const banner = await screen.findByTestId('on-clock-banner')
    expect(banner).toHaveTextContent('Pick 31 — Gadget Gurus on the clock')
    expect(banner).toHaveTextContent('Round 3 of 15')
    expect(screen.getByTestId('pick-timer')).toHaveTextContent('1:30')
  })

  it("not my turn: shows log-pick search and rec cards, no big draft button", async () => {
    stubFetch(roomRoutes(false))
    renderRoom()

    expect(await screen.findByTestId('pick-search')).toBeInTheDocument()
    expect(screen.getByText('On the clock: Gadget Gurus')).toBeInTheDocument()

    const card0 = await screen.findByTestId('rec-card-0')
    expect(card0).toHaveTextContent('Justin Jefferson')
    expect(card0).toHaveTextContent('72% likely available next turn')
    expect(card0).toHaveTextContent('Fills your WR1 hole')

    expect(screen.queryByTestId('draft-best-button')).not.toBeInTheDocument()
    // Undo is always reachable once picks exist.
    expect(screen.getByTestId('undo-button')).toBeInTheDocument()
  })

  it('my turn: shows the giant draft-best button for the top recommendation', async () => {
    stubFetch(roomRoutes(true))
    renderRoom()

    const button = await screen.findByTestId('draft-best-button')
    expect(button).toHaveTextContent('Draft Justin Jefferson')
    // Manual entry stays available, collapsed.
    expect(screen.getByText('Pick someone else')).toBeInTheDocument()
  })
})
