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
import type { ScatterPoint } from '../../lib/types'

/**
 * Rank-vs-actual-finish scatter. Y axis is REVERSED so rank 1 sits at the
 * top; the dashed diagonal is "prediction was exactly right". Position
 * carries BOTH a theme-reactive hue and a distinct marker shape, and the
 * legend pairs swatch + shape + text — color is never the only signal
 * (4 position hues alone are NOT distinguishable in a scatter).
 *
 * All chart colors are rgb(var(--de-*)) strings so the light/dark toggle
 * swaps the whole chart with the rest of the system.
 */
interface Props {
  title: string
  xLabel: string
  points: ScatterPoint[]
  testId: string
  /** One plain-text line so the chart is never information's only carrier. */
  summary: string
}

const POSITION_ORDER = ['QB', 'RB', 'WR', 'TE', 'K', 'DST']

// Theme tokens (styles/index.css). Strings resolve per-theme at paint time.
const POS_COLORS: Record<string, string> = {
  QB: 'rgb(var(--de-pos-qb))',
  RB: 'rgb(var(--de-pos-rb))',
  WR: 'rgb(var(--de-pos-wr))',
  TE: 'rgb(var(--de-pos-te))',
  K: 'rgb(var(--de-pos-k))',
  DST: 'rgb(var(--de-pos-dst))',
}
const FALLBACK_COLOR = 'rgb(var(--de-ink-3))'
const EDGE = 'rgb(var(--de-edge))'
const INK_2 = 'rgb(var(--de-ink-2))'
const INK_3 = 'rgb(var(--de-ink-3))'

type ShapeName = 'circle' | 'square' | 'triangle' | 'diamond' | 'cross' | 'star'

const POS_SHAPES: Record<string, ShapeName> = {
  QB: 'circle',
  RB: 'square',
  WR: 'triangle',
  TE: 'diamond',
  K: 'cross',
  DST: 'star',
}

function ShapeSwatch({ shape, color }: { shape: ShapeName; color: string }) {
  // fill via style (not attribute) so rgb(var(--…)) always resolves.
  const paint = { fill: color }
  const body = (() => {
    switch (shape) {
      case 'square':
        return <rect x={3} y={3} width={10} height={10} style={paint} />
      case 'triangle':
        return <polygon points="8,2 14,14 2,14" style={paint} />
      case 'diamond':
        return <polygon points="8,1 15,8 8,15 1,8" style={paint} />
      case 'cross':
        return <path d="M6 2h4v4h4v4h-4v4H6v-4H2V6h4z" style={paint} />
      case 'star':
        return (
          <polygon points="8,1 10,6 15,6 11,9.5 12.5,15 8,11.8 3.5,15 5,9.5 1,6 6,6" style={paint} />
        )
      default:
        return <circle cx={8} cy={8} r={6} style={paint} />
    }
  })()
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      {body}
    </svg>
  )
}

interface TooltipPayloadItem {
  payload: ScatterPoint
}

function DotTooltip({
  active,
  payload,
  xLabel,
}: {
  active?: boolean
  payload?: TooltipPayloadItem[]
  xLabel: string
}) {
  if (!active || !payload || payload.length === 0) return null
  const p = payload[0].payload
  return (
    <div className="rounded-xl border border-edge bg-surface p-3 text-ink shadow-card">
      <p className="font-bold">
        {p.name} <span className="text-ink-2">({p.position})</span>
      </p>
      <p className="text-ink-2">
        {xLabel} {p.rank} → finished {p.actual_rank}
      </p>
      <p className="font-display font-bold tabular-nums">{p.actual.toFixed(1)} points</p>
    </div>
  )
}

export default function RankScatter({ title, xLabel, points, testId, summary }: Props) {
  const positions = POSITION_ORDER.filter((pos) => points.some((p) => p.position === pos))
  const maxRank = Math.max(1, ...points.map((p) => Math.max(p.rank, p.actual_rank)))

  return (
    <section className="card space-y-4" data-testid={testId} aria-label={title}>
      <h2 className="section-title">{title}</h2>
      <p className="text-ink-2">{summary}</p>
      <div className="rounded-xl border border-edge/50 bg-bg/40 p-2">
        <div className="h-80 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 12, right: 16, bottom: 24, left: 8 }}>
              <CartesianGrid stroke={EDGE} strokeOpacity={0.5} strokeWidth={1} />
              <XAxis
                type="number"
                dataKey="rank"
                name={xLabel}
                domain={[0, maxRank]}
                label={{ value: xLabel, position: 'insideBottom', offset: -12, fill: INK_2, fontWeight: 700 }}
                tick={{ fill: INK_3, fontSize: 14 }}
                tickLine={{ stroke: EDGE }}
                axisLine={{ stroke: EDGE }}
              />
              <YAxis
                type="number"
                dataKey="actual_rank"
                name="Actual finish"
                reversed
                domain={[0, maxRank]}
                label={{
                  value: 'Actual finish',
                  angle: -90,
                  position: 'insideLeft',
                  fill: INK_2,
                  fontWeight: 700,
                }}
                tick={{ fill: INK_3, fontSize: 14 }}
                tickLine={{ stroke: EDGE }}
                axisLine={{ stroke: EDGE }}
              />
              {/* Dashed diagonal = perfectly predicted. */}
              <ReferenceLine
                segment={[
                  { x: 0, y: 0 },
                  { x: maxRank, y: maxRank },
                ]}
                stroke={INK_3}
                strokeDasharray="6 6"
                strokeWidth={1.5}
              />
              <Tooltip
                content={<DotTooltip xLabel={xLabel} />}
                cursor={{ stroke: INK_3, strokeDasharray: '4 4' }}
              />
              {positions.map((pos) => (
                <Scatter
                  key={pos}
                  name={pos}
                  data={points.filter((p) => p.position === pos)}
                  fill={POS_COLORS[pos] ?? FALLBACK_COLOR}
                  fillOpacity={0.75}
                  shape={POS_SHAPES[pos] ?? 'circle'}
                  // JS-driven entrance motion ignores prefers-reduced-motion;
                  // decorative only, so it stays off.
                  isAnimationActive={false}
                />
              ))}
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </div>
      {/* Legend: swatch shape + color + text label, never color alone. */}
      <ul aria-label={`${title} legend`} className="flex flex-wrap gap-x-6 gap-y-2">
        {positions.map((pos) => (
          <li key={pos} className="flex items-center gap-2 font-bold text-ink-2">
            <ShapeSwatch shape={POS_SHAPES[pos] ?? 'circle'} color={POS_COLORS[pos] ?? FALLBACK_COLOR} />
            {pos}
          </li>
        ))}
      </ul>
      <p className="text-ink-3">
        Dots on the dashed diagonal were predicted exactly right. Dots above it finished better
        than expected; dots below it finished worse.
      </p>
    </section>
  )
}
