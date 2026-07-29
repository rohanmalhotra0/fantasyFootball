// Snake draft grid: teams across, rounds down. Picked cells are buttons
// that open the edit dialog; the live cell shouts ON CLOCK.

import type { DraftState, PickOut } from '../../lib/types'
import { slotToOverall } from '../../lib/draftStore'
import { PosChip } from './RecCard'

interface BoardGridProps {
  state: DraftState
  onEditPick: (pick: PickOut) => void
}

export default function BoardGrid({ state, onEditPick }: BoardGridProps) {
  const byOverall = new Map<number, PickOut>()
  for (const pick of state.picks) byOverall.set(pick.overall, pick)

  const teamName = (i: number) => state.team_names[i - 1]?.trim() || `Team ${i}`
  const rounds = Array.from({ length: state.rounds }, (_, r) => r + 1)
  const teams = Array.from({ length: state.teams }, (_, t) => t + 1)

  return (
    <div data-testid="board-grid" className="overflow-x-auto">
      <table className="min-w-max border-separate border-spacing-1">
        <caption className="sr-only">
          Draft board: one column per team, one row per round
        </caption>
        <thead>
          <tr>
            <th scope="col" className="px-2 py-2 text-left text-base text-slate-600">
              Rd
            </th>
            {teams.map((t) => (
              <th
                key={t}
                scope="col"
                className={`px-2 py-2 text-base ${
                  t === state.my_slot
                    ? 'rounded-lg bg-blue-100 font-bold text-blue-900'
                    : 'font-bold text-slate-700'
                }`}
              >
                <span className="block max-w-[8rem] truncate" title={teamName(t)}>
                  {teamName(t)}
                  {t === state.my_slot && <span className="block text-sm">(you)</span>}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rounds.map((round) => (
            <tr key={round}>
              <th scope="row" className="px-2 py-1 text-left text-base font-bold text-slate-600">
                R{round}
              </th>
              {teams.map((t) => {
                const overall = slotToOverall(round, t, state.teams)
                const pick = byOverall.get(overall)
                const isCurrent = overall === state.current_overall
                const base = 'h-full w-36 rounded-lg border-2 px-2 py-1.5 text-left text-base'
                if (pick) {
                  return (
                    <td key={t} className="align-top">
                      <button
                        type="button"
                        data-testid={`grid-cell-${overall}`}
                        title={`${pick.player_name} — pick ${overall}. Click to edit.`}
                        aria-label={`Edit pick ${overall}: ${pick.player_name}`}
                        onClick={() => onEditPick(pick)}
                        className={`${base} border-slate-300 bg-white hover:border-blue-500 ${
                          t === state.my_slot ? 'bg-blue-50' : ''
                        }`}
                      >
                        <span className="block max-w-[8rem] truncate font-bold">
                          {pick.player_name}
                        </span>
                        <span className="mt-0.5 flex items-center gap-1.5">
                          <PosChip position={pick.position} />
                          <span className="text-sm text-slate-600">#{overall}</span>
                        </span>
                      </button>
                    </td>
                  )
                }
                return (
                  <td key={t} className="align-top">
                    <div
                      data-testid={`grid-cell-${overall}`}
                      className={`${base} ${
                        isCurrent
                          ? 'border-4 border-blue-600 bg-blue-50 font-bold text-blue-900'
                          : 'border-slate-200 bg-slate-100 text-slate-400'
                      }`}
                    >
                      {isCurrent ? (
                        <span>
                          <span aria-hidden="true">⏱</span> ON CLOCK
                        </span>
                      ) : (
                        <span>#{overall}</span>
                      )}
                    </div>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
