import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Insights from '../pages/Insights'
import type {
  AgingCurvesResponse,
  ConsistencyPlayer,
  ConsistencyResponse,
  TrendsResponse,
} from '../lib/types'

// recharts' ResponsiveContainer needs ResizeObserver, which jsdom lacks.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub)

const AGING: AgingCurvesResponse = {
  positions: [
    {
      position: 'RB',
      peak_experience: 1,
      buckets: [
        {
          experience: 0,
          label: '0',
          n: 120,
          mean_points: 150,
          median_points: 140,
          mean_ppg: 9.4,
          median_ppg: 9.1,
          ratio_vs_peak: 0.75,
        },
        {
          experience: 1,
          label: '1',
          n: 100,
          mean_points: 200,
          median_points: 190,
          mean_ppg: 12.5,
          median_ppg: 12.0,
          ratio_vs_peak: 1.0,
        },
        {
          experience: 12,
          label: '12+',
          n: 6,
          mean_points: 90,
          median_points: 85,
          mean_ppg: 6.0,
          median_ppg: 5.6,
          ratio_vs_peak: 0.45,
        },
      ],
    },
  ],
  min_games: 8,
  left_censored_first_season: 1999,
  note: 'Seasons with 8+ games only. Players who first appear in 1999 are excluded.',
}

function player(overrides: Partial<ConsistencyPlayer>): ConsistencyPlayer {
  return {
    player_id: 'p1',
    name: 'Steady Star',
    position: 'WR',
    team: 'KC',
    games: 16,
    total_points: 320,
    ppg: 20.0,
    stdev: 4.0,
    cv: 0.2,
    boom_rate: 0.5,
    bust_rate: 0.0,
    floor: 15.0,
    ceiling: 25.0,
    ...overrides,
  }
}

const CONSISTENCY_2025: ConsistencyResponse = {
  season: 2025,
  min_games: 6,
  boom_threshold: 20,
  bust_threshold: 5,
  players: [
    player({}),
    player({
      player_id: 'p2',
      name: 'Volatile Vic',
      ppg: 12.0,
      stdev: 9.6,
      cv: 0.8,
      boom_rate: 0.25,
      bust_rate: 0.375,
      floor: 3.2,
      ceiling: 19.0,
    }),
  ],
}

const CONSISTENCY_2024: ConsistencyResponse = {
  ...CONSISTENCY_2025,
  season: 2024,
  players: [player({ player_id: 'p3', name: 'Old Timer', ppg: 14.0 })],
}

function seasonTrend(season: number, rbShare: number, wrShare: number) {
  const pos = (share: number, top12: number) => ({
    total_points: share * 10000,
    share,
    top12_avg: top12,
    replacement_points: 100,
  })
  return {
    season,
    total_points: 10000,
    positions: {
      QB: pos(0.2, 280),
      RB: pos(rbShare, 260),
      WR: pos(wrShare, 250),
      TE: pos(1 - 0.2 - rbShare - wrShare, 160),
    },
    pass_share: 0.17,
    rush_share: 0.21,
    receiving_share: 0.62,
  }
}

const TRENDS: TrendsResponse = {
  seasons: [seasonTrend(2024, 0.32, 0.35), seasonTrend(2025, 0.26, 0.4)],
  replacement_cutoffs: { QB: 13, RB: 28, WR: 34, TE: 13 },
  note: 'Full-PPR points from cached weekly data.',
}

function jsonResponse(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    json: async () => payload,
  }
}

function mockInsightsFetch({ agingStatus = 200 }: { agingStatus?: number } = {}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith('/api/analysis/aging')) {
      return agingStatus === 200
        ? jsonResponse(AGING)
        : jsonResponse({ detail: 'No season stats yet — run a refresh from the Data page first.' }, 404)
    }
    if (url.endsWith('/api/analysis/trends')) return jsonResponse(TRENDS)
    if (url.endsWith('/api/analysis/consistency/2025')) return jsonResponse(CONSISTENCY_2025)
    if (url.endsWith('/api/analysis/consistency/2024')) return jsonResponse(CONSISTENCY_2024)
    throw new Error(`Unexpected fetch: ${url}`)
  })
}

