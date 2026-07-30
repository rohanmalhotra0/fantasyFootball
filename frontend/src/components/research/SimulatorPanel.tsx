import { useState } from 'react'
import { ApiError, api } from '../../lib/api'
import { downloadCsv, toCsv, type CsvColumn } from '../../lib/csv'
import PositionChip from '../board/PositionChip'
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

/** Delta stat tile: arrow + signed number + good/bad ink, never color alone. */
function DeltaStat({ diff }: { diff: number }) {
  if (diff > 0) {
    return (
      <p className="stat-number text-good">
        <span aria-hidden="true">▲</span> +{diff.toFixed(1)}
      </p>
    )
  }
  if (diff < 0) {
    return (
      <p className="stat-number text-bad">
        <span aria-hidden="true">▼</span> {diff.toFixed(1)}
      </p>
    )
  }
  return <p className="stat-number text-ink-2">±0.0</p>
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
  const stepTo = (next: number) => setSlot(Math.min(Math.max(next, 1), teams))

  return (
    <section className="card animate-slide-up space-y-5" aria-label="Draft simulator">
      <div className="space-y-1">
        <h2 className="section-title">
          <span aria-hidden="true">🤖</span> What if the model drafted {year} for me?
        </h2>
        <p className="text-ink-2">
          The model picks from your slot; the other {teams - 1} teams draft by that year's ADP.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1 font-bold">
          <label htmlFor="sim-slot-input" className="text-ink-2">
            My draft slot (1–{teams})
          </label>
          <div className="flex items-stretch overflow-hidden rounded-xl border-2 border-edge bg-raised/60">
            <button
              type="button"
              aria-label="Decrease draft slot"
              disabled={running || slot <= 1}
              onClick={() => stepTo(clampedSlot - 1)}
              className="px-4 font-display text-xl font-bold text-ink-2 transition-colors hover:bg-raised hover:text-ink disabled:opacity-40"
            >
              −
            </button>
            <input
              id="sim-slot-input"
              type="number"
              min={1}
              max={teams}
              value={slot}
              onChange={(e) => setSlot(Number(e.target.value))}
              className="w-20 border-x-2 border-edge bg-transparent px-2 py-2.5 text-center font-display text-xl font-bold text-ink [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
            <button
              type="button"
              aria-label="Increase draft slot"
              disabled={running || slot >= teams}
              onClick={() => stepTo(clampedSlot + 1)}
              className="px-4 font-display text-xl font-bold text-ink-2 transition-colors hover:bg-raised hover:text-ink disabled:opacity-40"
            >
              +
            </button>
          </div>
        </div>
        <button
          type="button"
          className="btn-primary relative overflow-hidden px-8 text-xl"
          data-testid="simulate-button"
          disabled={running || clampedSlot !== slot}
          onClick={run}
        >
          {running && (
            <span
              aria-hidden="true"
              className="absolute inset-0 animate-shimmer"
              style={{
                background:
                  'linear-gradient(100deg, transparent 35%, rgb(255 255 255 / 0.35) 50%, transparent 65%)',
                backgroundSize: '200% 100%',
              }}
            />
          )}
          <span aria-hidden="true">▶</span> {running ? 'Simulating…' : 'Run simulation'}
        </button>
      </div>
      {clampedSlot !== slot && (
        <p role="alert" className="font-bold text-bad">
          <span aria-hidden="true">⚠️</span> Slot must be between 1 and {teams}.
        </p>
      )}

      {error && (
        <div role="alert" className="rounded-xl border-2 border-warn/50 bg-warn/10 p-4">
          <p className="font-bold text-warn">
            <span aria-hidden="true">⏳</span> {error}
          </p>
          <button type="button" className="btn-secondary mt-3" onClick={run} disabled={running}>
            <span aria-hidden="true">↻</span> Try again
          </button>
        </div>
      )}

      {result && (
        <div data-testid="sim-result" className="card-hero space-y-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <p className="font-bold text-ink-2">My total</p>
              <p className="stat-number">{result.my_total.toFixed(1)}</p>
            </div>
            <div>
              <p className="font-bold text-ink-2">League median</p>
              <p className="stat-number">{result.league_median.toFixed(1)}</p>
            </div>
            <div>
              <p className="font-bold text-ink-2">My total vs median</p>
              <DeltaStat diff={result.my_total - result.league_median} />
            </div>
          </div>
          <p className="font-bold">{verdictLine(result)}</p>
          {result.opponent_strategy !== 'adp' && (
            <p className="rounded-xl border border-edge bg-raised/60 p-3 text-ink-2">
              <span aria-hidden="true">ℹ️</span> Opponents used a naive strategy — no ADP is
              cached for {result.season}, so their picks are a rough stand-in.
            </p>
          )}
          <div className="table-shell overflow-x-auto">
            <table className="w-full text-left" aria-label="My simulated roster">
              <thead>
                <tr>
                  <th scope="col">Round</th>
                  <th scope="col">Player</th>
                  <th scope="col">Pos</th>
                  <th scope="col">Actual points</th>
                </tr>
              </thead>
              <tbody>
                {result.my_roster.map((pick) => (
                  <tr key={pick.overall}>
                    <td className="tabular-nums">{pick.round}</td>
                    <th scope="row" className="!static !bg-transparent !text-ink">
                      {pick.name}
                    </th>
                    <td>
                      <PositionChip position={pick.position} />
                    </td>
                    <td className="tabular-nums">{pick.points.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details className="group rounded-xl border-2 border-edge/70 bg-bg/30">
            <summary className="cursor-pointer select-none list-none px-4 py-3 font-bold [&::-webkit-details-marker]:hidden">
              <span
                aria-hidden="true"
                className="mr-2 inline-block text-ink-3 transition-transform group-open:rotate-90"
              >
                ▶
              </span>
              Full pick log ({result.log.length} picks)
            </summary>
            <div className="table-shell max-h-96 overflow-auto border-t border-edge/60 px-4 pb-4">
              <table className="w-full text-left" aria-label="Full pick log">
                <thead>
                  <tr>
                    <th scope="col">Pick</th>
                    <th scope="col">Rd</th>
                    <th scope="col">Team</th>
                    <th scope="col">Player</th>
                    <th scope="col">Pos</th>
                    <th scope="col">Points</th>
                  </tr>
                </thead>
                <tbody>
                  {result.log.map((pick) => (
                    <tr key={pick.overall} className={pick.is_me ? 'bg-accent/10 font-bold' : ''}>
                      <td className="tabular-nums">{pick.overall}</td>
                      <td className="tabular-nums">{pick.round}</td>
                      <td>{pick.is_me ? 'Me' : `Team ${pick.team_index}`}</td>
                      <td>{pick.name}</td>
                      <td>{pick.position}</td>
                      <td className="tabular-nums">{pick.points.toFixed(1)}</td>
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
