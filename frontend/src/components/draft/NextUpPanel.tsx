// The "what do I do right now" panel. My turn: top-5 recommendations with
// one giant Draft button. Someone else's turn: log their pick.

import type { BoardPlayer, DraftState, Recommendation, RecommendationsResponse } from '../../lib/types'
import PickSearch from './PickSearch'
import RecCard from './RecCard'

interface NextUpPanelProps {
  state: DraftState
  recs: RecommendationsResponse | null
  /** Remaining pool for manual entry. */
  pool: BoardPlayer[]
  onDraft: (rec: Recommendation) => void
  onLogPick: (player: BoardPlayer) => void
  busy: boolean
}

export default function NextUpPanel({
  state,
  recs,
  pool,
  onDraft,
  onLogPick,
  busy,
}: NextUpPanelProps) {
  const onClockName =
    state.on_clock_team != null
      ? (state.team_names[state.on_clock_team - 1]?.trim() || `Team ${state.on_clock_team}`)
      : ''

  if (recs == null) {
    return (
      <div data-testid="next-up" aria-busy="true" className="space-y-4">
        <p role="status" className="text-xl font-bold text-ink-3">
          Working out the best picks…
        </p>
        <div className="skeleton h-40" />
        <div className="skeleton h-40" />
      </div>
    )
  }

  const myTurn = recs.my_turn
  const top5 = recs.recommendations.slice(0, 5)

  return (
    <div data-testid="next-up" className="space-y-4">
      {!myTurn && (
        <section className="card animate-slide-up space-y-4">
          <h2 className="section-title text-2xl">On the clock: {onClockName}</h2>
          {recs.picks_until_my_turn != null && (
            <p className="text-lg text-ink-2">
              Your turn in{' '}
              <span className="font-display font-bold text-accent-2">
                {recs.picks_until_my_turn}
              </span>{' '}
              {recs.picks_until_my_turn === 1 ? 'pick' : 'picks'}. Log their pick when they make it:
            </p>
          )}
          <PickSearch
            players={pool}
            actionLabel="Log pick"
            onPick={onLogPick}
            busy={busy}
            inputLabel={`Who did ${onClockName} take?`}
          />
        </section>
      )}

      <h2 className="section-title text-2xl">
        <span aria-hidden="true">🎯</span> Next up for you
      </h2>
      {top5.length === 0 ? (
        <p className="card text-lg text-ink-3">
          No recommendations yet — the board may still be loading, or the pool is empty.
        </p>
      ) : (
        top5.map((rec, i) => (
          <RecCard key={rec.player_id} rec={rec} index={i} myTurn={myTurn} onDraft={onDraft} busy={busy} />
        ))
      )}

      {myTurn && (
        <details className="card">
          <summary className="cursor-pointer text-lg font-bold text-ink-2 transition-colors hover:text-ink">
            <span aria-hidden="true">🔎</span> Pick someone else
          </summary>
          <div className="mt-4">
            <PickSearch
              players={pool}
              actionLabel="Draft"
              onPick={onLogPick}
              busy={busy}
              inputLabel="Search the remaining pool"
            />
          </div>
        </details>
      )}
    </div>
  )
}