function renderInsights() {
  return render(
    <MemoryRouter>
      <Insights />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.stubGlobal('fetch', mockInsightsFetch())
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
})

describe('Insights page', () => {
  it('renders all three sections with their text summaries', async () => {
    renderInsights()
    const aging = await screen.findByTestId('insights-aging')
    expect(within(aging).getByText('Running backs')).toBeInTheDocument()
    // Takeaway line: peak year and drop-off ratio in plain text.
    expect(
      within(aging).getByText(/Peak in year 1 \(200 pts avg\); by year 12\+ output falls to 45%/),
    ).toBeInTheDocument()
    // n annotations are available as text.
    expect(within(aging).getByText(/120, 100, 6/)).toBeInTheDocument()
    expect(within(aging).getByText(/first appear in 1999 are excluded/)).toBeInTheDocument()

    const trends = await screen.findByTestId('insights-trends')
    expect(
      within(trends).getByText(/2024 → 2025: RB 32% → 26%, WR 35% → 40%/),
    ).toBeInTheDocument()
    expect(
      within(trends).getByText(/receiving production drives 62% of PPR scoring/),
    ).toBeInTheDocument()

    expect(screen.getByTestId('insights-consistency')).toBeInTheDocument()
  })

  it('loads the newest season by default and renders the sortable profile table', async () => {
    renderInsights()
    const section = await screen.findByTestId('insights-consistency')
    const select = (await within(section).findByTestId(
      'insights-consistency-season',
    )) as HTMLSelectElement
    expect(select.value).toBe('2025')
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual([
      '2024',
      '2025',
    ])

    const starRow = (await within(section).findByText('Steady Star')).closest(
      'tr',
    ) as HTMLElement
    expect(within(starRow).getByText('20.0')).toBeInTheDocument() // ppg
    expect(within(starRow).getByText('50%')).toBeInTheDocument() // boom
    expect(within(starRow).getByText('15.0')).toBeInTheDocument() // floor

    // Default sort is ppg descending: the star before the volatile guy.
    const table = starRow.closest('table') as HTMLElement
    let names = within(table)
      .getAllByRole('rowheader')
      .map((el) => el.textContent)
    expect(names).toEqual(['Steady Star', 'Volatile Vic'])

    // Sorting by Bust % descending puts the bustier player first.
    await userEvent.click(within(section).getByRole('button', { name: 'Bust %' }))
    names = within(table)
      .getAllByRole('rowheader')
      .map((el) => el.textContent)
    expect(names).toEqual(['Volatile Vic', 'Steady Star'])
    // The quadrant story exists as text, not only inside the chart.
    expect(within(section).getByText(/steady stars \(1 players/)).toBeInTheDocument()
  })

  it('refetches when the season changes', async () => {
    renderInsights()
    const section = await screen.findByTestId('insights-consistency')
    const select = await within(section).findByTestId('insights-consistency-season')
    await within(section).findByText('Steady Star')

    await userEvent.selectOptions(select, '2024')
    expect(await within(section).findByText('Old Timer')).toBeInTheDocument()
    expect(within(section).queryByText('Steady Star')).not.toBeInTheDocument()
  })

  it('shows a section-level error when aging data is missing, without blanking the rest', async () => {
    vi.stubGlobal('fetch', mockInsightsFetch({ agingStatus: 404 }))
    renderInsights()
    expect(
      await screen.findByText(/No season stats yet — run a refresh from the Data page first\./),
    ).toBeInTheDocument()
    // The other sections still load.
    expect(await screen.findByTestId('insights-trends')).toBeInTheDocument()
    expect(
      await within(screen.getByTestId('insights-consistency')).findByText('Steady Star'),
    ).toBeInTheDocument()
  })
})
