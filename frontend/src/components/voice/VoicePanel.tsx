// Voice mode: continuous listening -> server-side matching -> confirm/undo
// toast -> commit through the normal picks endpoint. Degrades to a plain
// notice card when the browser has no speech support or the mic is blocked.

import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../lib/api'
import { createRecognizer, isSpeechSupported, speak, type Recognizer } from '../../lib/speech'
import type { VoiceCandidate, VoiceParseResponse } from '../../lib/types'
import ConfirmToast from './ConfirmToast'
import VoiceSettings, { loadSpeakEnabled, saveSpeakEnabled } from './VoiceSettings'

export interface VoicePanelProps {
  draftId: number
  /** Called after a voice pick is committed so the room can refetch. */
  onCommitted: () => void
  /** Optional: when this flips to true (and spoken replies are on) the panel
   *  announces "You are on the clock" with the top recommendation. */
  myTurn?: boolean
}

/** Frontend auto-commit policy — mirrors the backend voice route's constants:
 *  confident enough AND clearly ahead of the runner-up. */
const AUTO_CONFIDENCE = 0.92
const AUTO_GAP = 0.08
const NOTICE_TTL_MS = 8000

interface Notice {
  kind: 'info' | 'warning'
  text: string
}

interface PendingToast {
  id: number
  mode: 'auto' | 'confirm'
  best: VoiceCandidate
  alternatives: VoiceCandidate[]
  teamIndex: number | null
  reason: string
  error: string | null
}

