import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { SeasonTrend, TrendsResponse } from '../../lib/types'
import { POS_COLORS, POS_DASHES, SERIES_ORDER, pct } from './positions'

/**
 * Era trends since the first covered season: a stacked share-of-scoring
 * area chart and a top-12-average line chart, one y-axis each. Series
 * order keeps the CVD-colliding WR/TE hues apart, stacked bands get a
 * white 2px separator, and lines carry per-position dash patterns so hue
 * is never the only signal. Each chart has a computed text takeaway.
 */
interface Props {
  data: TrendsResponse | null
  error: string | null
}

interface ShareRow {
  season: number
  [pos: string]: number
}

function shareRows(seasons: SeasonTrend[]): ShareRow[] {
  return seasons.map((s) => {
    const row: ShareRow = { season: s.season }
    for (const pos of SERIES_ORDER) row[pos] = s.positions[pos]?.share ?? 0
    return row
  })
}

function top12Rows(seasons: SeasonTrend[]): ShareRow[] {
  return seasons.map((s) => {
    const row: ShareRow = { season: s.season }
    for (const pos of SERIES_ORDER) row[pos] = s.positions[pos]?.top12_avg ?? 0
    return row
  })
}

function shareTakeaway(seasons: SeasonTrend[]): string {
  const first = seasons[0]
  const last = seasons[seasons.length - 1]
  if (!first || !last) return ''
  const move = (pos: string) =>
    `${pos} ${pct(first.positions[pos]?.share ?? 0)} → ${pct(last.positions[pos]?.share ?? 0)}`
  return `Share of all PPR points, ${first.season} → ${last.season}: ${move('RB')}, ${move('WR')}, ${move('QB')}, ${move('TE')}.`
}

function splitTakeaway(seasons: SeasonTrend[]): string {
  const last = seasons[seasons.length - 1]
  if (!last) return ''
  return `In ${last.season}, receiving production drives ${pct(last.receiving_share)} of PPR scoring, rushing ${pct(last.rush_share)}, passing ${pct(last.pass_share)}.`
}

function top12Takeaway(seasons: SeasonTrend[]): string {
  const first = seasons[0]
  const last = seasons[seasons.length - 1]
  if (!first || !last) return ''
  const move = (pos: string) =>
    `${pos} ${(first.positions[pos]?.top12_avg ?? 0).toFixed(0)} → ${(
      last.positions[pos]?.top12_avg ?? 0
    ).toFixed(0)}`
  return `Average points of the top-12 seasons, ${first.season} → ${last.season}: ${move('QB')}, ${move('RB')}, ${move('WR')}, ${move('TE')}.`
}

function DashSwatch({ color, dash }: { color: string; dash?: string }) {
  return (
    <svg width={28} height={8} viewBox="0 0 28 8" aria-hidden="true" focusable="false">
      <line x1={1} y1={4} x2={27} y2={4} stroke={color} strokeWidth={3} strokeDasharray={dash} />
    </svg>
  )
}

function SeriesLegend({ dashed }: { dashed: boolean }) {
  return (
    <ul aria-label="Positions" className="flex flex-wrap gap-x-6 gap-y-2">
      {SERIES_ORDER.map((pos) => (
        <li key={pos} className="flex items-center gap-2 font-bold text-slate-800">
          {dashed ? (
            <DashSwatch color={POS_COLORS[pos]} dash={POS_DASHES[pos]} />
          ) : (
            <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <rect x={2} y={2} width={12} height={12} rx={3} fill={POS_COLORS[pos]} />
            </svg>
          )}
          {pos}
        </li>
      ))}
    </ul>
  )
}

export default function TrendsSection({ data, error }: Props) {
  const seasons = data?.seasons ?? []
  return (
    <section className="space-y-4" data-testid="insights-trends" aria-label="Era trends">
      <div>
        <h2 className="text-2xl font-bold">
          <span aria-hidden="true">🕰️</span> Era trends
        </h2>
        <p className="text-slate-600">
          How the league&apos;s scoring pie has shifted between positions since{' '}
          {seasons[0]?.season ?? 1999} — the RB-decline / WR-rise story in two charts.
        </p>
      </div>
      {error && (
        <p role="alert" className="card font-bold">
          <span aria-hidden="true">⚠️</span> {error}
        </p>
      )}
      {!data && !error && <div className="card h-64 animate-pulse bg-slate-100" />}
      {data && (
        <>
          <div className="grid gap-6 xl:grid-cols-2">
            <div className="card space-y-3">
              <h3 className="text-lg font-bold">Share of league PPR points</h3>
              <p className="text-slate-700">{shareTakeaway(seasons)}</p>
              <div className="h-80 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={shareRows(seasons)} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
                    <CartesianGrid stroke="#e2e8f0" strokeWidth={1} vertical={false} />
                    <XAxis dataKey="season" tick={{ fill: '#475569' }} />
                    <YAxis
                      tickFormatter={(v: number) => pct(v)}
                      domain={[0, 1]}
                      tick={{ fill: '#475569' }}
                      width={56}
                    />
                    <Tooltip
                      formatter={(value) => pct(Number(value), 1)}
                      labelFormatter={(season) => `Season ${season}`}
                    />
                    {SERIES_ORDER.map((pos) => (
                      <Area
                        key={pos}
                        type="monotone"
                        stackId="share"
                        dataKey={pos}
                        name={pos}
                        fill={POS_COLORS[pos]}
                        fillOpacity={0.85}
                        stroke="#ffffff"
                        strokeWidth={2}
                        isAnimationActive={false}
                      />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <SeriesLegend dashed={false} />
              <p className="text-slate-600">{splitTakeaway(seasons)}</p>
            </div>

            <div className="card space-y-3">
              <h3 className="text-lg font-bold">Top-12 average by position</h3>
              <p className="text-slate-700">{top12Takeaway(seasons)}</p>
              <div className="h-80 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={top12Rows(seasons)} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
                    <CartesianGrid stroke="#e2e8f0" strokeWidth={1} vertical={false} />
                    <XAxis dataKey="season" tick={{ fill: '#475569' }} />
                    <YAxis tick={{ fill: '#475569' }} width={44} />
                    <Tooltip
                      formatter={(value) => `${Number(value).toFixed(0)} pts`}
                      labelFormatter={(season) => `Season ${season}`}
                    />
                    {SERIES_ORDER.map((pos) => (
                      <Line
                        key={pos}
                        type="monotone"
                        dataKey={pos}
                        name={pos}
                        stroke={POS_COLORS[pos]}
                        strokeWidth={2}
                        strokeDasharray={POS_DASHES[pos]}
                        dot={false}
                        isAnimationActive={false}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <SeriesLegend dashed />
              <p className="text-slate-600">
                The elite tier at every position scores more than it used to — season length and
                pass volume both grew — but the gap between positions is the draft-strategy signal.
              </p>
            </div>
          </div>
          <p className="text-sm text-slate-600">{data.note}</p>
        </>
      )}
    </section>
  )
}
