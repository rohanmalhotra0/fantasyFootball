import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { BoardPlayer, PlayerEditRequest, RankingsResponse } from '../lib/types'
import Rankings from '../pages/Rankings'

function player(
  overrides: Partial<BoardPlayer> & Pick<BoardPlayer, 'player_id' | 'name' | 'position'>,
): BoardPlayer {
  return {
    team: null,
    projected_points: null,
    vorp: null,
    model_rank: null,
    adp: null,
    adp_rank: null,
    value_gap: null,
    tier: null,
    risk_flag: false,
    unmodeled: false,
    pinned: false,
    banned: false,
    manual_rank: null,
    ...overrides,
  }
}

let state: RankingsResponse

function applyEdit(p: BoardPlayer, edit: PlayerEditRequest): BoardPlayer {
  const next = { ...p }
  if (edit.pinned !== undefined) next.pinned = edit.pinned
  if (edit.banned !== undefined) next.banned = edit.banned
  if (edit.manual_rank !== undefined && edit.manual_rank !== null) {
    next.manual_rank = edit.manual_rank
  }
  if (edit.clear_manual_rank) next.manual_rank = null
  return next
}

function jsonResponse(payload: unknown) {
  const copy = JSON.parse(JSON.stringify(payload)) as unknown
  return { ok: true, status: 200, statusText: 'OK', json: async () => copy }
}

beforeEach(() => {
  state = {
    players: [
      player({
        player_id: 'p1',
        name: 'Justin Jefferson',
        position: 'WR',
        team: 'MIN',
        projected_points: 280.5,
        vorp: 120.3,
        model_rank: 1,
        adp: 2.1,
        adp_rank: 2,
        value_gap: 1,
        tier: 1,
      }),
      player({
        player_id: 'p2',
        name: 'Bijan Robinson',
        position: 'RB',
        team: 'ATL',
        projected_points: 250.2,
        vorp: 95.4,
        model_rank: 2,
        adp: 8.6,
        adp_rank: 8,
        value_gap: 6,
        tier: 1,
      }),
      player({
        player_id: 'p3',
        name: 'Josh Allen',
        position: 'QB',
        team: 'BUF',
        projected_points: 360.1,
        vorp: 80.0,
        model_rank: 3,
        adp: 15.0,
        adp_rank: 15,
        value_gap: -4,
        tier: 2,
        risk_flag: true,
      }),
      player({
        player_id: 'p4',
        name: 'Rookie Guy',
        position: 'WR',
        team: 'DAL',
        adp: 20.4,
        adp_rank: 20,
        unmodeled: true,
      }),
    ],
    adp_available: true,
    model_version: 'v1',
    season: 2026,
  }

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url === '/api/rankings' && method === 'GET') return jsonResponse(state)
      if (url === '/api/rankings/edits' && method === 'POST') {
        const edit = JSON.parse(String(init?.body)) as PlayerEditRequest
        state = {
          ...state,
          players: state.players.map((p) =>
            p.player_id === edit.player_id ? applyEdit(p, edit) : p,
          ),
        }
        return jsonResponse(state)
      }
      throw new Error(`unexpected fetch ${method} ${url}`)
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function renderRankings() {
  render(
    <MemoryRouter>
      <Rankings />
    </MemoryRouter>,
  )
  await screen.findByTestId('board-table')
}

test('renders board rows with count line', async () => {
  await renderRankings()
  expect(screen.getByText('Justin Jefferson')).toBeInTheDocument()
  expect(screen.getByText('Bijan Robinson')).toBeInTheDocument()
  expect(screen.getByText('Josh Allen')).toBeInTheDocument()
  expect(screen.getByText('Rookie Guy')).toBeInTheDocument()
  expect(screen.getByText(/Showing 4 of 4/)).toBeInTheDocument()
  // unmodeled row is labeled as ADP-only
  expect(screen.getByText('ADP only')).toBeInTheDocument()
  expect(screen.getByText('thin sample')).toBeInTheDocument()
})

test('search narrows the board', async () => {
  const user = userEvent.setup()
  await renderRankings()
  await user.type(screen.getByTestId('board-search'), 'jefferson')
  expect(screen.getByText('Justin Jefferson')).toBeInTheDocument()
  expect(screen.queryByText('Josh Allen')).not.toBeInTheDocument()
  expect(screen.queryByText('Bijan Robinson')).not.toBeInTheDocument()
})

test('position filter shows only that position', async () => {
  const user = userEvent.setup()
  await renderRankings()
  await user.click(screen.getByTestId('filter-pos-QB'))
  expect(screen.getByTestId('filter-pos-QB')).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByText('Josh Allen')).toBeInTheDocument()
  expect(screen.queryByText('Justin Jefferson')).not.toBeInTheDocument()
  expect(screen.getByText(/Showing 1 of 4/)).toBeInTheDocument()
})

test('ban collapses the row into the hidden section', async () => {
  const user = userEvent.setup()
  await renderRankings()
  await user.click(screen.getByTestId('ban-p3'))
  expect(await screen.findByText(/Hidden players \(1\)/)).toBeInTheDocument()
  const table = screen.getByTestId('board-table')
  expect(within(table).queryByText('Josh Allen')).not.toBeInTheDocument()
  // expand the hidden section and unhide
  await user.click(screen.getByTestId('hidden-toggle'))
  expect(screen.getByText('Josh Allen')).toBeInTheDocument()
  expect(screen.getByTestId('unban-p3')).toBeInTheDocument()
})

test('pin calls the edit API with the right body', async () => {
  const user = userEvent.setup()
  await renderRankings()
  await user.click(screen.getByTestId('pin-p2'))
  // server response flips the button into its pinned state
  await screen.findByRole('button', { name: 'Unpin Bijan Robinson' })

  const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
  const call = fetchMock.mock.calls.find(([url]) => String(url) === '/api/rankings/edits')
  expect(call).toBeTruthy()
  const init = call?.[1] as RequestInit
  expect(init.method).toBe('POST')
  expect(JSON.parse(String(init.body))).toEqual({ player_id: 'p2', pinned: true })
})

test('missing ADP shows the refresh banner', async () => {
  state = { ...state, adp_available: false }
  await renderRankings()
  expect(
    screen.getByText(/No ADP cached — value gap and ADP columns will fill in/),
  ).toBeInTheDocument()
})
