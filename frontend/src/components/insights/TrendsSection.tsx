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
import {
  CHART_EDGE,
  CHART_INK_3,
  CHART_SURFACE,
  POS_CHIP,
  POS_CHIP_FALLBACK,
  POS_COLORS,
  POS_DASHES,
  SERIES_ORDER,
  pct,
} from './positions'

/**
 * Era trends since the first covered season: a stacked share-of-scoring
 * area chart and a top-12-average line chart, one y-axis each. Series
 * order keeps the CVD-colliding WR/TE hues apart, stacked bands get a
 * 2px surface-colored separator, and lines carry per-position dash
 * patterns so hue is never the only signal. Each chart has a computed
 * text takeaway, and tooltips are theme-token cards.
 */
interface Props {
  data: TrendsResponse | null
  error: string | null
}

/** Shared theme-token tooltip skin (recharts default content, restyled). */
const TOOLTIP_CONTENT_STYLE = {
  backgroundColor: 'rgb(var(--de-surface))',
  border: '1px solid rgb(var(--de-edge))',
  borderRadius: 12,
  boxShadow: '0 8px 30px -12px rgb(0 0 0 / 0.45)',
} as const
const TOOLTIP_LABEL_STYLE = { color: 'rgb(var(--de-ink))', fontWeight: 700 } as const
// Item text stays in ink — text never wears the series color.
const TOOLTIP_ITEM_STYLE = { color: 'rgb(var(--de-ink-2))' } as const

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

/** Highlighted plain-text takeaway line — the chart never carries the story alone. */
function Takeaway({ text }: { text: string }) {
  return (
    <p className="flex items-start gap-2 rounded-xl bg-raised/60 px-3 py-2 font-bold text-ink">
      <span aria-hidden="true">💡</span> {text}
    </p>
  )
}

function DashSwatch({ color, dash }: { color: string; dash?: string }) {
  return (
    <svg width={28} height={8} viewBox="0 0 28 8" aria-hidden="true" focusable="false">
      <line
        x1={1}
        y1={4}
        x2={27}
        y2={4}
        style={{ stroke: color }}
        strokeWidth={3}
        strokeDasharray={dash}
      />
    </svg>
  )
}

function SeriesLegend({ dashed }: { dashed: boolean }) {
  return (
    <ul aria-label="Positions" className="flex flex-wrap gap-2">
      {SERIES_ORDER.map((pos) => {
        const skin = POS_CHIP[pos] ?? POS_CHIP_FALLBACK
        return (
          <li key={pos} className={`chip whitespace-nowrap border text-ink ${skin.chip}`}>
            {dashed ? (
              <DashSwatch color={POS_COLORS[pos]} dash={POS_DASHES[pos]} />
            ) : (
              <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-sm ${skin.dot}`} />
            )}
            {pos}
          </li>
        )
      })}
    </ul>
  )
}

export default function TrendsSection({ data, error }: Props) {
  const seasons = data?.seasons ?? []
  return (
    <section
      className="animate-slide-up space-y-4"
      data-testid="insights-trends"
      aria-label="Era trends"
    >
      <div>
        <h2 className="font-display text-2xl font-bold tracking-tight">
          <span aria-hidden="true">🕰️</span> Era trends
        </h2>
        <p className="text-ink-2">
          How the league&apos;s scoring pie has shifted between positions since{' '}
          {seasons[0]?.season ?? 1999} — the RB-decline / WR-rise story in two charts.
        </p>
      </div>
      {error && (
        <p role="alert" className="card border-warn/50 font-bold text-ink">
          <span aria-hidden="true">⚠️</span> {error}
        </p>
      )}
      {!data && !error && <div className="skeleton h-64" />}
      {data && (
        <>
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <div className="card space-y-3">
              <h3 className="section-title">Share of league PPR points</h3>
              <Takeaway text={shareTakeaway(seasons)} />
              <div className="rounded-xl border border-edge/50 bg-bg/40 p-2">
                <div className="h-80 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={shareRows(seasons)}
                      margin={{ top: 8, right: 16, bottom: 4, left: 0 }}
                    >
                      <CartesianGrid
                        stroke={CHART_EDGE}
                        strokeOpacity={0.5}
                        strokeWidth={1}
                        vertical={false}
                      />
                      <XAxis
                        dataKey="season"
                        tick={{ fill: CHART_INK_3, fontSize: 14 }}
                        tickLine={{ stroke: CHART_EDGE }}
                        axisLine={{ stroke: CHART_EDGE }}
                      />
                      <YAxis
                        tickFormatter={(v: number) => pct(v)}
                        domain={[0, 1]}
                        tick={{ fill: CHART_INK_3, fontSize: 14 }}
                        tickLine={{ stroke: CHART_EDGE }}
                        axisLine={{ stroke: CHART_EDGE }}
                        width={56}
                      />
                      <Tooltip
                        formatter={(value) => pct(Number(value), 1)}
                        labelFormatter={(season) => `Season ${season}`}
                        contentStyle={TOOLTIP_CONTENT_STYLE}
                        labelStyle={TOOLTIP_LABEL_STYLE}
                        itemStyle={TOOLTIP_ITEM_STYLE}
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
                          stroke={CHART_SURFACE}
                          strokeWidth={2}
                          isAnimationActive={false}
                        />
                      ))}
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <SeriesLegend dashed={false} />
              <p className="text-ink-2">{splitTakeaway(seasons)}</p>
            </div>

            <div className="card space-y-3">
              <h3 className="section-title">Top-12 average by position</h3>
              <Takeaway text={top12Takeaway(seasons)} />
              <div className="rounded-xl border border-edge/50 bg-bg/40 p-2">
                <div className="h-80 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={top12Rows(seasons)}
                      margin={{ top: 8, right: 16, bottom: 4, left: 0 }}
                    >
                      <CartesianGrid
                        stroke={CHART_EDGE}
                        strokeOpacity={0.5}
                        strokeWidth={1}
                        vertical={false}
                      />
                      <XAxis
                        dataKey="season"
                        tick={{ fill: CHART_INK_3, fontSize: 14 }}
                        tickLine={{ stroke: CHART_EDGE }}
                        axisLine={{ stroke: CHART_EDGE }}
                      />
                      <YAxis
                        tick={{ fill: CHART_INK_3, fontSize: 14 }}
                        tickLine={{ stroke: CHART_EDGE }}
                        axisLine={{ stroke: CHART_EDGE }}
                        width={44}
                      />
                      <Tooltip
                        formatter={(value) => `${Number(value).toFixed(0)} pts`}
                        labelFormatter={(season) => `Season ${season}`}
                        contentStyle={TOOLTIP_CONTENT_STYLE}
                        labelStyle={TOOLTIP_LABEL_STYLE}
                        itemStyle={TOOLTIP_ITEM_STYLE}
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
              </div>
              <SeriesLegend dashed />
              <p className="text-ink-2">
                The elite tier at every position scores more than it used to — season length and
                pass volume both grew — but the gap between positions is the draft-strategy signal.
              </p>
            </div>
          </div>
          <p className="text-ink-3">{data.note}</p>
        </>
      )}
    </section>
  )
}
