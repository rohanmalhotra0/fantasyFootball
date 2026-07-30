import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  DashboardResponse,
  ModelVersionOut,
  RefreshStatus,
  YearMetrics,
} from '../lib/types'
import Admin from '../pages/Admin'

// ---------- fixtures ----------

function metricsFor(season: number, spearman: number): YearMetrics {
  return {
    season,
    n_players: 300,
    spearman_model: spearman,
    spearman_naive: 0.5,
    mae_model: 40,
    n_drafted: null,
    spearman_model_drafted: null,
    spearman_naive_drafted: null,
    spearman_adp_drafted: null,
    per_position: {},
  }
}

function versionFor(
  version: string,
  active: boolean,
  spearmans: [number, number][],
  note = '',
): ModelVersionOut {
  return {
    version,
    created_at: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
    note,
    active,
    metrics: spearmans.map(([season, s]) => metricsFor(season, s)),
  }
}

// mean 0.712 (candidate) vs mean 0.705 (active) -> "small improvement"
const STAGED_V2 = versionFor('v20250801_010203', false, [
  [2023, 0.7],
  [2024, 0.724],
])
const ACTIVE_V1 = versionFor('v20250728_090000', true, [
  [2023, 0.7],
  [2024, 0.71],
])

const IDLE_STATUS: RefreshStatus = {
  running: false,
  started_at: null,
  finished_at: null,
  error: null,
  staged_version: null,
  message: null,
}

const EMPTY_DASHBOARD: DashboardResponse = {
  validation: [],
  last_refresh: null,
  model_version: null,
  settings_summary: '12-team PPR snake, pick 5',
  data_ready: false,
  adp_available: false,
  vorp_heatmap: null,
  hit_rate_heatmap: null,
}

// ---------- fake backend behind the fetch mock ----------

interface FakeBackend {
  versions: ModelVersionOut[]
  refresh: RefreshStatus
  dashboard: DashboardResponse
  /** POST /api/admin/refresh answers 409 instead of starting. */
  startConflict: boolean
}

function makeBackend(versions: ModelVersionOut[]): FakeBackend {
  return {
    versions,
    refresh: { ...IDLE_STATUS },
    dashboard: EMPTY_DASHBOARD,
    startConflict: false,
  }
}

function jsonResponse(payload: unknown, status = 200) {
  return {
    ok: status < 400,
    status,
    statusText: '',
    json: async () => JSON.parse(JSON.stringify(payload)) as unknown,
  }
}

function installFetch(backend: FakeBackend) {
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (url === '/api/admin/models' && method === 'GET') {
      return jsonResponse({ versions: backend.versions })
    }
    if (url === '/api/dashboard' && method === 'GET') {
      return jsonResponse(backend.dashboard)
    }
    if (url === '/api/admin/refresh/status' && method === 'GET') {
      return jsonResponse(backend.refresh)
    }
    if (url === '/api/admin/refresh' && method === 'POST') {
      if (backend.startConflict) {
        backend.refresh = {
          ...IDLE_STATUS,
          running: true,
          started_at: new Date().toISOString(),
        }
        return jsonResponse({ detail: 'A data refresh is already running.' }, 409)
      }
      backend.refresh = {
        ...IDLE_STATUS,
        running: true,
        started_at: new Date().toISOString(),
      }
      return jsonResponse(backend.refresh)
    }
    const activate = url.match(/^\/api\/admin\/models\/(.+)\/activate$/)
    if (activate && method === 'POST') {
      const target = decodeURIComponent(activate[1])
      backend.versions = backend.versions.map((v) => ({ ...v, active: v.version === target }))
      return jsonResponse({ versions: backend.versions })
    }
    throw new Error(`unexpected fetch ${method} ${url}`)
  })
  vi.stubGlobal('fetch', mock)
  return mock
}

function callsTo(mock: ReturnType<typeof vi.fn>, url: string, method = 'GET') {
  return mock.mock.calls.filter(
    ([u, init]) => String(u) === url && (((init as RequestInit)?.method ?? 'GET') === method),
  ).length
}

/** Flush pending promise chains (and 0ms timers) inside act. */
async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// ---------- models table ----------

