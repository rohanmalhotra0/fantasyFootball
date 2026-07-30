// The room's headline: who is on the clock, how far along the draft is,
// and whether we're live. My pick gets the accent treatment + tab title.

import { useEffect } from 'react'
import type { DraftState } from '../../lib/types'
import type { ConnectionStatus } from '../../lib/ws'

const CONNECTION_LABELS: Record<ConnectionStatus, { icon: string; text: string; cls: string }> = {
  connecting: { icon: '🟡', text: 'Connecting…', cls: 'border-amber-400 bg-amber-50 text-amber-900' },
  live: { icon: '🟢', text: 'Live', cls: 'border-green-500 bg-green-50 text-green-900' },
  reconnecting: {
    icon: '🟠',
    text: 'Reconnecting…',
    cls: 'border-amber-400 bg-amber-50 text-amber-900',
  },
  offline: { icon: '🔴', text: 'Offline', cls: 'border-red-400 bg-red-50 text-red-900' },
}

export function ConnectionPill({ connection }: { connection: ConnectionStatus }) {
  const { icon, text, cls } = CONNECTION_LABELS[connection]
  return (
    <span
      role="status"
      aria-label={`Connection: ${text}`}
      className={`inline-flex items-center gap-2 whitespace-nowrap rounded-full border-2 px-3 py-1 font-bold ${cls}`}
    >
      <span aria-hidden="true">{icon}</span> {text}
    </span>
  )
}

interface OnClockBannerProps {
  state: DraftState
  connection: ConnectionStatus
}

export default function OnClockBanner({ state, connection }: OnClockBannerProps) {
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
      className={`card flex-1 space-y-3 ${myTurn ? 'border-4 border-blue-600 bg-blue-50' : ''}`}
    >
      {complete ? (
        <p className="text-3xl font-bold">
          <span aria-hidden="true">🎉</span> Draft complete
        </p>
      ) : myTurn ? (
        <>
          <p className="text-3xl font-bold text-blue-900">
            <span aria-hidden="true">⭐</span> Pick {state.current_overall} — YOUR PICK
          </p>
          <p className="text-lg text-blue-900">{teamName} on the clock — that's you.</p>
        </>
      ) : (
        <p className="text-3xl font-bold">
          Pick {state.current_overall} — {teamName} on the clock
        </p>
      )}
      <div className="flex flex-wrap items-center gap-4">
        <ConnectionPill connection={connection} />
        {!complete && state.current_round != null && (
          <p className="text-lg font-bold text-slate-700">
            Round {state.current_round} of {state.rounds}
          </p>
        )}
      </div>
    </section>
  )
}
