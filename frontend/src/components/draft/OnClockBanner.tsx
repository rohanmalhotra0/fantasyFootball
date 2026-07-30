// The room's headline: who is on the clock, how far along the draft is,
// and whether we're live. My pick gets the accent-glow treatment + tab
// title. The pick timer renders inside the banner so the whole broadcast
// header reads as one card.

import { useEffect, type ReactNode } from 'react'
import type { DraftState } from '../../lib/types'
import type { ConnectionStatus } from '../../lib/ws'
import { pickLabel } from './PickTicker'

const CONNECTION_LABELS: Record<
  ConnectionStatus,
  { text: string; cls: string; pulse: boolean }
> = {
  connecting: { text: 'Connecting…', cls: 'border-warn/60 bg-warn/10 text-warn', pulse: false },
  live: { text: 'Live', cls: 'border-good/60 bg-good/10 text-good', pulse: true },
  reconnecting: { text: 'Reconnecting…', cls: 'border-warn/60 bg-warn/10 text-warn', pulse: false },
  offline: { text: 'Offline', cls: 'border-bad/60 bg-bad/10 text-bad', pulse: false },
}

export function ConnectionPill({ connection }: { connection: ConnectionStatus }) {
  const { text, cls, pulse } = CONNECTION_LABELS[connection]
  return (
    <span
      role="status"
      aria-label={`Connection: ${text}`}
      className={`inline-flex items-center gap-2 whitespace-nowrap rounded-full border-2 px-3 py-1 font-bold ${cls}`}
    >
      <span aria-hidden="true" className="relative flex h-2.5 w-2.5">
        {pulse && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-50" />
        )}
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-current" />
      </span>
      {text}
    </span>
  )
}

/** Segmented rounds bar: one tick per round — filled = done, glowing =
 *  current, hollow = ahead. The "Round X of Y" text carries the meaning. */
function RoundProgress({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <div aria-hidden="true" className="flex h-2 min-w-0 flex-1 gap-[3px] sm:max-w-[16rem]">
        {Array.from({ length: total }, (_, i) => {
          const round = i + 1
          const cls =
            round < current
              ? 'bg-accent/80'
              : round === current
                ? 'bg-accent shadow-glow-sm'
                : 'bg-raised'
          return <span key={round} className={`min-w-[3px] flex-1 rounded-sm ${cls}`} />
        })}
      </div>
      <p className="whitespace-nowrap text-base font-bold text-ink-2">
        Round {current} of {total}
      </p>
    </div>
  )
}

interface OnClockBannerProps {
  state: DraftState
  connection: ConnectionStatus
  /** The PickTimer, rendered inside the banner's right column. */
  timer?: ReactNode
}

export default function OnClockBanner({ state, connection, timer }: OnClockBannerProps) {
  const complete = state.status === 'complete' || state.current_overall == null
  const myTurn = !complete && state.on_clock_team === state.my_slot
  const teamName =
    state.on_clock_team != null
      ? (state.team_names[state.on_clock_team - 1]?.trim() || `Team ${state.on_clock_team}`)
      : ''

  useEffect(() => {
    if (complete) {
      document.title = 'Draft complete — DraftEngine'
    } else if (myTurn) {
      document.title = `⭐ YOUR PICK — Pick ${state.current_overall}`
    } else {
      document.title = `Pick ${state.current_overall} — ${teamName}`
    }
    return () => {
      document.title = 'DraftEngine'
    }
  }, [complete, myTurn, state.current_overall, teamName])

  return (
    <section
      data-testid="on-clock-banner"
      aria-live="polite"
      className={`card-hero animate-slide-up space-y-5 ${
        myTurn ? 'animate-pulse-ring border-accent/70' : ''
      }`}
    >
      <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0 space-y-1.5">
          {complete ? (
            <>
              <p className="flex items-center gap-2 font-bold uppercase tracking-[0.14em] text-ink-3">
                <span aria-hidden="true">🎉</span> Final board
              </p>
              <p className="font-display text-4xl font-bold tracking-tight">Draft complete</p>
            </>
          ) : (
            <>
              <p className="flex flex-wrap items-center gap-3 font-bold uppercase tracking-[0.14em] text-ink-3">
                <span>
                  <span aria-hidden="true">⏱</span> On the clock
                </span>
                {myTurn && (
                  <span className="chip bg-accent text-bg shadow-glow-sm">
                    <span aria-hidden="true">⭐</span> Your pick
                  </span>
                )}
              </p>
              <p className="flex flex-wrap items-baseline gap-x-3">
                <span
                  className={`font-display text-4xl font-bold uppercase leading-none tracking-tight md:text-[3.4rem] ${
                    myTurn ? 'text-accent' : ''
                  }`}
                >
                  Pick {state.current_overall}
                </span>{' '}
                {state.current_overall != null && (
                  <span className="font-mono text-xl font-bold tabular-nums text-ink-3">
                    {pickLabel(
                      state.current_overall,
                      state.current_round ?? Math.ceil(state.current_overall / state.teams),
                      state.teams,
                    )}
                  </span>
                )}
              </p>
              <p className="truncate text-xl font-bold text-ink-2">
                {teamName}
                {myTurn && <span className="text-accent-2"> — that's you</span>}
              </p>
            </>
          )}
        </div>
        {timer && <div className="shrink-0 md:w-64">{timer}</div>}
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-edge/50 pt-4">
        <ConnectionPill connection={connection} />
        {!complete && state.current_round != null && (
          <RoundProgress current={state.current_round} total={state.rounds} />
        )}
      </div>
    </section>
  )
}
