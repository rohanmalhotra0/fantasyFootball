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
 * top; the diagonal is "prediction was exactly right". Position carries
 * BOTH a fixed hue (the app-wide position colors) and a distinct marker
 * shape, and the legend pairs swatch + shape + text — color is never the
 * only signal (WR blue vs TE purple collapse under deutan CVD).
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

// Fixed app-wide position hues (tailwind.config.js `pos` colors).
const POS_COLORS: Record<string, string> = {
  QB: '#c2410c',
  RB: '#15803d',
  WR: '#1d4ed8',
  TE: '#7e22ce',
  K: '#a16207',
  DST: '#334155',
}

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
  const body = (() => {
    switch (shape) {
      case 'square':
        return <rect x={3} y={3} width={10} height={10} fill={color} />
      case 'triangle':
        return <polygon points="8,2 14,14 2,14" fill={color} />
      case 'diamond':
        return <polygon points="8,1 15,8 8,15 1,8" fill={color} />
      case 'cross':
        return <path d="M6 2h4v4h4v4h-4v4H6v-4H2V6h4z" fill={color} />
      case 'star':
        return <polygon points="8,1 10,6 15,6 11,9.5 12.5,15 8,11.8 3.5,15 5,9.5 1,6 6,6" fill={color} />
      default:
        return <circle cx={8} cy={8} r={6} fill={color} />
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
    <div className="rounded-xl border-2 border-slate-300 bg-white p-3 shadow-md">
      <p className="font-bold">
        {p.name} ({p.position})
      </p>
      <p>
        {xLabel} {p.rank} → finished {p.actual_rank}
      </p>
      <p>{p.actual.toFixed(1)} points</p>
    </div>
  )
}

export default function RankScatter({ title, xLabel, points, testId, summary }: Props) {
  const positions = POSITION_ORDER.filter((pos) => points.some((p) => p.position === pos))
  const maxRank = Math.max(1, ...points.map((p) => Math.max(p.rank, p.actual_rank)))

  return (
    <section className="card space-y-4" data-testid={testId} aria-label={title}>
      <h2 className="text-xl font-bold">{title}</h2>
      <p className="text-slate-700">{summary}</p>
      <div className="h-80 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 8, right: 16, bottom: 24, left: 8 }}>
            <CartesianGrid stroke="#e2e8f0" strokeWidth={1} />
            <XAxis
              type="number"
              dataKey="rank"
              name={xLabel}
              domain={[0, maxRank]}
              label={{ value: xLabel, position: 'insideBottom', offset: -12 }}
              tick={{ fill: '#475569' }}
            />
            <YAxis
              type="number"
              dataKey="actual_rank"
              name="Actual finish"
              reversed
              domain={[0, maxRank]}
              label={{ value: 'Actual finish', angle: -90, position: 'insideLeft' }}
              tick={{ fill: '#475569' }}
            />
            {/* Diagonal = perfectly predicted. */}
            <ReferenceLine
              segment={[
                { x: 0, y: 0 },
                { x: maxRank, y: maxRank },
              ]}
              stroke="#94a3b8"
              strokeWidth={1}
            />
            <Tooltip
              content={<DotTooltip xLabel={xLabel} />}
              cursor={{ strokeDasharray: '4 4' }}
            />
            {positions.map((pos) => (
              <Scatter
                key={pos}
                name={pos}
                data={points.filter((p) => p.position === pos)}
                fill={POS_COLORS[pos] ?? '#334155'}
                shape={POS_SHAPES[pos] ?? 'circle'}
              />
            ))}
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      {/* Legend: swatch shape + color + text label, never color alone. */}
      <ul aria-label={`${title} legend`} className="flex flex-wrap gap-x-6 gap-y-2">
        {positions.map((pos) => (
          <li key={pos} className="flex items-center gap-2 font-bold text-slate-800">
            <ShapeSwatch shape={POS_SHAPES[pos] ?? 'circle'} color={POS_COLORS[pos] ?? '#334155'} />
            {pos}
          </li>
        ))}
      </ul>
      <p className="text-slate-600">
        Dots on the diagonal line were predicted exactly right. Dots above it finished better
        than expected; dots below it finished worse.
      </p>
    </section>
  )
}
