// One recommendation card. Card 0 on my turn carries THE primary action
// of the whole room: the giant "Draft {name}" button.

import type { Recommendation } from '../../lib/types'

/** Position identity recipe: tinted bg + colored edge, ink text on top so
 *  the label reads on both themes (color is identity, text is meaning). */
const POS_STYLES: Record<string, string> = {
  QB: 'bg-pos-qb/20 border-pos-qb/60',
  RB: 'bg-pos-rb/20 border-pos-rb/60',
  WR: 'bg-pos-wr/20 border-pos-wr/60',
  TE: 'bg-pos-te/20 border-pos-te/60',
  K: 'bg-pos-k/20 border-pos-k/60',
  DST: 'bg-pos-dst/20 border-pos-dst/60',
}

/** Tiny local position chip (the board's PositionChip has a different
 *  owner). Position text is always inside the chip — color is never the
 *  only signal. */
export function PosChip({ position, team }: { position: string; team?: string | null }) {
  const cls = POS_STYLES[position] ?? 'bg-raised border-edge'
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-lg border px-2 py-0.5 text-base font-bold text-ink ${cls}`}
    >
      {position}
      {team ? <span className="font-normal text-ink-2">· {team}</span> : null}
    </span>
  )
}

interface RecCardProps {
  rec: Recommendation
  index: number
  myTurn: boolean
  onDraft: (rec: Recommendation) => void
  busy?: boolean
}

export default function RecCard({ rec, index, myTurn, onDraft, busy = false }: RecCardProps) {
  const survivalPct = rec.survival_prob == null ? null : Math.round(rec.survival_prob * 100)
  const isTop = index === 0
  const primary = isTop && myTurn

  return (
    <article
      data-testid={`rec-card-${index}`}
      className={`card animate-slide-up space-y-3 ${
        primary ? 'scale-[1.01] border-accent/70 shadow-glow' : ''
      }`}
      aria-label={`Recommendation ${index + 1}: ${rec.name}`}
    >
      <div className="flex flex-wrap items-center gap-3">
        <span
          aria-hidden="true"
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-display text-xl font-bold ${
            isTop ? 'bg-accent text-bg shadow-glow-sm' : 'border border-edge bg-raised text-ink-2'
          }`}
        >
          {index + 1}
        </span>
        <span className={`font-display font-bold tracking-tight ${isTop ? 'text-2xl' : 'text-xl'}`}>
          {rec.name}
        </span>
        <PosChip position={rec.position} team={rec.team} />
        {rec.tier != null && (
          <span className="chip whitespace-nowrap border border-edge bg-raised/70 text-ink-2">
            Tier {rec.tier}
          </span>
        )}
      </div>

      <p className="text-lg">
        <span className="font-bold">
          {rec.projected_points != null ? `${Math.round(rec.projected_points)} pts` : 'No projection'}
        </span>
        {rec.vorp != null && (
          <span className="text-ink-2">
            {' '}
            · VORP {rec.vorp >= 0 ? '+' : ''}
            {Math.round(rec.vorp)}
          </span>
        )}
        {rec.risk_flag && (
          <span className="chip ml-2 whitespace-nowrap border border-warn/50 bg-warn/10 text-warn">
            <span aria-hidden="true">⚠️</span> thin sample
          </span>
        )}
      </p>

      {survivalPct != null && (
        <div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-bold uppercase tracking-[0.14em] text-ink-3">
              Survival odds
            </span>
            <span
              className={`font-display text-lg font-bold tabular-nums ${
                survivalPct >= 50 ? 'text-good' : 'text-bad'
              }`}
            >
              {survivalPct}%
            </span>
          </div>
          <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-raised" aria-hidden="true">
            <div
              className={`h-full rounded-full ${survivalPct >= 50 ? 'bg-good' : 'bg-bad'}`}
              style={{ width: `${survivalPct}%` }}
            />
          </div>
          <p className="mt-1 text-base text-ink-2">{survivalPct}% likely available next turn</p>
        </div>
      )}

      <p className="text-lg font-bold text-accent-2">
        <span aria-hidden="true">💡</span> {rec.reason}
      </p>

      {myTurn &&
        (isTop ? (
          <button
            type="button"
            className="btn-primary w-full justify-center py-4 text-2xl"
            data-testid="draft-best-button"
            disabled={busy}
            onClick={() => onDraft(rec)}
          >
            <span aria-hidden="true">🏈</span> Draft {rec.name}
          </button>
        ) : (
          <button
            type="button"
            className="btn-secondary"
            disabled={busy}
            aria-label={`Draft ${rec.name}`}
            onClick={() => onDraft(rec)}
          >
            <span aria-hidden="true">🏈</span> Draft
          </button>
        ))}
    </article>
  )
}
