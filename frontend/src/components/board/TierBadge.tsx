// Tier chip: always shows the tier number as text ("T3") — the tint is
// only a secondary cue, never the signal itself. Elite tiers glow with
// the accent pair; the rest stay recessive so the board doesn't shout.

function tierStyle(tier: number): string {
  if (tier === 1) return 'border-accent/60 bg-accent/15 text-accent'
  if (tier === 2) return 'border-accent-2/60 bg-accent-2/15 text-accent-2'
  return 'border-edge bg-raised/60 text-ink-2'
}

export default function TierBadge({ tier }: { tier: number | null }) {
  if (tier == null) {
    return <span className="text-ink-3">—</span>
  }
  return (
    <span
      className={`chip whitespace-nowrap border font-display tabular-nums ${tierStyle(tier)}`}
    >
      T{tier}
    </span>
  )
}
