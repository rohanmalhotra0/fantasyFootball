import { useEffect, useMemo, useState } from 'react'
import {
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { api } from '../../lib/api'
import type { ConsistencyPlayer, ConsistencyResponse } from '../../lib/types'
import { pct } from './positions'

/**
 * Weekly boom/bust explorer for one season: a sortable table of the most
 * relevant per-player numbers plus a PPG-vs-volatility scatter split into
 * quadrants at the medians. The quadrant story is also spelled out in
 * plain text so the chart never carries it alone.
 */
interface Props {
  /** Seasons with cached weekly data (from the trends response), oldest first. */
  seasons: number[]
}

type SortKey = 'name' | 'position' | 'ppg' | 'boom_rate' | 'bust_rate' | 'floor' | 'ceiling'

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'name', label: 'Player' },
  { key: 'position', label: 'Pos' },
  { key: 'ppg', label: 'PPG' },
  { key: 'boom_rate', label: 'Boom %' },
  { key: 'bust_rate', label: 'Bust %' },
  { key: 'floor', label: 'Floor' },
  { key: 'ceiling', label: 'Ceiling' },
]

const TABLE_ROWS = 40

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  if (sorted.length === 0) return 0
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function compare(a: ConsistencyPlayer, b: ConsistencyPlayer, key: SortKey): number {
  if (key === 'name' || key === 'position') return a[key].localeCompare(b[key])
  return a[key] - b[key]
}

interface ScatterDot {
  name: string
  position: string
  ppg: number
  cv: number
  boom_rate: number
  bust_rate: number
}

interface TooltipPayloadItem {
  payload: ScatterDot
}

function DotTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayloadItem[] }) {
  if (!active || !payload || payload.length === 0) return null
  const p = payload[0].payload
  return (
    <div className="rounded-xl border-2 border-slate-300 bg-white p-3 shadow-md">
      <p className="font-bold">
        {p.name} ({p.position})
      </p>
      <p>
        {p.ppg.toFixed(1)} ppg · CV {p.cv.toFixed(2)}
      </p>
      <p>
        boom {pct(p.boom_rate)} · bust {pct(p.bust_rate)}
      </p>
    </div>
  )
}

