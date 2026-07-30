import { useEffect, useState } from 'react'
import { ApiError, api } from '../../lib/api'
import type { RefreshStatus } from '../../lib/types'

/**
 * One-click "refresh data & retrain" mission-control card.
 *
 * A refresh runs server-side in the background; while it runs we poll
 * /api/admin/refresh/status every 2 seconds and show a shimmer progress
 * strip. The result is only ever a STAGED model — the success panel points
 * the user at the model table below to compare metrics and activate
 * explicitly. Nothing is silent.
 */

const POLL_MS = 2000

type Phase = 'idle' | 'running' | 'done' | 'error'

/** Local wall-clock "14:02" from an ISO timestamp (raw string if unparsable). */
export function clockTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** Indeterminate accent shimmer strip (decorative — the status text carries the state). */
function ShimmerStrip() {
  return (
    <div aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-raised">
      <div
        className="h-full w-full animate-shimmer rounded-full"
        style={{
          backgroundImage:
            'linear-gradient(90deg, rgb(var(--de-accent) / 0.15) 35%, rgb(var(--de-accent)) 50%, rgb(var(--de-accent) / 0.15) 65%)',
          backgroundSize: '200% 100%',
        }}
      />
    </div>
  )
}

export default function RefreshCard({ onFinished }: { onFinished?: () => void }) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [status, setStatus] = useState<RefreshStatus | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [startError, setStartError] = useState<string | null>(null)

  // On mount, pick up a refresh that is already running (or just finished)
  // so navigating away and back never loses the progress/result view.
  useEffect(() => {
    let cancelled = false
    api
      .refreshStatus()
      .then((s) => {
        if (cancelled) return
        setStatus(s)
        if (s.running) setPhase('running')
        else if (s.error) setPhase('error')
        else if (s.staged_version) setPhase('done')
      })
      .catch(() => {
        /* status endpoint unreachable — the button still works */
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Poll while running.
  useEffect(() => {
    if (phase !== 'running') return
    const id = window.setInterval(() => {
      void (async () => {
        try {
          const s = await api.refreshStatus()
          setStatus(s)
          if (!s.running) {
            if (s.error) {
              setPhase('error')
            } else if (s.staged_version) {
              setPhase('done')
              onFinished?.()
            } else {
              // Finished with nothing staged (e.g. server restarted) — reset.
              setPhase('idle')
            }
          }
        } catch {
          /* transient poll failure — keep polling */
        }
      })()
    }, POLL_MS)
    return () => window.clearInterval(id)
  }, [phase, onFinished])

  async function start() {
    setNotice(null)
    setStartError(null)
    try {
      const s = await api.startRefresh()
      setStatus(s)
      setPhase('running')
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // Someone (or another tab) beat us to it — just watch that one.
        setNotice('A refresh is already running — progress is shown below.')
        setPhase('running')
        try {
          setStatus(await api.refreshStatus())
        } catch {
          /* the poll will catch up */
        }
      } else {
        setStartError(err instanceof Error ? err.message : 'Could not start the refresh.')
        setStatus(null)
        setPhase('error')
      }
    }
  }

  const running = phase === 'running'
  const errorText = status?.error ?? startError ?? 'Something went wrong.'

  return (
    <section className="card animate-slide-up space-y-4" aria-label="Data refresh">
      <h2 className="section-title">
        <span aria-hidden="true">🔄</span> Refresh
      </h2>

      <p className="text-ink-2">
        Downloads latest stats + ADP, rebuilds the dataset, trains a new model. The new model is{' '}
        <strong className="text-ink">STAGED</strong> — nothing changes until you activate it below.
      </p>

      <button
        type="button"
        data-testid="refresh-button"
        className="btn-primary px-8 py-4 text-xl"
        disabled={running}
        onClick={() => void start()}
      >
        <span aria-hidden="true">🔄</span> Refresh data &amp; retrain
      </button>

      {notice && (
        <p
          role="status"
          data-testid="refresh-notice"
          className="rounded-xl border-2 border-warn/60 bg-warn/10 p-3 font-bold"
        >
          <span aria-hidden="true">⏳</span> {notice}
        </p>
      )}

      {running && (
        <div
          role="status"
          className="space-y-3 rounded-xl border border-accent/40 bg-accent/10 p-4"
        >
          <p data-testid="refresh-status" className="flex items-center gap-3 text-lg font-bold">
            <span aria-hidden="true" className="relative flex h-3 w-3 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-accent" />
            </span>
            Refreshing — started {clockTime(status?.started_at)}
          </p>
          <ShimmerStrip />
          <p className="text-ink-2">
            Usually a few minutes. You can leave this page — the refresh keeps going.
          </p>
        </div>
      )}

      {phase === 'done' && (
        <div role="status" data-testid="refresh-done" className="card-hero space-y-1 p-4">
          <p className="text-lg font-bold">
            <span aria-hidden="true">🏁</span> New model{' '}
            <span className="font-mono text-accent">{status?.staged_version}</span> staged ✓ —
            compare below and activate when happy
          </p>
        </div>
      )}

      {phase === 'error' && (
        <div
          role="alert"
          data-testid="refresh-error"
          className="space-y-3 rounded-xl border-2 border-bad/60 bg-bad/10 p-4"
        >
          <p className="text-lg font-bold">
            <span aria-hidden="true">⚠️</span> Refresh failed
          </p>
          <p className="text-ink-2">{errorText}</p>
          <button
            type="button"
            data-testid="refresh-retry"
            className="btn-secondary"
            onClick={() => void start()}
          >
            <span aria-hidden="true">↻</span> Retry
          </button>
        </div>
      )}
    </section>
  )
}
