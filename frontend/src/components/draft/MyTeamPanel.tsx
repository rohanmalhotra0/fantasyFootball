// Right rail: my roster so far, needs, strengths vs the league, undo,
// and the voice panel. Undo lives here so it's always reachable but
// never competes with the one primary Draft button.

import type { DraftState, TeamOutlook } from '../../lib/types'
import VoicePanel from '../voice/VoicePanel'
import { PosChip } from './RecCard'

/** "QB, RB1, RB2, WR1, FLEX, BN1…" — number a slot only when its type
 *  appears more than once. */
export function slotLabels(slots: { slot: string }[]): string[] {
  const totals = new Map<string, number>()
  for (const s of slots) totals.set(s.slot, (totals.get(s.slot) ?? 0) + 1)
  const seen = new Map<string, number>()
  return slots.map((s) => {
    const n = (seen.get(s.slot) ?? 0) + 1
    seen.set(s.slot, n)
    return (totals.get(s.slot) ?? 0) > 1 ? `${s.slot}${n}` : s.slot
  })
}

interface MyTeamPanelProps {
  state: DraftState
  outlook: TeamOutlook | null
  outlooks: TeamOutlook[]
  onUndo: () => void
  onVoiceCommitted: () => void
  busy: boolean
}

export default function MyTeamPanel({
  state,
  outlook,
  outlooks,
  onUndo,
  onVoiceCommitted,
  busy,
}: MyTeamPanelProps) {
  const labels = outlook ? slotLabels(outlook.slots) : []
  const others = outlooks.filter((t) => t.team_index !== state.my_slot)
  const leagueAvg =
    others.length > 0 ? others.reduce((sum, t) => sum + t.projected_points, 0) / others.length : null
  const diff = outlook && leagueAvg != null ? Math.round(outlook.projected_points - leagueAvg) : null

  return (
    <section data-testid="my-team-panel" aria-label="My team" className="card space-y-4">
      <h2 className="text-2xl font-bold">
        <span aria-hidden="true">🧢</span> My team
      </h2>

      {outlook == null ? (
        <p className="text-slate-600">Loading your roster…</p>
      ) : (
        <>
          <p className="text-lg">
            Projected: <span className="font-bold">{Math.round(outlook.projected_points)} pts</span>
          </p>
          {diff != null && (
            <p
              className={`text-lg font-bold ${diff >= 0 ? 'text-green-800' : 'text-red-800'}`}
            >
              {diff >= 0 ? (
                <>
                  <span aria-hidden="true">▲</span> {diff} pts above league average
                </>
              ) : (
                <>
                  <span aria-hidden="true">▼</span> {Math.abs(diff)} pts below league average
                </>
              )}
            </p>
          )}
          {outlook.needs.length > 0 && (
            <p className="flex flex-wrap gap-2" aria-label={`Needs: ${outlook.needs.join(', ')}`}>
              {outlook.needs.map((pos) => (
                <span
                  key={pos}
                  className="whitespace-nowrap rounded-lg border-2 border-amber-400 bg-amber-50 px-2 py-0.5 font-bold text-amber-900"
                >
                  needs {pos}
                </span>
              ))}
            </p>
          )}
          <ul className="space-y-1.5">
            {outlook.slots.map((slot, i) => (
              <li
                key={`${slot.slot}-${i}`}
                className="flex items-center gap-3 rounded-lg bg-slate-50 px-3 py-1.5"
              >
                <span className="w-16 shrink-0 font-bold text-slate-600">{labels[i]}</span>
                {slot.player_name ? (
                  <>
                    <span className="truncate font-bold" title={slot.player_name}>
                      {slot.player_name}
                    </span>
                    {slot.position && <PosChip position={slot.position} />}
                  </>
                ) : (
                  <span className="text-slate-400">— open</span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {state.picks.length > 0 && (
        <button
          type="button"
          className="btn-secondary w-full justify-center"
          data-testid="undo-button"
          disabled={busy}
          onClick={onUndo}
        >
          <span aria-hidden="true">↩</span> Undo last pick
        </button>
      )}

      <VoicePanel draftId={state.id} onCommitted={onVoiceCommitted} />
    </section>
  )
}