describe('ModelTable', () => {
  it('renders one row per version with active badge, chips and mean', async () => {
    installFetch(makeBackend([STAGED_V2, ACTIVE_V1]))
    render(<Admin />)
    const table = await screen.findByTestId('models-table')

    const activeRow = within(table).getByTestId('model-row-v20250728_090000')
    expect(within(activeRow).getByText('active')).toBeInTheDocument()
    // active row has no Activate button
    expect(within(activeRow).queryByTestId('activate-v20250728_090000')).toBeNull()

    const stagedRow = within(table).getByTestId('model-row-v20250801_010203')
    expect(within(stagedRow).getByText('staged')).toBeInTheDocument()
    expect(within(stagedRow).getByText('2023: 0.70')).toBeInTheDocument()
    expect(within(stagedRow).getByText('2024: 0.72')).toBeInTheDocument()
    expect(within(stagedRow).getByText('0.712')).toBeInTheDocument()
    expect(within(stagedRow).getByText('3 hours ago')).toBeInTheDocument()
    expect(within(stagedRow).getByTestId('activate-v20250801_010203')).toBeInTheDocument()
  })

  it('shows the empty state when there are no models', async () => {
    installFetch(makeBackend([]))
    render(<Admin />)
    const table = await screen.findByTestId('models-table')
    expect(within(table).getByText(/No models yet — run your first refresh/)).toBeInTheDocument()
  })

  it('activate shows a plain-words comparison, then calls the API and refreshes the table', async () => {
    const mock = installFetch(makeBackend([STAGED_V2, ACTIVE_V1]))
    const user = userEvent.setup()
    render(<Admin />)

    await user.click(await screen.findByTestId('activate-v20250801_010203'))
    // Stat tiles carry both means; the plain-words verdict sits beside them.
    const comparison = screen.getByTestId('activate-comparison')
    expect(comparison).toHaveTextContent('New')
    expect(comparison).toHaveTextContent('0.712')
    expect(comparison).toHaveTextContent('Current')
    expect(comparison).toHaveTextContent('0.705')
    expect(comparison).toHaveTextContent(/small improvement/i)
    // nothing activated yet
    expect(callsTo(mock, '/api/admin/models/v20250801_010203/activate', 'POST')).toBe(0)

    await user.click(screen.getByTestId('confirm-activate'))
    expect(callsTo(mock, '/api/admin/models/v20250801_010203/activate', 'POST')).toBe(1)

    // table refreshed from the response: badge moved, button gone
    const row = await screen.findByTestId('model-row-v20250801_010203')
    expect(within(row).getByText('active')).toBeInTheDocument()
    expect(screen.queryByTestId('activate-v20250801_010203')).toBeNull()
    expect(screen.queryByTestId('activate-comparison')).toBeNull()
    // the previously active model is now activatable again
    expect(screen.getByTestId('activate-v20250728_090000')).toBeInTheDocument()
  })

  it('cancel closes the confirm panel without calling the API', async () => {
    const mock = installFetch(makeBackend([STAGED_V2, ACTIVE_V1]))
    const user = userEvent.setup()
    render(<Admin />)

    await user.click(await screen.findByTestId('activate-v20250801_010203'))
    await user.click(screen.getByTestId('cancel-activate'))
    expect(screen.queryByTestId('activate-comparison')).toBeNull()
    expect(callsTo(mock, '/api/admin/models/v20250801_010203/activate', 'POST')).toBe(0)
  })
})

// ---------- refresh flow (fake timers) ----------

