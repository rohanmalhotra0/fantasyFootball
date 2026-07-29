import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Backtest from '../pages/Backtest'
import type { BacktestYearResponse, ScatterPoint, YearMetrics } from '../lib/types'

// recharts' ResponsiveContainer needs ResizeObserver, which jsdom lacks.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub)

const METRICS: YearMetrics = {
  season: 2024,
  n_players: 300,
  spearman_model: 0.71,
  spearman_naive: 0.44,
  mae_model: 38.2,
  n_drafted: 180,
  spearman_model_drafted: 0.71,
  spearman_naive_drafted: 0.45,
  spearman_adp_drafted: 0.48,
  per_position: {
    QB: { n: 32, spearman_model: 0.66, spearman_naive: 0.5, mae_model: 41.3 },
    RB: { n: 60, spearman_model: 0.58, spearman_naive: 0.4, mae_model: 52.7 },
  },
}

function point(name: string, position: string, rank: number, actual_rank: number): ScatterPoint {
  return { player_id: `p-${rank}`, name, position, rank, actual_rank, predicted: 200, actual: 210.4 }
}

const YEAR_RESPONSE: BacktestYearResponse = {
  season: 2024,
  metrics: METRICS,
  model_scatter: [point('Josh Allen', 'QB', 1, 2), point('Bijan Robinson', 'RB', 2, 1)],
  adp_scatter: [point('Josh Allen', 'QB', 3, 2)],
  hits: [
    {
      name: 'St. Brown, Amon-Ra',
      position: 'WR',
      rank: 60,
      actual_rank: 22,
      predicted: 180.2,
      actual: 250.1,
      diff: -38,
    },
  ],
  busts: [
    {
      name: 'Bust Guy',
      position: 'RB',
      rank: 5,
      actual_rank: 80,
      predicted: 260.4,
      actual: 90.3,
      diff: 75,
    },
  ],
  adp_available: true,
}

const SETTINGS_RESPONSE = {
  settings: {
    teams: 10,
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
  },
  replacement_counts: { QB: 10, RB: 25 },
  rounds: 15,
}

function jsonResponse(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 503 ? 'Service Unavailable' : 'OK',
    json: async () => payload,
  }
}

function mockBacktestFetch({ simulateStatus = 503 }: { simulateStatus?: number } = {}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith('/api/backtest/years')) return jsonResponse({ years: [2023, 2024] })
    if (url.endsWith('/api/settings')) return jsonResponse(SETTINGS_RESPONSE)
    if (url.endsWith('/simulate')) {
      return simulateStatus === 503
        ? jsonResponse({ detail: 'simulator warming up' }, 503)
        : jsonResponse({ detail: 'unexpected' }, 500)
    }
    if (/\/api\/backtest\/\d+$/.test(url)) return jsonResponse(YEAR_RESPONSE)
    throw new Error(`Unexpected fetch: ${url}`)
  })
}

function blobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(blob)
  })
}

function renderBacktest() {
  return render(
    <MemoryRouter>
      <Backtest />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.stubGlobal('fetch', mockBacktestFetch())
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
})

describe('Backtest page', () => {
  it('renders the year select defaulting to the newest year', async () => {
    renderBacktest()
    const select = (await screen.findByTestId('year-select')) as HTMLSelectElement
    expect(select.value).toBe('2024')
    const options = within(select).getAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual(['2023', '2024'])
  })

  it('renders hits and busts tables with arrow+text diff badges', async () => {
    renderBacktest()
    expect(await screen.findByText('St. Brown, Amon-Ra')).toBeInTheDocument()
    expect(screen.getByText(/\+38 better/)).toBeInTheDocument()
    expect(screen.getByText('Bust Guy')).toBeInTheDocument()
    expect(screen.getByText(/75 worse/)).toBeInTheDocument()
  })

  it('renders the per-position error table from metrics.per_position', async () => {
    renderBacktest()
    const table = await screen.findByTestId('position-errors')
    const qbRow = within(table).getByText('QB').closest('tr') as HTMLElement
    expect(within(qbRow).getByText('32')).toBeInTheDocument()
    expect(within(qbRow).getByText('0.66')).toBeInTheDocument()
    expect(within(qbRow).getByText('41.3')).toBeInTheDocument()
  })

  it('shows a plain-text Spearman summary so the chart is not the only carrier', async () => {
    renderBacktest()
    expect(await screen.findByText('Model Spearman 0.71 — beats ADP 0.48')).toBeInTheDocument()
  })

  it('exports hits as correctly escaped CSV', async () => {
    const user = userEvent.setup()
    let captured: Blob | null = null
    const createObjectURL = vi.fn((blob: Blob) => {
      captured = blob
      return 'blob:fake'
    })
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL: vi.fn() })
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined)

    renderBacktest()
    await user.click(await screen.findByTestId('export-hits'))

    expect(click).toHaveBeenCalledTimes(1)
    expect(captured).not.toBeNull()
    const csv = await blobText(captured as unknown as Blob)
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe('name,position,model_rank,actual_finish,actual_points,diff')
    expect(lines[1]).toBe('"St. Brown, Amon-Ra",WR,60,22,250.1,-38')
  })

  it('shows a friendly retry message when simulate returns 503', async () => {
    const user = userEvent.setup()
    renderBacktest()
    const button = await screen.findByTestId('simulate-button')
    await user.click(button)
    expect(await screen.findByText(/still warming up/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Try again/ })).toBeInTheDocument()
    expect(screen.queryByTestId('sim-result')).not.toBeInTheDocument()
  })
})
