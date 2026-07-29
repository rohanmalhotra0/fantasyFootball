import { useState } from 'react'
import { ApiError, api } from '../../lib/api'
import { downloadCsv, toCsv, type CsvColumn } from '../../lib/csv'
import type { SimPick, SimulationResponse } from '../../lib/types'

/**
 * "What if the model drafted for me?" — replays a past season with the
 * model picking from the given slot while opponents follow ADP (or a naive
 * baseline when ADP isn't cached). One primary action: Run simulation.
 */
interface Props {
  year: number
  teams: number
}

const LOG_CSV_COLUMNS: CsvColumn<SimPick>[] = [
  { header: 'overall', value: (p) => p.overall },
  { header: 'round', value: (p) => p.round },
  { header: 'team', value: (p) => p.team_index },
  { header: 'name', value: (p) => p.name },
  { header: 'position', value: (p) => p.position },
  { header: 'points', value: (p) => p.points },
  { header: 'is_me', value: (p) => (p.is_me ? 'yes' : 'no') },
]

function verdictLine(result: SimulationResponse): string {
  const diff = result.my_total - result.league_median
  const points = Math.abs(diff).toFixed(0)
  if (diff > 0) return `Model roster beat the median by ${points} points.`
  if (diff < 0) return `Model roster fell short of the median by ${points} points.`
  return 'Model roster exactly matched the league median.'
}

export default function SimulatorPanel({ year, teams }: Props) {
  const [slot, setSlot] = useState(5)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<SimulationResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    setRunning(true)
    setError(null)
    try {
      setResult(await api.simulate(year, slot))
    } catch (err) {
      setResult(null)
      if (err instanceof ApiError && err.status === 503) {
        setError(
          'The simulator is still warming up on the server — wait a few seconds, then press Run again.',
        )
      } else {
        setError(err instanceof Error ? err.message : 'Simulation failed.')
      }
    } finally {
      setRunning(false)
    }
  }

  const clampedSlot = Math.min(Math.max(slot, 1), teams)

  return (
    <section className="card space-y-4" aria-label="Draft simulator">
      <h2 className="text-xl font-bold">
        <span aria-hidden="true">🤖</span> What if the model drafted {year} for me?
      </h2>
      <p className="text-slate-600">
        The model picks from your slot; the other {teams - 1} teams draft by that year's ADP.
      </p>
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1 font-bold">
          My draft slot (1–{teams})
          <input
            type="number"
            min={1}
            max={teams}
            value={slot}
            onChange={(e) => setSlot(Number(e.target.value))}
            className="w-28 rounded-xl border-2 border-slate-300 px-3 py-2 font-normal"
          />
        </label>
        <button
          type="button"
          className="btn-primary"
          data-testid="simulate-button"
          disabled={running || clampedSlot !== slot}
          onClick={run}
        >
          <span aria-hidden="true">▶</span> {running ? 'Simulating…' : 'Run simulation'}
        </button>
      </div>
      {clampedSlot !== slot && (
        <p role="alert" className="font-bold text-red-800">
          Slot must be between 1 and {teams}.
        </p>
      )}

      {error && (
        <div role="alert" className="rounded-xl border-2 border-amber-300 bg-amber-50 p-4">
          <p className="font-bold">
            <span aria-hidden="true">⏳</span> {error}
          </p>
          <button type="button" className="btn-secondary mt-3" onClick={run} disabled={running}>
            <span aria-hidden="true">↻</span> Try again
          </button>
        </div>
      )}

      {result && (
        <div data-testid="sim-result" className="space-y-4">
          <p className="text-lg font-bold">
            My total {result.my_total.toFixed(1)} vs league median {result.league_median.toFixed(1)}
          </p>
          <p className="text-slate-700">{verdictLine(result)}</p>
          {result.opponent_strategy !== 'adp' && (
            <p className="rounded-xl bg-slate-100 p-3 text-slate-700">
              <span aria-hidden="true">ℹ️</span> Opponents used a naive strategy — no ADP is
              cached for {result.season}, so their picks are a rough stand-in.
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-left" aria-label="My simulated roster">
              <thead>
                <tr className="border-b-2 border-slate-200">
                  <th scope="col" className="py-2 pr-3">
                    Round
                  </th>
                  <th scope="col" className="py-2 pr-3">
                    Player
                  </th>
                  <th scope="col" className="py-2 pr-3">
                    Pos
                  </th>
                  <th scope="col" className="py-2">
                    Actual points
                  </th>
                </tr>
              </thead>
              <tbody>
                {result.my_roster.map((pick) => (
                  <tr key={pick.overall} className="border-b border-slate-100">
                    <td className="py-2 pr-3 tabular-nums">{pick.round}</td>
                    <th scope="row" className="py-2 pr-3 font-bold">
                      {pick.name}
                    </th>
                    <td className="py-2 pr-3">{pick.position}</td>
                    <td className="py-2 tabular-nums">{pick.points.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details className="rounded-xl border-2 border-slate-200 p-4">
            <summary className="cursor-pointer font-bold">
              Full pick log ({result.log.length} picks)
            </summary>
            <div className="mt-3 max-h-96 overflow-auto">
              <table className="w-full text-left" aria-label="Full pick log">
                <thead>
                  <tr className="border-b-2 border-slate-200">
                    <th scope="col" className="py-1 pr-3">
                      Pick
                    </th>
                    <th scope="col" className="py-1 pr-3">
                      Rd
                    </th>
                    <th scope="col" className="py-1 pr-3">
                      Team
                    </th>
                    <th scope="col" className="py-1 pr-3">
                      Player
                    </th>
                    <th scope="col" className="py-1 pr-3">
                      Pos
                    </th>
                    <th scope="col" className="py-1">
                      Points
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {result.log.map((pick) => (
                    <tr
                      key={pick.overall}
                      className={`border-b border-slate-100 ${pick.is_me ? 'bg-blue-50 font-bold' : ''}`}
                    >
                      <td className="py-1 pr-3 tabular-nums">{pick.overall}</td>
                      <td className="py-1 pr-3 tabular-nums">{pick.round}</td>
                      <td className="py-1 pr-3">
                        {pick.is_me ? 'Me' : `Team ${pick.team_index}`}
                      </td>
                      <td className="py-1 pr-3">{pick.name}</td>
                      <td className="py-1 pr-3">{pick.position}</td>
                      <td className="py-1 tabular-nums">{pick.points.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          <button
            type="button"
            className="btn-secondary"
            aria-label="Export full pick log as CSV"
            onClick={() =>
              downloadCsv(
                `simulation-${result.season}-slot${result.slot}.csv`,
                toCsv(result.log, LOG_CSV_COLUMNS),
              )
            }
          >
            <span aria-hidden="true">⬇</span> Export pick log CSV
          </button>
        </div>
      )}
    </section>
  )
}