describe('RefreshCard', () => {
  it('starts a refresh, disables the button, polls every 2s, then shows the staged panel', async () => {
    vi.useFakeTimers()
    const backend = makeBackend([ACTIVE_V1])
    const mock = installFetch(backend)
    render(<Admin />)
    await flush() // initial loads: models, dashboard, refresh status

    expect(screen.getByTestId('refresh-button')).toBeEnabled()
    fireEvent.click(screen.getByTestId('refresh-button'))
    await flush() // POST /api/admin/refresh resolves

    expect(screen.getByTestId('refresh-status')).toHaveTextContent('Refreshing — started')
    expect(screen.getByTestId('refresh-button')).toBeDisabled()
    // explanation text stays visible
    expect(
      screen.getByText(/nothing changes until you activate it below/),
    ).toBeInTheDocument()

    // one poll tick: still running
    const before = callsTo(mock, '/api/admin/refresh/status')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(callsTo(mock, '/api/admin/refresh/status')).toBe(before + 1)
    expect(screen.getByTestId('refresh-status')).toBeInTheDocument()
    expect(screen.getByTestId('refresh-button')).toBeDisabled()

    // backend finishes with a staged model; next poll picks it up
    backend.refresh = {
      running: false,
      started_at: backend.refresh.started_at,
      finished_at: new Date().toISOString(),
      error: null,
      staged_version: 'v20250801_010203',
      message: 'New model v20250801_010203 staged — review metrics then activate',
    }
    const modelsBefore = callsTo(mock, '/api/admin/models')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })

    expect(screen.getByTestId('refresh-done')).toHaveTextContent(
      'New model v20250801_010203 staged ✓ — compare below and activate when happy',
    )
    expect(screen.queryByTestId('refresh-status')).toBeNull()
    expect(screen.getByTestId('refresh-button')).toBeEnabled()
    // the models table was reloaded so the staged row appears
    expect(callsTo(mock, '/api/admin/models')).toBe(modelsBefore + 1)
  })

  it('shows a friendly message when the backend answers 409 (already running)', async () => {
    vi.useFakeTimers()
    const backend = makeBackend([ACTIVE_V1])
    backend.startConflict = true
    installFetch(backend)
    render(<Admin />)
    await flush()

    fireEvent.click(screen.getByTestId('refresh-button'))
    await flush()

    expect(screen.getByTestId('refresh-notice')).toHaveTextContent(
      'A refresh is already running — progress is shown below.',
    )
    // it attaches to the running refresh instead of erroring
    expect(screen.getByTestId('refresh-status')).toHaveTextContent('Refreshing — started')
    expect(screen.getByTestId('refresh-button')).toBeDisabled()
    expect(screen.queryByTestId('refresh-error')).toBeNull()
  })

  it('shows the error panel with the error text and retry restarts the refresh', async () => {
    vi.useFakeTimers()
    const backend = makeBackend([ACTIVE_V1])
    const mock = installFetch(backend)
    render(<Admin />)
    await flush()

    fireEvent.click(screen.getByTestId('refresh-button'))
    await flush()

    backend.refresh = {
      running: false,
      started_at: backend.refresh.started_at,
      finished_at: new Date().toISOString(),
      error: 'nflverse download failed: HTTP 502',
      staged_version: null,
      message: null,
    }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })

    const panel = screen.getByTestId('refresh-error')
    expect(panel).toHaveTextContent('Refresh failed')
    expect(panel).toHaveTextContent('nflverse download failed: HTTP 502')
    expect(screen.getByTestId('refresh-button')).toBeEnabled()

    const startsBefore = callsTo(mock, '/api/admin/refresh', 'POST')
    fireEvent.click(screen.getByTestId('refresh-retry'))
    await flush()
    expect(callsTo(mock, '/api/admin/refresh', 'POST')).toBe(startsBefore + 1)
    expect(screen.getByTestId('refresh-status')).toHaveTextContent('Refreshing — started')
    expect(screen.queryByTestId('refresh-error')).toBeNull()
  })
})

// ---------- data sources card ----------

describe('Data sources card', () => {
  it('lists both sources and surfaces ADP errors from the last refresh', async () => {
    const backend = makeBackend([ACTIVE_V1])
    backend.dashboard = {
      ...EMPTY_DASHBOARD,
      last_refresh: {
        finished_at: new Date().toISOString(),
        version: 'v20250728_090000',
        adp_errors: { '2024': 'HTTP 403', '2026': 'timeout' },
      },
    }
    installFetch(backend)
    render(<Admin />)

    const card = await screen.findByTestId('data-sources')
    expect(within(card).getByText('nflverse')).toBeInTheDocument()
    expect(within(card).getByText('FantasyFootballCalculator')).toBeInTheDocument()
    expect(await within(card).findByTestId('adp-errors')).toHaveTextContent(
      'Last refresh could not fetch ADP for: 2024, 2026',
    )
  })
})
