import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Dashboard, { timeAgo } from '../pages/Dashboard'
import type { DashboardResponse, YearMetrics } from '../lib/types'

function yearMetrics(
  season: number,
  model: number,
  naive: number,
  adp: number | null,
): YearMetrics {
  return {
    season,
    n_players: 300,
    spearman_model: model,
    spearman_naive: naive,
    mae_model: 38.2,
    n_drafted: adp === null ? null : 180,
    spearman_model_drafted: adp === null ? null : model,
    spearman_naive_drafted: adp === null ? null : naive,
    spearman_adp_drafted: adp,
    per_position: {
      QB: { n: 30, spearman_model: 0.65, spearman_naive: 0.5, mae_model: 40.1 },
    },
  }
}

const FULL_RESPONSE: DashboardResponse = {
  validation: [yearMetrics(2023, 0.71, 0.44, 0.48), yearMetrics(2024, 0.55, 0.6, null)],
  last_refresh: {
    finished_at: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
    version: 'v20250729-120000',
    adp_errors: {},
  },
  model_version: 'v20250729-120000',
  settings_summary: '12-team PPR snake, pick 5',
  data_ready: true,
  adp_available: true,
  vorp_heatmap: {
    rows: ['R1', 'R2'],
    cols: ['QB', 'RB'],
    values: [
      [45.2, -3.1],
      [null, 12.3],
    ],
    note: 'Average actual points over replacement, 2017-2024.',
  },
  hit_rate_heatmap: {
    rows: ['R1', 'R2'],
    cols: ['QB', 'RB'],
    values: [
      [0.62, 0.4],
      [0.305, null],
    ],
    note: 'Share of picks that finished above replacement level, 2017-2024.',
  },
}

const EMPTY_RESPONSE: DashboardResponse = {
  validation: [],
  last_refresh: null,
  model_version: null,
  settings_summary: '10-team Half-PPR snake, pick 3',
  data_ready: false,
  adp_available: false,
  vorp_heatmap: null,
  hit_rate_heatmap: null,
}

function mockDashboardFetch(payload: DashboardResponse) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => payload,
    })),
  )
}

function renderDashboard() {
  return render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Dashboard with full data', () => {
  it('renders validation rows with the winner bolded per row', async () => {
    mockDashboardFetch(FULL_RESPONSE)
    renderDashboard()
    const table = await screen.findByTestId('validation-table')

    // 2023: model 0.71 beats naive 0.44 and ADP 0.48 -> model cell is the winner.
    const modelCell = within(table).getByText('0.71').closest('td')
    expect(modelCell).toHaveAttribute('data-winner', 'true')
    expect(modelCell?.className).toContain('font-bold')
    expect(within(table).getByText('0.44').closest('td')).not.toHaveAttribute('data-winner')

    // 2024: naive 0.60 beats model 0.55; ADP missing -> em dash with title.
    const naiveCell = within(table).getByText('0.60').closest('td')
    expect(naiveCell).toHaveAttribute('data-winner', 'true')
    const dash = within(table).getByTitle('needs ADP data')
    expect(dash).toHaveTextContent('—')

    expect(
      within(table.closest('section') as HTMLElement).getByText(
        'Higher = better ranking of who actually scored',
      ),
    ).toBeInTheDocument()
  })

  it('renders heatmap cells with formatted values from the API', async () => {
    mockDashboardFetch(FULL_RESPONSE)
    renderDashboard()
    const vorp = await screen.findByTestId('vorp-heatmap')
    expect(within(vorp).getByText('45.2')).toBeInTheDocument()
    expect(within(vorp).getByText('-3.1')).toBeInTheDocument()
    expect(within(vorp).getByText('12.3')).toBeInTheDocument()
    expect(within(vorp).getByTitle('R2 QB: no data')).toHaveTextContent('—')
    expect(within(vorp).getByTitle('R1 QB: 45.2')).toBeInTheDocument()

    const hitRate = screen.getByTestId('hit-rate-heatmap')
    expect(within(hitRate).getByText('62%')).toBeInTheDocument()
    expect(within(hitRate).getByText('40%')).toBeInTheDocument()
    expect(within(hitRate).getByText('31%')).toBeInTheDocument()
  })

  it('shows humanized refresh time, model version, league summary and the draft CTA', async () => {
    mockDashboardFetch(FULL_RESPONSE)
    renderDashboard()
    const refresh = await screen.findByTestId('last-refresh')
    expect(refresh).toHaveTextContent('3 hours ago')
    expect(screen.getByText('v20250729-120000')).toBeInTheDocument()
    expect(screen.getByText('12-team PPR snake, pick 5')).toBeInTheDocument()
    expect(screen.getByTestId('enter-draft-room')).toHaveTextContent('Enter Draft Room')
    expect(screen.getByText('Data ready')).toBeInTheDocument()
  })
})

describe('Dashboard with empty/not-ready data', () => {
  it('shows heatmap empty states and the not-ready warning', async () => {
    mockDashboardFetch(EMPTY_RESPONSE)
    renderDashboard()
    await screen.findByTestId('vorp-heatmap')
    const message = 'ADP history not cached — refresh where FFC is reachable'
    expect(screen.getAllByText(message)).toHaveLength(2)
    expect(screen.getByText('Data not ready')).toBeInTheDocument()
    expect(screen.getByText('Never refreshed')).toBeInTheDocument()
    expect(
      screen.getByText('No validation yet — run a refresh from the Data page.'),
    ).toBeInTheDocument()
  })
})

describe('timeAgo', () => {
  it('humanizes durations', () => {
    const now = new Date('2026-07-29T12:00:00Z')
    expect(timeAgo('2026-07-29T11:59:40Z', now)).toBe('just now')
    expect(timeAgo('2026-07-29T11:15:00Z', now)).toBe('45 minutes ago')
    expect(timeAgo('2026-07-29T09:00:00Z', now)).toBe('3 hours ago')
    expect(timeAgo('2026-07-27T09:00:00Z', now)).toBe('2 days ago')
    expect(timeAgo('not-a-date', now)).toBe('not-a-date')
  })
})
