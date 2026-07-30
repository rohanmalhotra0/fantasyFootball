import { useCallback, useEffect, useState } from 'react'
import RankScatter from '../components/charts/RankScatter'
import PositionChip from '../components/board/PositionChip'
import HitsBustsTable from '../components/research/HitsBustsTable'
import SimulatorPanel from '../components/research/SimulatorPanel'
import { api } from '../lib/api'
import type { BacktestYearResponse, YearMetrics } from '../lib/types'

const NO_ADP_MESSAGE = 'ADP history not cached — refresh where FFC is reachable'

/** Comparable Spearman numbers for the headline (drafted subset when ADP exists). */
function spearmanSummary(metrics: YearMetrics): string {
  const adp = metrics.spearman_adp_drafted
  const model =
    adp !== null ? (metrics.spearman_model_drafted ?? metrics.spearman_model) : metrics.spearman_model
  if (adp === null) {
    return `Model Spearman ${model.toFixed(2)} — naive baseline ${metrics.spearman_naive.toFixed(2)}`
  }
  const verb = model >= adp ? 'beats' : 'trails'
  return `Model Spearman ${model.toFixed(2)} — ${verb} ADP ${adp.toFixed(2)}`
}

interface PositionErrorRow {
  position: string
  n: number
  spearman_model: number
  mae_model: number
}

function positionRows(metrics: YearMetrics): PositionErrorRow[] {
  return Object.entries(metrics.per_position).map(([position, m]) => ({
    position,
    n: m.n,
    spearman_model: m.spearman_model,
    mae_model: m.mae_model,
  }))
}

/**
 * The one-line story: model vs the crowd vs the naive baseline, on the
 * comparable drafted subset when ADP exists. The leader wears a trophy
 * badge — icon + word, never color alone.
 */
function StoryChips({ metrics }: { metrics: YearMetrics }) {
  const adp = metrics.spearman_adp_drafted
  const model =
    adp !== null ? (metrics.spearman_model_drafted ?? metrics.spearman_model) : metrics.spearman_model
  const naive =
    adp !== null ? (metrics.spearman_naive_drafted ?? metrics.spearman_naive) : metrics.spearman_naive

  const entries: { key: string; label: string; value: number }[] = [
    { key: 'model', label: 'Model', value: model },
    ...(adp !== null ? [{ key: 'adp', label: 'ADP (crowd)', value: adp }] : []),
    { key: 'naive', label: 'Naive baseline', value: naive },
  ]
  const best = entries.reduce((a, b) => (b.value > a.value ? b : a))

  return (
    <div data-testid="story-chips" className="flex flex-wrap items-center gap-2.5">
      <span className="font-bold text-ink-2">Rank accuracy (Spearman):</span>
      {entries.map((e) => {
        const leads = e.key === best.key
        return (
          <span
            key={e.key}
            className={`chip border-2 ${
              leads ? 'border-accent/60 bg-accent/10 text-ink' : 'border-edge bg-raised/60 text-ink-2'
            }`}
          >
            <span>{e.label}</span>
            <span className="font-display tabular-nums text-ink">{e.value.toFixed(2)}</span>
            {leads && (
              <span className="text-accent">
                <span aria-hidden="true">🏆</span> leads
              </span>
            )}
          </span>
        )
      })}
      <span className="text-ink-3">
        {metrics.n_players} players scored
        {metrics.n_drafted !== null ? `, ${metrics.n_drafted} drafted` : ''}
      </span>
    </div>
  )
}

