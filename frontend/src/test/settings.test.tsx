import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { LeagueSettings, SettingsResponse } from '../lib/types'
import Settings from '../pages/Settings'

const baseSettings: LeagueSettings = {
  teams: 12,
  scoring_preset: 'ppr',
  scoring: {
    pass_yd: 0.04,
    pass_td: 4.0,
    interception: -2.0,
    rush_yd: 0.1,
    rush_td: 6.0,
    reception: 1.0,
    rec_yd: 0.1,
    rec_td: 6.0,
    fumble_lost: -2.0,
    two_pt: 2.0,
    special_teams_td: 6.0,
  },
  roster: { qb: 1, rb: 2, wr: 2, te: 1, flex: 1, superflex: 0, k: 1, dst: 1, bench: 6 },
  draft_type: 'snake',
  my_slot: 5,
  team_names: [],
}

function jsonResponse(payload: unknown) {
  const copy = JSON.parse(JSON.stringify(payload)) as unknown
  return { ok: true, status: 200, statusText: 'OK', json: async () => copy }
}

beforeEach(() => {
  const getResp: SettingsResponse = {
    settings: baseSettings,
    replacement_counts: { QB: 13, RB: 28, WR: 34, TE: 13, K: 13, DST: 13 },
    rounds: 15,
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url === '/api/settings' && method === 'GET') return jsonResponse(getResp)
      if (url === '/api/settings' && method === 'PUT') {
        const body = JSON.parse(String(init?.body)) as LeagueSettings
        const putResp: SettingsResponse = {
          settings: body,
          // different numbers so the preview visibly changes after save
          replacement_counts: { QB: 17, RB: 37, WR: 45, TE: 17, K: 17, DST: 17 },
          rounds: 15,
        }
        return jsonResponse(putResp)
      }
      throw new Error(`unexpected fetch ${method} ${url}`)
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function renderSettings() {
  render(<Settings />)
  await screen.findByTestId('teams-input')
}

test('preset switch fills scoring values client-side', async () => {
  const user = userEvent.setup()
  await renderSettings()
  await user.click(screen.getByTestId('scoring-preset-half'))
  // Custom exposes the editor so we can see what the preset filled in
  await user.click(screen.getByTestId('scoring-preset-custom'))
  expect(screen.getByTestId('scoring-reception')).toHaveValue(0.5)
  expect(screen.getByTestId('scoring-pass_td')).toHaveValue(4)
})

test('roster stepper changes the rounds readout', async () => {
  const user = userEvent.setup()
  await renderSettings()
  expect(screen.getByTestId('rounds-readout')).toHaveTextContent('Rounds: 15')
  await user.click(screen.getByTestId('roster-bench-input-plus'))
  expect(screen.getByTestId('rounds-readout')).toHaveTextContent('Rounds: 16')
})

test('save PUTs the full LeagueSettings shape and updates the replacement preview', async () => {
  const user = userEvent.setup()
  await renderSettings()
  expect(screen.getByTestId('replacement-preview')).toHaveTextContent('QB13')
  expect(screen.getByTestId('replacement-preview')).toHaveTextContent('RB28')

  await user.click(screen.getByTestId('save-settings'))
  expect(await screen.findByTestId('settings-saved')).toHaveTextContent(
    '✓ Saved — VORP updated everywhere',
  )

  const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
  const call = fetchMock.mock.calls.find(
    ([url, init]) => String(url) === '/api/settings' && (init as RequestInit)?.method === 'PUT',
  )
  expect(call).toBeTruthy()
  const body = JSON.parse(String((call?.[1] as RequestInit).body)) as LeagueSettings
  expect(Object.keys(body).sort()).toEqual([
    'draft_type',
    'my_slot',
    'roster',
    'scoring',
    'scoring_preset',
    'team_names',
    'teams',
  ])
  expect(Object.keys(body.scoring).sort()).toEqual([
    'fumble_lost',
    'interception',
    'pass_td',
    'pass_yd',
    'rec_td',
    'rec_yd',
    'reception',
    'rush_td',
    'rush_yd',
    'special_teams_td',
    'two_pt',
  ])
  expect(Object.keys(body.roster).sort()).toEqual([
    'bench',
    'dst',
    'flex',
    'k',
    'qb',
    'rb',
    'superflex',
    'te',
    'wr',
  ])
  expect(body.teams).toBe(12)
  expect(body.my_slot).toBe(5)

  // preview reflects the new server response
  expect(screen.getByTestId('replacement-preview')).toHaveTextContent('QB17')
  expect(screen.getByTestId('replacement-preview')).toHaveTextContent('RB37')
})
