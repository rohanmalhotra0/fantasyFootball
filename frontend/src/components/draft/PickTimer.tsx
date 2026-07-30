// Pick countdown. Purely advisory: at 0 it flashes "TIME" and does
// NOTHING else — it never auto-picks. Resets itself on every new pick
// (resetKey = current overall).

import { useEffect, useRef, useState } from 'react'

interface PickTimerProps {
  /** Changes on every new pick; the clock resets when it changes. */
  resetKey: string | number
  seconds?: number
}

export default function PickTimer({ resetKey, seconds = 90 }: PickTimerProps) {
  const [remaining, setRemaining] = useState(seconds)
  const [running, setRunning] = useState(false)
  const lastKey = useRef(resetKey)

  // New pick -> fresh clock (keeps running if it was running).
  useEffect(() => {
    if (lastKey.current !== resetKey) {
      lastKey.current = resetKey
      setRemaining(seconds)
    }
  }, [resetKey, seconds])

  useEffect(() => {
    if (!running) return
    const id = setInterval(() => {
      setRemaining((r) => (r > 0 ? r - 1 : 0))
    }, 1000)
    return () => clearInterval(id)
  }, [running])

  const minutes = Math.floor(remaining / 60)
  const secs = String(remaining % 60).padStart(2, '0')
  const expired = remaining === 0

  return (
    <section
      data-testid="pick-timer"
      aria-label="Pick timer"
      className="card flex flex-col items-center gap-3"
    >
      {expired ? (
        <p className="animate-pulse font-mono text-3xl font-bold text-red-700" role="status">
          <span aria-hidden="true">⏰</span> TIME
        </p>
      ) : (
        <p
          className={`font-mono text-3xl font-bold tabular-nums ${
            remaining <= 15 ? 'text-red-700' : 'text-slate-900'
          }`}
          aria-label={`${minutes} minutes ${remaining % 60} seconds left`}
        >
          {minutes}:{secs}
        </p>
      )}
      <div className="flex flex-wrap justify-center gap-2">
        {running ? (
          <button type="button" className="btn-secondary" onClick={() => setRunning(false)}>
            <span aria-hidden="true">⏸</span> Pause
          </button>
        ) : (
          <button
            type="button"
            className="btn-secondary"
            disabled={expired}
            onClick={() => setRunning(true)}
          >
            <span aria-hidden="true">▶</span> Start
          </button>
        )}
        <button
          type="button"
          className="btn-secondary"
          onClick={() => setRemaining(seconds)}
        >
          <span aria-hidden="true">↺</span> Reset
        </button>
      </div>
    </section>
  )
}