export default function Backtest() {
  const [years, setYears] = useState<number[] | null>(null)
  const [year, setYear] = useState<number | null>(null)
  const [data, setData] = useState<BacktestYearResponse | null>(null)
  const [teams, setTeams] = useState(12)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Route announcement for screen readers + tab identity (WCAG 2.4.2).
  useEffect(() => {
    document.title = 'Backtests — DraftEngine'
  }, [])

  useEffect(() => {
    api
      .backtestYears()
      .then((resp) => {
        setYears(resp.years)
        if (resp.years.length > 0) {
          setYear(resp.years[resp.years.length - 1]) // newest first pick
        } else {
          setLoading(false)
        }
      })
      .catch((err) => {
        setYears([])
        setError(err instanceof Error ? err.message : 'Could not load backtest years.')
        setLoading(false)
      })
    // League size for the simulator slot input; a miss keeps the 12 default.
    api
      .getSettings()
      .then((s) => setTeams(s.settings.teams))
      .catch(() => undefined)
  }, [])

  const loadYear = useCallback(async (y: number) => {
    setLoading(true)
    setError(null)
    try {
      setData(await api.backtestYear(y))
    } catch (err) {
      setData(null)
      setError(err instanceof Error ? err.message : `Could not load ${y}.`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (year !== null) void loadYear(year)
  }, [year, loadYear])

  if (years !== null && years.length === 0 && !error) {
    return (
      <div className="card max-w-xl animate-slide-up space-y-3">
        <h1 className="section-title text-2xl">
          <span aria-hidden="true">📈</span> Backtests
        </h1>
        <p className="text-ink-2">No backtest data yet — run a refresh from the Data page first.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Analyst-desk header strip: season picker + the one-line story. */}
      <header className="card-hero animate-slide-up space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1">
            <p className="font-bold text-accent">
              <span aria-hidden="true">📈</span> Analyst desk
            </p>
            <h1 className="font-display text-3xl font-bold tracking-tight">Backtests</h1>
            <p className="text-ink-2">How the model's preseason board held up against reality.</p>
          </div>
          <label className="flex flex-col gap-1 font-bold">
            <span className="text-ink-2">Season</span>
            <select
              data-testid="year-select"
              value={year ?? ''}
              onChange={(e) => setYear(Number(e.target.value))}
              className="cursor-pointer rounded-xl border-2 border-edge bg-raised/60 px-5 py-2.5 font-display text-xl font-bold text-ink transition-colors hover:border-accent/60"
            >
              {(years ?? []).map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
        </div>
        {data ? (
          <StoryChips metrics={data.metrics} />
        ) : (
          !error && <div className="skeleton h-10 max-w-2xl" aria-hidden="true" />
        )}
      </header>

      {error && (
        <div role="alert" className="card animate-slide-up space-y-3 border-bad/50">
          <p className="font-bold">
            <span aria-hidden="true">⚠️</span> {error}
          </p>
          {year !== null && (
            <button type="button" className="btn-primary" onClick={() => void loadYear(year)}>
              <span aria-hidden="true">↻</span> Retry
            </button>
          )}
        </div>
      )}

      {loading && !data && !error && (
        <div aria-busy="true" aria-label="Loading backtest" className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="skeleton h-96" />
          <div className="skeleton h-96" />
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-1 animate-slide-up gap-6 lg:grid-cols-2">
            <RankScatter
              title={`Model rank vs actual finish, ${data.season}`}
              xLabel="Model rank"
              points={data.model_scatter}
              testId="model-scatter"
              summary={spearmanSummary(data.metrics)}
            />
            {data.adp_scatter ? (
              <RankScatter
                title={`ADP rank vs actual finish, ${data.season}`}
                xLabel="ADP rank"
                points={data.adp_scatter}
                testId="adp-scatter"
                summary={
                  data.metrics.spearman_adp_drafted !== null
                    ? `ADP Spearman ${data.metrics.spearman_adp_drafted.toFixed(2)} on the same season.`
                    : `How the crowd's draft order predicted ${data.season}.`
                }
              />
            ) : (
              <section
                className="card flex min-h-[20rem] flex-col gap-3"
                data-testid="adp-scatter"
                aria-label="ADP rank vs actual finish"
              >
                <h2 className="section-title">ADP rank vs actual finish, {data.season}</h2>
                <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-edge/70 bg-raised/30 p-6">
                  <p className="max-w-sm text-center text-ink-2">
                    <span aria-hidden="true" className="block text-3xl">
                      📭
                    </span>
                    {NO_ADP_MESSAGE}
                  </p>
                </div>
              </section>
            )}
          </div>

          <div className="grid grid-cols-1 animate-slide-up gap-6 lg:grid-cols-2">
            <HitsBustsTable
              title="Hits — model found value"
              rows={data.hits}
              exportTestId="export-hits"
              tableTestId="hits-table"
              exportFilename={`hits-${data.season}.csv`}
            />
            <HitsBustsTable
              title="Busts — model was fooled"
              rows={data.busts}
              exportTestId="export-busts"
              tableTestId="busts-table"
              exportFilename={`busts-${data.season}.csv`}
            />
          </div>

          <section className="card animate-slide-up space-y-4" aria-label="Error by position">
            <h2 className="section-title">Error by position</h2>
            <p className="text-ink-2">
              Spearman: higher = better ordering. MAE: average points missed by, lower = better.
            </p>
            <div className="table-shell overflow-x-auto">
              <table data-testid="position-errors" className="w-full max-w-xl text-left">
                <thead>
                  <tr>
                    <th scope="col">Pos</th>
                    <th scope="col">Players</th>
                    <th scope="col">Spearman</th>
                    <th scope="col">MAE</th>
                  </tr>
                </thead>
                <tbody>
                  {positionRows(data.metrics).map((row) => (
                    <tr key={row.position}>
                      <th scope="row" className="!static !bg-transparent !text-ink">
                        <PositionChip position={row.position} />
                      </th>
                      <td className="tabular-nums">{row.n}</td>
                      <td className="tabular-nums">{row.spearman_model.toFixed(2)}</td>
                      <td className="tabular-nums">{row.mae_model.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <SimulatorPanel year={data.season} teams={teams} />
        </>
      )}
    </div>
  )
}