export default function ConsistencySection({ seasons }: Props) {
  const [season, setSeason] = useState<number | null>(null)
  const [data, setData] = useState<ConsistencyResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('ppg')
  const [sortDesc, setSortDesc] = useState(true)

  // Default to the newest season once the list arrives.
  useEffect(() => {
    if (season === null && seasons.length > 0) setSeason(seasons[seasons.length - 1])
  }, [seasons, season])

  useEffect(() => {
    if (season === null) return
    let stale = false
    setLoading(true)
    setError(null)
    api
      .analysisConsistency(season)
      .then((resp) => {
        if (!stale) setData(resp)
      })
      .catch((err) => {
        if (!stale) {
          setData(null)
          setError(err instanceof Error ? err.message : `Could not load ${season}.`)
        }
      })
      .finally(() => {
        if (!stale) setLoading(false)
      })
    return () => {
      stale = true
    }
  }, [season])

  const sorted = useMemo(() => {
    if (!data) return []
    const rows = [...data.players].sort((a, b) => compare(a, b, sortKey))
    return sortDesc ? rows.reverse() : rows
  }, [data, sortKey, sortDesc])

  const dots: ScatterDot[] = useMemo(
    () =>
      (data?.players ?? [])
        .filter((p): p is ConsistencyPlayer & { cv: number } => p.cv !== null)
        .map((p) => ({
          name: p.name,
          position: p.position,
          ppg: p.ppg,
          cv: p.cv,
          boom_rate: p.boom_rate,
          bust_rate: p.bust_rate,
        })),
    [data],
  )
  const medPpg = median(dots.map((d) => d.ppg))
  const medCv = median(dots.map((d) => d.cv))
  const steadyStars = dots.filter((d) => d.ppg >= medPpg && d.cv < medCv).length

  const onSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDesc((d) => !d)
    } else {
      setSortKey(key)
      setSortDesc(key !== 'name' && key !== 'position')
    }
  }

  return (
    <section
      className="space-y-4"
      data-testid="insights-consistency"
      aria-label="Consistency explorer"
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">
            <span aria-hidden="true">🎢</span> Consistency &amp; boom/bust
          </h2>
          <p className="text-slate-600">
            Week-to-week reliability: boom = a {data ? data.boom_threshold.toFixed(0) : '20'}+ point
            week, bust = under {data ? data.bust_threshold.toFixed(0) : '5'}. Players with{' '}
            {data ? data.min_games : 6}+ games.
          </p>
        </div>
        <label className="flex flex-col gap-1 font-bold">
          Season
          <select
            data-testid="insights-consistency-season"
            value={season ?? ''}
            onChange={(e) => setSeason(Number(e.target.value))}
            className="rounded-xl border-2 border-slate-300 bg-white px-4 py-2 text-lg font-normal"
          >
            {seasons.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && (
        <p role="alert" className="card font-bold">
          <span aria-hidden="true">⚠️</span> {error}
        </p>
      )}
      {loading && !data && <div className="card h-64 animate-pulse bg-slate-100" />}

      {data && (
        <div className="grid gap-6 xl:grid-cols-2">
          <div className="card space-y-3">
            <h3 className="text-lg font-bold">Player profiles, {data.season}</h3>
            <p className="text-slate-600">
              Click a column to sort. Floor / ceiling = 25th / 75th percentile week. Showing top{' '}
              {Math.min(TABLE_ROWS, sorted.length)} of {sorted.length}.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b-2 border-slate-200">
                    {COLUMNS.map((col) => (
                      <th
                        key={col.key}
                        scope="col"
                        aria-sort={
                          sortKey === col.key ? (sortDesc ? 'descending' : 'ascending') : 'none'
                        }
                        className="py-2 pr-3"
                      >
                        <button
                          type="button"
                          onClick={() => onSort(col.key)}
                          className="font-bold hover:text-blue-800"
                        >
                          {col.label}
                          {sortKey === col.key && (
                            <span aria-hidden="true"> {sortDesc ? '↓' : '↑'}</span>
                          )}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sorted.slice(0, TABLE_ROWS).map((p) => (
                    <tr key={p.player_id} className="border-b border-slate-100">
                      <th scope="row" className="py-2 pr-3 font-bold">
                        {p.name}
                      </th>
                      <td className="py-2 pr-3">{p.position}</td>
                      <td className="py-2 pr-3 tabular-nums">{p.ppg.toFixed(1)}</td>
                      <td className="py-2 pr-3 tabular-nums">{pct(p.boom_rate)}</td>
                      <td className="py-2 pr-3 tabular-nums">{pct(p.bust_rate)}</td>
                      <td className="py-2 pr-3 tabular-nums">{p.floor.toFixed(1)}</td>
                      <td className="py-2 tabular-nums">{p.ceiling.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card space-y-3">
            <h3 className="text-lg font-bold">Scoring vs volatility, {data.season}</h3>
            <p className="text-slate-700">
              Quadrants split at the medians ({medPpg.toFixed(1)} ppg, CV {medCv.toFixed(2)}).
              Bottom-right = steady stars ({steadyStars} players: high scoring, low week-to-week
              swing); top-right = volatile stars; bottom-left = steady scrubs; top-left = volatile.
            </p>
            <div className="h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 8, right: 16, bottom: 24, left: 8 }}>
                  <CartesianGrid stroke="#e2e8f0" strokeWidth={1} />
                  <XAxis
                    type="number"
                    dataKey="ppg"
                    name="PPG"
                    label={{ value: 'Points per game', position: 'insideBottom', offset: -12 }}
                    tick={{ fill: '#475569' }}
                  />
                  <YAxis
                    type="number"
                    dataKey="cv"
                    name="CV"
                    label={{
                      value: 'Volatility (CV)',
                      angle: -90,
                      position: 'insideLeft',
                    }}
                    tick={{ fill: '#475569' }}
                  />
                  <ReferenceLine
                    x={medPpg}
                    stroke="#94a3b8"
                    strokeDasharray="4 4"
                    label={{ value: 'median ppg', position: 'top', fill: '#64748b' }}
                  />
                  <ReferenceLine
                    y={medCv}
                    stroke="#94a3b8"
                    strokeDasharray="4 4"
                    label={{ value: 'median CV', position: 'insideRight', fill: '#64748b' }}
                  />
                  <Tooltip content={<DotTooltip />} cursor={{ strokeDasharray: '4 4' }} />
                  <Scatter data={dots} fill="#334155" fillOpacity={0.75} isAnimationActive={false} />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
            <ul aria-label="Quadrant guide" className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
              <li className="text-slate-600">↖ volatile</li>
              <li className="text-slate-600">↗ volatile stars</li>
              <li className="text-slate-600">↙ steady scrubs</li>
              <li className="font-bold text-slate-800">↘ steady stars</li>
            </ul>
          </div>
        </div>
      )}
    </section>
  )
}
