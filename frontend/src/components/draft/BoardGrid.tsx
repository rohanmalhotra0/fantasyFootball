// Snake draft grid: teams across, rounds down. Picked cells are buttons
// that open the edit dialog; the live cell shouts ON CLOCK. Every filled
// cell wears its position's hue as a left border + tint — the name and
// position text inside carry the meaning, the color is just identity.

import type { DraftState, PickOut } from '../../lib/types'
import { slotToOverall } from '../../lib/draftStore'

const POS_CELL: Record<string, string> = {
  QB: 'border-l-pos-qb bg-pos-qb/15',
  RB: 'border-l-pos-rb bg-pos-rb/15',
  WR: 'border-l-pos-wr bg-pos-wr/15',
  TE: 'border-l-pos-te bg-pos-te/15',
  K: 'border-l-pos-k bg-pos-k/15',
  DST: 'border-l-pos-dst bg-pos-dst/15',
}

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
    <div data-testid="board-grid" className="card overflow-x-auto p-4">
      <table className="min-w-max border-separate border-spacing-1">
        <caption className="sr-only">
          Draft board: one column per team, one row per round
        </caption>
        <thead>
          <tr>
            <th scope="col" className="px-2 py-2 text-left text-base text-ink-3">
              Rd
            </th>
            {teams.map((t) => (
              <th
                key={t}
                scope="col"
                className={`px-2 py-2 text-base ${
                  t === state.my_slot
                    ? 'rounded-lg bg-accent/15 font-bold text-accent shadow-glow-sm'
                    : 'font-bold text-ink-2'
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
              <th scope="row" className="px-2 py-1 text-left text-base font-bold text-ink-3">
                R{round}
              </th>
              {teams.map((t) => {
                const overall = slotToOverall(round, t, state.teams)
                const pick = byOverall.get(overall)
                const isCurrent = overall === state.current_overall
                const base = 'h-full w-36 rounded-lg px-2 py-1.5 text-left text-base'
                if (pick) {
                  const posCls = POS_CELL[pick.position] ?? 'border-l-edge bg-raised/60'
                  return (
                    <td key={t} className="align-top">
                      <button
                        type="button"
                        data-testid={`grid-cell-${overall}`}
                        data-player-id={pick.player_id}
                        title={`${pick.player_name} — pick ${overall}. Click to edit.`}
                        aria-label={`Edit pick ${overall}: ${pick.player_name}`}
                        onClick={() => onEditPick(pick)}
                        className={`${base} animate-slide-up border border-l-4 border-edge/50 transition-shadow hover:shadow-glow-sm hover:ring-2 hover:ring-accent/60 ${posCls}`}
                      >
                        <span className="block max-w-[8rem] truncate font-bold text-ink">
                          {pick.player_name}
                        </span>
                        <span className="mt-0.5 flex items-center gap-1.5">
                          <span className="text-sm font-bold text-ink-2">{pick.position}</span>
                          <span className="text-sm tabular-nums text-ink-3">#{overall}</span>
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
                          ? 'animate-pulse-ring border-2 border-accent bg-accent/10 font-bold text-accent'
                          : 'border border-dashed border-edge/60 text-ink-3'
                      }`}
                    >
                      {isCurrent ? (
                        <span>
                          <span aria-hidden="true">⏱</span> ON CLOCK
                        </span>
                      ) : (
                        <span className="tabular-nums">#{overall}</span>
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
