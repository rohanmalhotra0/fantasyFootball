// Broadcast tape: the last ~12 picks scroll across one line under the
// banner, like a stadium ticker. Purely decorative — screen readers get
// the real board — so the whole strip is aria-hidden. Hover or focus
// pauses the tape; prefers-reduced-motion freezes it via the global CSS.

import type { DraftState } from '../../lib/types'

const TAPE_LENGTH = 12

/** Position tint recipe shared with the board: tinted bg + ink text so the
 *  label survives both themes (color is identity, text is the meaning). */
const POS_TAPE: Record<string, string> = {
  QB: 'bg-pos-qb/20',
  RB: 'bg-pos-rb/20',
  WR: 'bg-pos-wr/20',
  TE: 'bg-pos-te/20',
  K: 'bg-pos-k/20',
  DST: 'bg-pos-dst/20',
}

/** "Jahmyr Gibbs" -> "J. Gibbs" (single-word names pass through). */
export function shortName(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length < 2) return name
  return `${parts[0][0]}. ${parts.slice(1).join(' ')}`
}

/** "3.04" style round.pick-in-round label. */
export function pickLabel(overall: number, round: number, teams: number): string {
  const inRound = overall - (round - 1) * teams
  return `${round}.${String(inRound).padStart(2, '0')}`
}

export default function PickTicker({ state }: { state: DraftState }) {
  const recent = state.picks.slice(-TAPE_LENGTH)
  if (recent.length === 0) return null

  const teamName = (i: number) => state.team_names[i - 1]?.trim() || `Team ${i}`
  const entries = recent.map((p) => ({
    key: p.overall,
    label: pickLabel(p.overall, p.round, state.teams),
    name: shortName(p.player_name),
    pos: p.position,
    team: teamName(p.team_index),
  }))

  return (
    <div
      aria-hidden="true"
      data-testid="pick-ticker"
      className="group relative overflow-hidden rounded-xl border border-edge/60 bg-surface/70 py-2 backdrop-blur-sm [mask-image:linear-gradient(90deg,transparent,black_5%,black_95%,transparent)]"
    >
      <div className="flex w-max animate-ticker group-hover:[animation-play-state:paused] group-focus-within:[animation-play-state:paused]">
        {[0, 1].map((copy) => (
          <div key={copy} className="flex shrink-0 items-center gap-10 pr-10">
            {entries.map((e) => (
              <span
                key={`${copy}-${e.key}`}
                className="flex items-center gap-2 whitespace-nowrap text-base leading-none"
              >
                <span className="font-mono font-bold tabular-nums text-ink-3">{e.label}</span>
                <span className="font-bold text-ink">{e.name}</span>
                <span
                  className={`rounded px-1.5 py-0.5 text-sm font-bold text-ink ${POS_TAPE[e.pos] ?? 'bg-raised'}`}
                >
                  {e.pos}
                </span>
                <span className="text-ink-2">— {e.team}</span>
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
