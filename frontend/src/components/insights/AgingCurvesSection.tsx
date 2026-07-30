import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { AgingBucket, AgingCurvesResponse, PositionAgingCurve } from '../../lib/types'
import {
  CHART_EDGE,
  CHART_INK_2,
  CHART_INK_3,
  POS_CHIP,
  POS_CHIP_FALLBACK,
  POS_COLORS,
  POS_LABELS,
  pct,
} from './positions'

/**
 * One small-multiple line chart per position: mean PPR points by years of
 * experience. Single series per chart, so identity never rides on hue (the
 * panel's line may wear its position hue — one series per panel); per-bucket
 * n lives in the tooltip AND in the ink-3 caption under each chart, and
 * every chart carries a plain-text takeaway.
 */
interface Props {
  data: AgingCurvesResponse | null
  error: string | null
}

function takeaway(curve: PositionAgingCurve): string {
  const peak = curve.buckets.find((b) => b.experience === curve.peak_experience)
  const last = curve.buckets[curve.buckets.length - 1]
  if (!peak || !last) return ''
  if (last.experience === curve.peak_experience) {
    return `Averages peak in the final bucket (year ${peak.label}, ${peak.mean_points.toFixed(0)} pts) — the few who last that long are the survivors.`
  }
  return `Peak in year ${peak.label} (${peak.mean_points.toFixed(0)} pts avg); by year ${last.label} output falls to ${pct(last.ratio_vs_peak)} of peak.`
}

interface TooltipPayloadItem {
  payload: AgingBucket
}

function BucketTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: TooltipPayloadItem[]
}) {
  if (!active || !payload || payload.length === 0) return null
  const b = payload[0].payload
  return (
    <div className="rounded-xl border border-edge bg-surface p-3 text-ink shadow-card">
      <p className="font-bold">Year {b.label}</p>
      <p className="text-ink-2">
        Mean <span className="font-bold text-ink tabular-nums">{b.mean_points.toFixed(0)}</span> pts
        · median <span className="font-bold text-ink tabular-nums">{b.median_points.toFixed(0)}</span>
      </p>
      <p className="text-ink-2 tabular-nums">
        {b.mean_ppg.toFixed(1)} ppg · {pct(b.ratio_vs_peak)} of peak
      </p>
      <p className="text-ink-3">n = {b.n} seasons</p>
    </div>
  )
}

function CurveCard({ curve }: { curve: PositionAgingCurve }) {
  const color = POS_COLORS[curve.position] ?? CHART_INK_3
  const chip = POS_CHIP[curve.position] ?? POS_CHIP_FALLBACK
  const counts = curve.buckets.map((b) => b.n)
  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className={`chip whitespace-nowrap border text-ink ${chip.chip}`}>
          <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-sm ${chip.dot}`} />
          {curve.position}
        </span>
        <h3 className="section-title">{POS_LABELS[curve.position] ?? curve.position}</h3>
      </div>
      <div className="rounded-xl border border-edge/50 bg-bg/40 p-2">
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={curve.buckets} margin={{ top: 8, right: 16, bottom: 20, left: 0 }}>
              <CartesianGrid stroke={CHART_EDGE} strokeOpacity={0.5} strokeWidth={1} vertical={false} />
              <XAxis
                dataKey="label"
                label={{
                  value: 'Years of experience',
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
                tick={{ fill: CHART_INK_3, fontSize: 14 }}
                tickLine={{ stroke: CHART_EDGE }}
                axisLine={{ stroke: CHART_EDGE }}
                width={44}
              />
              <Tooltip content={<BucketTooltip />} cursor={{ stroke: CHART_INK_3, strokeDasharray: '4 4' }} />
              <Line
                type="monotone"
                dataKey="mean_points"
                name="Mean PPR points"
                stroke={color}
                strokeWidth={2.5}
                dot={{ r: 3, fill: color, strokeWidth: 0 }}
                activeDot={{ r: 5 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
      <p className="font-bold text-ink">{takeaway(curve)}</p>
      <p className="text-ink-3">
        Seasons per bucket (year 0 → {curve.buckets[curve.buckets.length - 1]?.label}):{' '}
        {counts.join(', ')}
      </p>
    </div>
  )
}

export default function AgingCurvesSection({ data, error }: Props) {
  return (
    <section
      className="animate-slide-up space-y-4"
      data-testid="insights-aging"
      aria-label="Aging curves"
    >
      <div>
        <h2 className="font-display text-2xl font-bold tracking-tight">
          <span aria-hidden="true">📉</span> Aging curves
        </h2>
        <p className="text-ink-2">
          Average PPR points by years in the league, per position — where careers climb, plateau,
          and fall off.
        </p>
      </div>
      {error && (
        <p role="alert" className="card border-warn/50 font-bold text-ink">
          <span aria-hidden="true">⚠️</span> {error}
        </p>
      )}
      {!data && !error && <div className="skeleton h-56" />}
      {data && (
        <>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {data.positions.map((curve) => (
              <CurveCard key={curve.position} curve={curve} />
            ))}
          </div>
          <p className="text-ink-3">{data.note}</p>
        </>
      )}
    </section>
  )
}
