import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { VoiceCandidate } from '../../lib/types'

export type ConfirmToastMode = 'auto' | 'confirm'

export interface ConfirmToastProps {
  mode: ConfirmToastMode
  best: VoiceCandidate
  /** Up to 3 tappable alternatives (confirm mode only). */
  alternatives: VoiceCandidate[]
  /** Display name of the team the pick would go to, e.g. "Team 3". */
  teamLabel: string
  reason: string
  /** Server error after a failed commit — flips the toast to its error state. */
  error: string | null
  /** Countdown length for auto mode. */
  seconds?: number
  onCommit: (candidate: VoiceCandidate) => void
  onDismiss: () => void
}

const DEFAULT_SECONDS = 5

export default function ConfirmToast({
  mode,
  best,
  alternatives,
  teamLabel,
  reason,
  error,
  seconds = DEFAULT_SECONDS,
  onCommit,
  onDismiss,
}: ConfirmToastProps) {
  const [remaining, setRemaining] = useState(seconds)
  const firedRef = useRef(false)
  const commitRef = useRef(onCommit)
  useEffect(() => {
    commitRef.current = onCommit
  }, [onCommit])

  // Auto mode: one interval drives the visible countdown, one timeout fires
  // the commit. Unmount (undo / replacement by a newer utterance) or an error
  // cancels both — the commit can never fire after that.
  useEffect(() => {
    if (mode !== 'auto' || error !== null) return undefined
    const interval = setInterval(() => setRemaining((r) => Math.max(0, r - 1)), 1000)
    const commitTimer = setTimeout(() => {
      clearInterval(interval)
      if (!firedRef.current) {
        firedRef.current = true
        commitRef.current(best)
      }
    }, seconds * 1000)
    return () => {
      clearInterval(interval)
      clearTimeout(commitTimer)
    }
  }, [mode, error, best, seconds])

  const barPercent = Math.max(0, Math.min(100, (remaining / seconds) * 100))

  // Portaled to <body>: ancestors with backdrop-filter/transform (e.g. .card,
  // animate-slide-up) would otherwise re-anchor position:fixed to themselves.
  return createPortal(
    <div
      data-testid="voice-toast"
      role="alert"
      className="fixed bottom-6 left-1/2 z-50 w-[min(92vw,36rem)] -translate-x-1/2"
    >
      <div className="card-hero space-y-4 shadow-glow">
        {error !== null ? (
          <>
            <p className="text-xl font-bold text-warn">
              <span aria-hidden="true">⚠️</span> Pick not made
            </p>
            <p data-testid="voice-toast-error" className="text-lg">
              {error}
            </p>
            <button
              type="button"
              data-testid="voice-dismiss"
              className="btn-secondary w-full justify-center text-xl"
              onClick={onDismiss}
              aria-label="Close voice pick message"
            >
              <span aria-hidden="true">✖️</span> Close
            </button>
          </>
        ) : (
          <>
            <p className="font-display text-2xl font-bold">
              &ldquo;{best.name}&rdquo; <span aria-hidden="true">→</span>
              <span className="sr-only">to</span> {teamLabel}
            </p>
            <p className="text-lg text-ink-2">{reason}</p>
            {mode === 'auto' ? (
              <>
                <div className="flex items-center gap-4" aria-hidden="true">
                  <span className="stat-number w-14 text-center text-accent">{remaining}</span>
                  <div className="h-4 flex-1 overflow-hidden rounded-full bg-raised">
                    <div
                      className="h-full rounded-full bg-accent transition-all duration-1000 ease-linear"
                      style={{ width: `${barPercent}%` }}
                    />
                  </div>
                </div>
                <p className="text-lg font-bold">
                  Picking in {remaining}s — tap Undo to cancel
                </p>
                <div className="flex gap-3">
                  <button
                    type="button"
                    data-testid="voice-undo"
                    className="btn-secondary flex-1 justify-center py-4 text-2xl"
                    onClick={onDismiss}
                    aria-label={`Undo — do not pick ${best.name}`}
                  >
                    <span aria-hidden="true">↩️</span> Undo
                  </button>
                  <button
                    type="button"
                    data-testid="voice-confirm"
                    className="btn-primary flex-1 justify-center py-4 text-2xl"
                    onClick={() => onCommit(best)}
                    aria-label={`Confirm ${best.name} now`}
                  >
                    <span aria-hidden="true">✅</span> Now
                  </button>
                </div>
              </>
            ) : (
              <>
                <button
                  type="button"
                  data-testid="voice-confirm"
                  className="btn-primary w-full justify-center py-4 text-2xl"
                  onClick={() => onCommit(best)}
                >
                  <span aria-hidden="true">✅</span> Confirm {best.name}
                </button>
                {alternatives.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-base font-bold text-ink-2">
                      Not right? Tap the correct player:
                    </p>
                    <ul className="space-y-2">
                      {alternatives.map((alt) => (
                        <li key={alt.player_id}>
                          <button
                            type="button"
                            data-testid={`voice-alt-${alt.player_id}`}
                            className="btn-secondary w-full justify-center text-lg"
                            onClick={() => onCommit(alt)}
                          >
                            {alt.name} ({alt.position})
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <button
                  type="button"
                  data-testid="voice-dismiss"
                  className="btn-secondary w-full justify-center"
                  onClick={onDismiss}
                  aria-label="Dismiss voice pick"
                >
                  <span aria-hidden="true">✖️</span> Dismiss
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
