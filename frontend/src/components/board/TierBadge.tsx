// Tier chip: always shows the tier number as text ("T3") — the tint is
// only a secondary cue, never the signal itself.

const TIER_STYLES = [
  'border-amber-500 bg-amber-100 text-amber-900', // T1
  'border-orange-500 bg-orange-100 text-orange-900', // T2
  'border-lime-600 bg-lime-100 text-lime-900', // T3
  'border-emerald-600 bg-emerald-100 text-emerald-900', // T4
  'border-sky-600 bg-sky-100 text-sky-900', // T5
  'border-indigo-500 bg-indigo-100 text-indigo-900', // T6
  'border-violet-500 bg-violet-100 text-violet-900', // T7
  'border-slate-400 bg-slate-100 text-slate-700', // T8
]

export default function TierBadge({ tier }: { tier: number | null }) {
  if (tier == null) {
    return <span className="text-slate-400">—</span>
  }
  const style = TIER_STYLES[Math.min(Math.max(tier, 1), TIER_STYLES.length) - 1]
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-lg border-2 px-2.5 py-0.5 font-bold ${style}`}
    >
      T{tier}
    </span>
  )
}