function teamLabel(teamIndex: number | null): string {
  return teamIndex !== null ? `Team ${teamIndex}` : 'team on the clock'
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export default function VoicePanel({ draftId, onCommitted, myTurn }: VoicePanelProps) {
  const [supported] = useState(() => isSpeechSupported())
  const [micBlocked, setMicBlocked] = useState(false)
  const [on, setOn] = useState(false)
  const [lastHeard, setLastHeard] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [pending, setPending] = useState<PendingToast | null>(null)
  const [speakEnabled, setSpeakEnabled] = useState(loadSpeakEnabled)

  const unavailableRef = useRef<HTMLElement | null>(null)

  // When the mic gets blocked, the toggle the user just pressed unmounts.
  // Move focus onto the replacement card so keyboard users don't fall back
  // to <body> (and screen readers hear the explanation).
  useEffect(() => {
    if (micBlocked) unavailableRef.current?.focus()
  }, [micBlocked])

  const recognizerRef = useRef<Recognizer | null>(null)
  /** Monotonic id per heard utterance; a toast is only committable while it
   *  is still the latest utterance (never double-commit / commit stale). */
  const utteranceIdRef = useRef(0)
  const commitLockRef = useRef(false)
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const speakEnabledRef = useRef(speakEnabled)
  useEffect(() => {
    speakEnabledRef.current = speakEnabled
  }, [speakEnabled])

  const clearNoticeTimer = useCallback(() => {
    if (noticeTimerRef.current !== null) {
      clearTimeout(noticeTimerRef.current)
      noticeTimerRef.current = null
    }
  }, [])

  const showNotice = useCallback(
    (kind: Notice['kind'], text: string) => {
      setNotice({ kind, text })
      clearNoticeTimer()
      noticeTimerRef.current = setTimeout(() => {
        noticeTimerRef.current = null
        setNotice(null)
      }, NOTICE_TTL_MS)
    },
    [clearNoticeTimer],
  )

  const handleParseResponse = useCallback(
    (resp: VoiceParseResponse, id: number) => {
      if (!resp.matched || resp.best === null) {
        // NEVER auto-commit an unmatched utterance — just explain why.
        const alreadyDrafted = resp.reason.toLowerCase().includes('already drafted')
        showNotice(alreadyDrafted ? 'warning' : 'info', resp.reason)
        return
      }
      const runnerUp = resp.alternatives[0]?.confidence ?? 0
      const gap = resp.best.confidence - runnerUp
      const auto = resp.best.confidence >= AUTO_CONFIDENCE && gap >= AUTO_GAP
      setPending({
        id,
        mode: auto ? 'auto' : 'confirm',
        best: resp.best,
        alternatives: resp.alternatives.slice(0, 3),
        teamIndex: resp.team_index,
        reason: resp.reason,
        error: null,
      })
    },
    [showNotice],
  )

  const handleTranscript = useCallback(
    (text: string) => {
      const id = utteranceIdRef.current + 1
      utteranceIdRef.current = id
      setLastHeard(text)
      setNotice(null)
      clearNoticeTimer()
      // A new utterance always replaces a pending toast (cancels its countdown).
      setPending(null)
      api
        .voiceParse(draftId, text)
        .then((resp) => {
          if (utteranceIdRef.current !== id) return // superseded by a newer utterance
          handleParseResponse(resp, id)
        })
        .catch((err) => {
          if (utteranceIdRef.current !== id) return
          showNotice('warning', errorMessage(err))
        })
    },
    [draftId, handleParseResponse, showNotice, clearNoticeTimer],
  )

  // The recognizer is created once per toggle-on; route its callbacks through
  // refs so they never go stale.
  const transcriptRef = useRef(handleTranscript)
  useEffect(() => {
    transcriptRef.current = handleTranscript
  }, [handleTranscript])

  const stopListening = useCallback(() => {
    recognizerRef.current?.stop()
    recognizerRef.current = null
    setOn(false)
    setPending(null) // never let a countdown run with the mic off
  }, [])

  const startListening = useCallback(() => {
    const recognizer = createRecognizer({
      onFinalTranscript: (text) => transcriptRef.current(text),
      onError: (code) => {
        if (code === 'not-allowed' || code === 'service-not-allowed') {
          recognizerRef.current = null
          setOn(false)
          setPending(null)
          setMicBlocked(true)
        }
        // Transient errors (no-speech, network, aborted) are handled by the
        // recognizer's own auto-restart — nothing to surface.
      },
    })
    if (!recognizer) {
      showNotice('warning', 'Voice is unavailable in this browser')
      return
    }
    recognizerRef.current = recognizer
    recognizer.start()
    setOn(true)
  }, [showNotice])

  // Tear down on unmount.
  useEffect(
    () => () => {
      recognizerRef.current?.stop()
      if (noticeTimerRef.current !== null) clearTimeout(noticeTimerRef.current)
    },
    [],
  )

  const commitPick = useCallback(
    async (toast: PendingToast, candidate: VoiceCandidate) => {
      if (commitLockRef.current) return // a commit is already in flight
      if (utteranceIdRef.current !== toast.id) return // toast was replaced
      commitLockRef.current = true
      try {
        await api.makePick(draftId, {
          player_id: candidate.player_id,
          team_index: toast.teamIndex ?? undefined,
          source: 'voice',
        })
        setPending((p) => (p && p.id === toast.id ? null : p))
        onCommitted()
        speak(`Got it — ${candidate.name} to ${teamLabel(toast.teamIndex)}`, {
          enabled: speakEnabledRef.current,
        })
      } catch (err) {
        // 409 already picked / wrong team etc: show the server message in the
        // toast; nothing was committed.
        setPending((p) => (p && p.id === toast.id ? { ...p, error: errorMessage(err) } : p))
      } finally {
        commitLockRef.current = false
      }
    },
    [draftId, onCommitted],
  )

  // Announce turn changes when spoken replies are on.
  const prevTurnRef = useRef(myTurn === true)
  useEffect(() => {
    const was = prevTurnRef.current
    const now = myTurn === true
    prevTurnRef.current = now
    if (!was && now && speakEnabledRef.current) {
      api
        .recommendations(draftId)
        .then((resp) => {
          const top = resp.recommendations[0]
          speak(top ? `You are on the clock. I suggest ${top.name}` : 'You are on the clock', {
            enabled: speakEnabledRef.current,
          })
        })
        .catch(() => {
          /* the announcement is best-effort */
        })
    }
  }, [myTurn, draftId])

  const handleSpeakChange = useCallback((value: boolean) => {
    setSpeakEnabled(value)
    saveSpeakEnabled(value)
  }, [])

  if (!supported || micBlocked) {
    return (
      <section
        ref={unavailableRef}
        tabIndex={-1}
        className="card space-y-2"
        data-testid="voice-unavailable"
        aria-label="Voice picks unavailable"
      >
        <p className="text-lg font-bold">
          <span aria-hidden="true">🎤</span>{' '}
          {micBlocked
            ? 'Mic blocked — check browser permissions'
            : 'Voice not supported in this browser — use the search box'}
        </p>
      </section>
    )
  }

  return (
    <section className="card space-y-4" aria-label="Voice picks">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="section-title">
          <span aria-hidden="true">🎤</span> Voice picks
        </h2>
        <VoiceSettings speakEnabled={speakEnabled} onSpeakChange={handleSpeakChange} />
      </div>

      <button
        type="button"
        data-testid="voice-toggle"
        aria-pressed={on}
        onClick={on ? stopListening : startListening}
        className={`inline-flex w-full flex-wrap items-center justify-center gap-x-3 gap-y-1.5 rounded-full border-2 px-6 py-4 font-display text-xl font-bold transition-colors ${
          on
            ? 'animate-pulse-ring border-accent bg-accent text-bg'
            : 'border-edge bg-raised/60 text-ink hover:border-accent/60 hover:bg-raised'
        }`}
      >
        <span className="whitespace-nowrap">
          <span aria-hidden="true">🎤</span> Voice: {on ? 'ON' : 'OFF'}
        </span>
        {on && (
          <span className="ml-1 inline-flex items-center gap-2 rounded-full bg-bg/25 px-3.5 py-1 font-sans text-base font-bold uppercase tracking-[0.14em]">
            <span aria-hidden="true" className="relative flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-good opacity-70" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-good" />
            </span>
            listening
          </span>
        )}
      </button>

      <p data-testid="voice-status" aria-live="polite" className="text-lg text-ink-2">
        {lastHeard !== null ? (
          <>
            Heard: <span className="font-bold text-ink">&ldquo;{lastHeard}&rdquo;</span>
          </>
        ) : on ? (
          <>Say a pick — like &ldquo;Team 3 takes Bijan&rdquo;</>
        ) : (
          'Voice is off'
        )}
      </p>

      {notice && (
        <p
          data-testid="voice-notice"
          role="status"
          className={
            notice.kind === 'warning'
              ? 'rounded-xl border-2 border-warn/60 bg-warn/10 px-4 py-3 text-lg font-bold'
              : 'rounded-xl border border-edge bg-raised/50 px-4 py-3 text-lg text-ink-2'
          }
        >
          <span aria-hidden="true">{notice.kind === 'warning' ? '⚠️' : 'ℹ️'}</span>{' '}
          {notice.kind === 'warning' ? 'Heads up: ' : ''}
          {notice.text}
        </p>
      )}

      {pending && (
        <ConfirmToast
          key={pending.id}
          mode={pending.mode}
          best={pending.best}
          alternatives={pending.alternatives}
          teamLabel={teamLabel(pending.teamIndex)}
          reason={pending.reason}
          error={pending.error}
          onCommit={(candidate) => {
            void commitPick(pending, candidate)
          }}
          onDismiss={() => setPending(null)}
        />
      )}
    </section>
  )
}
