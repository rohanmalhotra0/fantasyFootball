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
      <p data-testid="opponent-tracker" role="status" className="text-lg text-slate-600">
        Loading team outlooks…
      </p>
    )
  }

  return (
    <div data-testid="opponent-tracker" className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {outlooks.map((team) => {
        const filled = team.slots.filter((s) => s.player_name != null).length
        const isMe = team.team_index === state.my_slot
        const likelyNext = team.needs.slice(0, 2).join(' or ')
        return (
          <section
            key={team.team_index}
            aria-label={`Team outlook: ${team.name}`}
            className={`card space-y-2 ${isMe ? 'border-blue-400 bg-blue-50' : ''}`}
          >
            <h3 className="text-xl font-bold">
              {team.name}
              {isMe && <span className="ml-2 text-blue-800">(you)</span>}
            </h3>
            <p>
              <span className="font-bold">
                {filled}/{team.slots.length}
              </span>{' '}
              slots filled
            </p>
            <p>
              Projected: <span className="font-bold">{Math.round(team.projected_points)} pts</span>
            </p>
            {team.needs.length > 0 ? (
              <>
                <p className="flex flex-wrap gap-2">
                  {team.needs.map((pos) => (
                    <span
                      key={pos}
                      className="whitespace-nowrap rounded-lg border-2 border-amber-400 bg-amber-50 px-2 py-0.5 font-bold text-amber-900"
                    >
                      needs {pos}
                    </span>
                  ))}
                </p>
                {likelyNext && (
                  <p className="text-slate-700">
                    Likely next: <span className="font-bold">{likelyNext}</span>
                  </p>
                )}
              </>
            ) : (
              <p className="font-bold text-green-800">
                <span aria-hidden="true">✅</span> Roster full
              </p>
            )}
          </section>
        )
      })}
    </div>
  )
}
