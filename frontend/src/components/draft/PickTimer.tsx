// Pick countdown. Purely advisory: at 0 it flashes "TIME" and does
// NOTHING else — it never auto-picks. Resets itself on every new pick
// (resetKey = current overall). Lives inside the OnClockBanner as the
// broadcast clock: big mono digits over a thin drain bar.

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
  const low = remaining <= 15
  const pct = Math.max(0, Math.min(100, (remaining / seconds) * 100))

  return (
    <section
      data-testid="pick-timer"
      aria-label="Pick timer"
      className="flex flex-col items-center gap-3 rounded-2xl border border-edge/60 bg-bg/40 px-5 py-4"
    >
      {expired ? (
        <p className="animate-pulse font-mono text-4xl font-bold leading-none text-bad" role="status">
          <span aria-hidden="true">⏰</span> TIME
        </p>
      ) : (
        <p
          className={`font-mono text-4xl font-bold leading-none tabular-nums ${
            low ? 'text-bad' : 'text-ink'
          }`}
          aria-label={`${minutes} minutes ${remaining % 60} seconds left`}
        >
          {minutes}:{secs}
        </p>
      )}
      <div
        aria-hidden="true"
        className="h-1.5 w-full overflow-hidden rounded-full bg-raised"
      >
        <div
          className={`h-full rounded-full transition-[width] duration-300 ${
            low ? 'bg-bad' : 'bg-accent'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {running ? (
          <button
            type="button"
            className="btn-secondary px-3 py-1.5 text-base"
            onClick={() => setRunning(false)}
          >
            <span aria-hidden="true">⏸</span> Pause
          </button>
        ) : (
          <button
            type="button"
            className="btn-secondary px-3 py-1.5 text-base"
            disabled={expired}
            onClick={() => setRunning(true)}
          >
            <span aria-hidden="true">▶</span> Start
          </button>
        )}
        <button
          type="button"
          className="btn-secondary px-3 py-1.5 text-base"
          onClick={() => setRemaining(seconds)}
        >
          <span aria-hidden="true">↺</span> Reset
        </button>
      </div>
    </section>
  )
}
