import { useCallback, useEffect, useState } from 'react'
import RankScatter from '../components/charts/RankScatter'
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

export default function Backtest() {
  const [years, setYears] = useState<number[] | null>(null)
  const [year, setYear] = useState<number | null>(null)
  const [data, setData] = useState<BacktestYearResponse | null>(null)
  const [teams, setTeams] = useState(12)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

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
      <div className="card max-w-xl space-y-3">
        <h1 className="text-2xl font-bold">
          <span aria-hidden="true">📈</span> Backtests
        </h1>
        <p>No backtest data yet — run a refresh from the Data page first.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-3xl font-bold">Backtests</h1>
        <label className="flex flex-col gap-1 font-bold">
          Season
          <select
            data-testid="year-select"
            value={year ?? ''}
            onChange={(e) => setYear(Number(e.target.value))}
            className="rounded-xl border-2 border-slate-300 bg-white px-4 py-2 text-lg font-normal"
          >
            {(years ?? []).map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && (
        <div role="alert" className="card space-y-3">
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
        <div aria-busy="true" aria-label="Loading backtest" className="grid gap-6 lg:grid-cols-2">
          <div className="card h-96 animate-pulse bg-slate-100" />
          <div className="card h-96 animate-pulse bg-slate-100" />
        </div>
      )}

      {data && (
        <>
          <div className="grid gap-6 lg:grid-cols-2">
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
                className="card space-y-3"
                data-testid="adp-scatter"
                aria-label="ADP rank vs actual finish"
              >
                <h2 className="text-xl font-bold">ADP rank vs actual finish, {data.season}</h2>
                <p className="text-slate-600">
                  <span aria-hidden="true">📭</span> {NO_ADP_MESSAGE}
                </p>
              </section>
            )}
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
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

          <section className="card space-y-4" aria-label="Error by position">
            <h2 className="text-xl font-bold">Error by position</h2>
            <p className="text-slate-600">
              Spearman: higher = better ordering. MAE: average points missed by, lower = better.
            </p>
            <div className="overflow-x-auto">
              <table data-testid="position-errors" className="w-full max-w-xl text-left">
                <thead>
                  <tr className="border-b-2 border-slate-200">
                    <th scope="col" className="py-2 pr-3">
                      Pos
                    </th>
                    <th scope="col" className="py-2 pr-3">
                      Players
                    </th>
                    <th scope="col" className="py-2 pr-3">
                      Spearman
                    </th>
                    <th scope="col" className="py-2">
                      MAE
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {positionRows(data.metrics).map((row) => (
                    <tr key={row.position} className="border-b border-slate-100">
                      <th scope="row" className="py-2 pr-3 font-bold">
                        {row.position}
                      </th>
                      <td className="py-2 pr-3 tabular-nums">{row.n}</td>
                      <td className="py-2 pr-3 tabular-nums">{row.spearman_model.toFixed(2)}</td>
                      <td className="py-2 tabular-nums">{row.mae_model.toFixed(1)}</td>
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
