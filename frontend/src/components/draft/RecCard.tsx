// One recommendation card. Card 0 on my turn carries THE primary action
// of the whole room: the giant "Draft {name}" button.

import type { Recommendation } from '../../lib/types'

const POS_COLORS: Record<string, string> = {
  QB: 'bg-pos-qb',
  RB: 'bg-pos-rb',
  WR: 'bg-pos-wr',
  TE: 'bg-pos-te',
  K: 'bg-pos-k',
  DST: 'bg-pos-dst',
}

/** Tiny local position chip (the board's PositionChip has a different
 *  owner). Position text is always inside the chip — color is never the
 *  only signal. */
export function PosChip({ position, team }: { position: string; team?: string | null }) {
  const bg = POS_COLORS[position] ?? 'bg-slate-600'
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-lg px-2 py-0.5 text-base font-bold text-white ${bg}`}
    >
      {position}
      {team ? <span className="font-normal opacity-90">· {team}</span> : null}
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

  return (
    <article
      data-testid={`rec-card-${index}`}
      className={`card space-y-3 ${isTop && myTurn ? 'border-4 border-blue-600 bg-blue-50' : ''}`}
      aria-label={`Recommendation ${index + 1}: ${rec.name}`}
    >
      <div className="flex flex-wrap items-center gap-3">
        <span
          aria-hidden="true"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-800 text-xl font-bold text-white"
        >
          {index + 1}
        </span>
        <span className={`font-bold ${isTop ? 'text-2xl' : 'text-xl'}`}>{rec.name}</span>
        <PosChip position={rec.position} team={rec.team} />
        {rec.tier != null && (
          <span className="whitespace-nowrap rounded-lg border-2 border-slate-400 bg-slate-100 px-2 py-0.5 font-bold text-slate-800">
            Tier {rec.tier}
          </span>
        )}
      </div>

      <p className="text-lg">
        <span className="font-bold">
          {rec.projected_points != null ? `${Math.round(rec.projected_points)} pts` : 'No projection'}
        </span>
        {rec.vorp != null && (
          <span className="text-slate-700">
            {' '}
            · VORP {rec.vorp >= 0 ? '+' : ''}
            {Math.round(rec.vorp)}
          </span>
        )}
        {rec.risk_flag && (
          <span className="ml-2 whitespace-nowrap rounded-lg bg-amber-100 px-2 py-0.5 font-bold text-amber-900">
            <span aria-hidden="true">⚠️</span> thin sample
          </span>
        )}
      </p>

      {survivalPct != null && (
        <div>
          <div className="h-3 w-full overflow-hidden rounded-full bg-slate-200" aria-hidden="true">
            <div
              className={`h-full rounded-full ${survivalPct >= 50 ? 'bg-emerald-600' : 'bg-red-500'}`}
              style={{ width: `${survivalPct}%` }}
            />
          </div>
          <p className="mt-1 text-base text-slate-700">
            {survivalPct}% likely available next turn
          </p>
        </div>
      )}

      <p className="text-lg font-bold">
        <span aria-hidden="true">💡</span> {rec.reason}
      </p>

      {myTurn &&
        (isTop ? (
          <button
            type="button"
            className="btn-primary w-full justify-center text-2xl"
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
