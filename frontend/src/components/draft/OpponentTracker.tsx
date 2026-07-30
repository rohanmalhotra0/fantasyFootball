// Teams tab: one card per team — how full their roster is, what they
// still need, and what they'll probably take next.

import type { DraftState, TeamOutlook } from '../../lib/types'

export default function OpponentTracker({
  state,
  outlooks,
}: {
  state: DraftState
  outlooks: TeamOutlook[]
}) {
  if (outlooks.length === 0) {
    return (
      <div data-testid="opponent-tracker" aria-busy="true" className="space-y-4">
        <p role="status" className="text-lg text-ink-3">
          Loading team outlooks…
        </p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-48" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div data-testid="opponent-tracker" className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {outlooks.map((team) => {
        const filled = team.slots.filter((s) => s.player_name != null).length
        const isMe = team.team_index === state.my_slot
        const likelyNext = team.needs.slice(0, 2).join(' or ')
        return (
          <section
            key={team.team_index}
            aria-label={`Team outlook: ${team.name}`}
            className={`card animate-slide-up space-y-3 ${
              isMe ? 'border-accent/60 shadow-glow-sm' : ''
            }`}
          >
            {/* h2: sits directly under the room's h1 — no skipped level. */}
            <h2 className="section-title flex flex-wrap items-center gap-2">
              <span className="truncate">{team.name}</span>
              {isMe && <span className="chip bg-accent/15 text-accent">you</span>}
            </h2>

            <div>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-bold uppercase tracking-[0.14em] text-ink-3">
                  Roster
                </span>
                <span className="font-display font-bold tabular-nums text-ink-2">
                  {filled}/{team.slots.length} filled
                </span>
              </div>
              <div
                aria-hidden="true"
                className="mt-1 flex h-2 gap-[3px] overflow-hidden rounded-full"
              >
                {team.slots.map((_, i) => (
                  <span
                    key={i}
                    className={`min-w-[3px] flex-1 rounded-sm ${
                      i < filled ? 'bg-accent-2/80' : 'bg-raised'
                    }`}
                  />
                ))}
              </div>
            </div>

            <p className="text-ink-2">
              Projected:{' '}
              <span className="font-display text-xl font-bold tabular-nums text-ink">
                {Math.round(team.projected_points)} pts
              </span>
            </p>

            {team.needs.length > 0 ? (
              <>
                <p className="flex flex-wrap gap-2">
                  {team.needs.map((pos) => (
                    <span
                      key={pos}
                      className="chip whitespace-nowrap border border-warn/50 bg-warn/10 text-warn"
                    >
                      <span aria-hidden="true">◔</span> needs {pos}
                    </span>
                  ))}
                </p>
                {likelyNext && (
                  <p className="text-ink-2">
                    <span aria-hidden="true">🔮</span> Likely next:{' '}
                    <span className="font-bold text-accent-2">{likelyNext}</span>
                  </p>
                )}
              </>
            ) : (
              <p className="font-bold text-good">
                <span aria-hidden="true">✅</span> Roster full
              </p>
            )}
          </section>
        )
      })}
    </div>
  )
}
