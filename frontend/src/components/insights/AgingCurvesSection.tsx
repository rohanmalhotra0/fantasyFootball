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
import { POS_COLORS, POS_LABELS, pct } from './positions'

/**
 * One small-multiple line chart per position: mean PPR points by years of
 * experience. Single series per chart, so identity never rides on hue;
 * per-bucket n lives in the tooltip AND in the text line under each chart,
 * and every chart carries a plain-text takeaway.
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
    <div className="rounded-xl border-2 border-slate-300 bg-white p-3 shadow-md">
      <p className="font-bold">Year {b.label}</p>
      <p>
        Mean {b.mean_points.toFixed(0)} pts · median {b.median_points.toFixed(0)}
      </p>
      <p>
        {b.mean_ppg.toFixed(1)} ppg · {pct(b.ratio_vs_peak)} of peak
      </p>
      <p className="text-slate-600">n = {b.n} seasons</p>
    </div>
  )
}

function CurveCard({ curve }: { curve: PositionAgingCurve }) {
  const color = POS_COLORS[curve.position] ?? '#334155'
  const counts = curve.buckets.map((b) => b.n)
  return (
    <div className="card space-y-2">
      <h3 className="text-lg font-bold" style={{ color }}>
        {POS_LABELS[curve.position] ?? curve.position}
      </h3>
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={curve.buckets} margin={{ top: 8, right: 16, bottom: 20, left: 0 }}>
            <CartesianGrid stroke="#e2e8f0" strokeWidth={1} vertical={false} />
            <XAxis
              dataKey="label"
              label={{ value: 'Years of experience', position: 'insideBottom', offset: -12 }}
              tick={{ fill: '#475569' }}
            />
            <YAxis tick={{ fill: '#475569' }} width={44} />
            <Tooltip content={<BucketTooltip />} />
            <Line
              type="monotone"
              dataKey="mean_points"
              name="Mean PPR points"
              stroke={color}
              strokeWidth={2}
              dot={{ r: 3, fill: color, strokeWidth: 0 }}
              activeDot={{ r: 5 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="font-bold text-slate-800">{takeaway(curve)}</p>
      <p className="text-sm text-slate-600">
        Seasons per bucket (year 0 → {curve.buckets[curve.buckets.length - 1]?.label}):{' '}
        {counts.join(', ')}
      </p>
    </div>
  )
}

export default function AgingCurvesSection({ data, error }: Props) {
  return (
    <section className="space-y-4" data-testid="insights-aging" aria-label="Aging curves">
      <div>
        <h2 className="text-2xl font-bold">
          <span aria-hidden="true">📉</span> Aging curves
        </h2>
        <p className="text-slate-600">
          Average PPR points by years in the league, per position — where careers climb, plateau,
          and fall off.
        </p>
      </div>
      {error && (
        <p role="alert" className="card font-bold">
          <span aria-hidden="true">⚠️</span> {error}
        </p>
      )}
      {!data && !error && <div className="card h-56 animate-pulse bg-slate-100" />}
      {data && (
        <>
          <div className="grid gap-6 lg:grid-cols-2">
            {data.positions.map((curve) => (
              <CurveCard key={curve.position} curve={curve} />
            ))}
          </div>
          <p className="text-sm text-slate-600">{data.note}</p>
        </>
      )}
    </section>
  )
}
