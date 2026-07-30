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
import PositionChip from '../board/PositionChip'
import { api } from '../../lib/api'
import type { ConsistencyPlayer, ConsistencyResponse } from '../../lib/types'
import { CHART_ACCENT, CHART_EDGE, CHART_INK_2, CHART_INK_3, pct } from './positions'

/**
 * Weekly boom/bust explorer for one season: a sortable table of the most
 * relevant per-player numbers plus a PPG-vs-volatility scatter split into
 * quadrants at the medians. The dots are a single accent series (position
 * hues are NOT distinguishable in a scatter — validated), and the quadrant
 * story is also spelled out in plain text so the chart never carries it
 * alone.
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

/** Tiny printed-value bar: the number always sits beside the bar, so the
 *  colored fill is decoration, never the only carrier. */
function RateBar({ rate, tone }: { rate: number; tone: 'good' | 'bad' }) {
  const width = Math.max(0, Math.min(100, rate * 100))
  return (
    <span className="flex items-center gap-2">
      <span
        aria-hidden="true"
        className="h-2 w-10 shrink-0 overflow-hidden rounded-full bg-raised"
      >
        <span
          className={`block h-full rounded-full ${tone === 'good' ? 'bg-good' : 'bg-bad'}`}
          style={{ width: `${width}%` }}
        />
      </span>
      <span className="tabular-nums">{pct(rate)}</span>
    </span>
  )
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
    <div className="rounded-xl border border-edge bg-surface p-3 text-ink shadow-card">
      <p className="font-bold">
        {p.name} <span className="text-ink-2">({p.position})</span>
      </p>
      <p className="text-ink-2 tabular-nums">
        {p.ppg.toFixed(1)} ppg · CV {p.cv.toFixed(2)}
      </p>
      <p className="text-ink-2 tabular-nums">
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
      className="animate-slide-up space-y-4"
      data-testid="insights-consistency"
      aria-label="Consistency explorer"
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-bold tracking-tight">
            <span aria-hidden="true">🎢</span> Consistency &amp; boom/bust
          </h2>
          <p className="text-ink-2">
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
            className="rounded-xl border-2 border-edge bg-surface px-4 py-2 text-lg font-normal text-ink transition-colors hover:border-accent/60"
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
        <p role="alert" className="card border-warn/50 font-bold text-ink">
          <span aria-hidden="true">⚠️</span> {error}
        </p>
      )}
      {loading && !data && <div className="skeleton h-64" />}

      {data && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <div className="card space-y-3">
            <h3 className="section-title">Player profiles, {data.season}</h3>
            <p className="text-ink-2">
              Click a column to sort. Floor / ceiling = 25th / 75th percentile week. Showing top{' '}
              {Math.min(TABLE_ROWS, sorted.length)} of {sorted.length}.
            </p>
            <div className="table-shell max-h-[34rem] overflow-x-auto overflow-y-auto rounded-xl border border-edge/50">
              <table className="w-full text-left">
                <thead>
                  <tr>
                    {COLUMNS.map((col) => (
                      <th
                        key={col.key}
                        scope="col"
                        aria-sort={
                          sortKey === col.key ? (sortDesc ? 'descending' : 'ascending') : 'none'
                        }
                        className="pl-3"
                      >
                        <button
                          type="button"
                          onClick={() => onSort(col.key)}
                          className={`whitespace-nowrap font-bold transition-colors hover:text-accent ${
                            sortKey === col.key ? 'text-accent' : ''
                          }`}
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
                    <tr key={p.player_id}>
                      {/* row headers opt out of the sticky column-header skin */}
                      <th
                        scope="row"
                        className="whitespace-nowrap border-t border-edge/40 pl-3 font-bold !static !bg-transparent !text-ink"
                      >
                        {p.name}
                      </th>
                      <td>
                        <PositionChip position={p.position} />
                      </td>
                      <td className="tabular-nums">{p.ppg.toFixed(1)}</td>
                      <td>
                        <RateBar rate={p.boom_rate} tone="good" />
                      </td>
                      <td>
                        <RateBar rate={p.bust_rate} tone="bad" />
                      </td>
                      <td className="tabular-nums">{p.floor.toFixed(1)}</td>
                      <td className="tabular-nums">{p.ceiling.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card space-y-3">
            <h3 className="section-title">Scoring vs volatility, {data.season}</h3>
            <p className="text-ink-2">
              Quadrants split at the medians ({medPpg.toFixed(1)} ppg, CV {medCv.toFixed(2)}).
              Bottom-right = steady stars ({steadyStars} players: high scoring, low week-to-week
              swing); top-right = volatile stars; bottom-left = steady scrubs; top-left = volatile.
            </p>
            <div className="rounded-xl border border-edge/50 bg-bg/40 p-2">
              <div className="h-80 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 24, right: 16, bottom: 24, left: 8 }}>
                    <CartesianGrid stroke={CHART_EDGE} strokeOpacity={0.5} strokeWidth={1} />
                    <XAxis
                      type="number"
                      dataKey="ppg"
                      name="PPG"
                      label={{
                        value: 'Points per game',
                        position: 'insideBottom',
                        offset: -12,
                        fill: CHART_INK_2,
                        fontWeight: 700,
                      }}
                      tick={{ fill: CHART_INK_3, fontSize: 14 }}
                      tickLine={{ stroke: CHART_EDGE }}
                      axisLine={{ stroke: CHART_EDGE }}
                    />
                    <YAxis
                      type="number"
                      dataKey="cv"
                      name="CV"
                      label={{
                        value: 'Volatility (CV)',
                        angle: -90,
                        position: 'insideLeft',
                        fill: CHART_INK_2,
                        fontWeight: 700,
                      }}
                      tick={{ fill: CHART_INK_3, fontSize: 14 }}
                      tickLine={{ stroke: CHART_EDGE }}
                      axisLine={{ stroke: CHART_EDGE }}
                    />
                    <ReferenceLine
                      x={medPpg}
                      stroke={CHART_INK_3}
                      strokeDasharray="4 4"
                      label={{ value: 'median ppg', position: 'top', fill: CHART_INK_2 }}
                    />
                    <ReferenceLine
                      y={medCv}
                      stroke={CHART_INK_3}
                      strokeDasharray="4 4"
                      label={{ value: 'median CV', position: 'insideRight', fill: CHART_INK_2 }}
                    />
                    <Tooltip
                      content={<DotTooltip />}
                      cursor={{ stroke: CHART_INK_3, strokeDasharray: '4 4' }}
                    />
                    <Scatter
                      data={dots}
                      fill={CHART_ACCENT}
                      fillOpacity={0.75}
                      isAnimationActive={false}
                    />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
            </div>
            <ul aria-label="Quadrant guide" className="grid grid-cols-2 gap-x-6 gap-y-1">
              <li className="text-ink-3">↖ volatile</li>
              <li className="text-ink-3">↗ volatile stars</li>
              <li className="text-ink-3">↙ steady scrubs</li>
              <li className="font-bold text-ink">↘ steady stars</li>
            </ul>
          </div>
        </div>
      )}
    </section>
  )
}
