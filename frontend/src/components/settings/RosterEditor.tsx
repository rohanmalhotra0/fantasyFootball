// Roster slot steppers + live "Rounds: N" readout. Min/max mirror the
// backend RosterSlots field constraints (league.py) so the UI can never
// build a roster the server would 422.

import type { RosterSlots } from '../../lib/types'

interface StepperProps {
  label: string
  value: number
  min: number
  max: number
  onChange: (n: number) => void
  testId: string
}

/** Reusable stepper: big minus / number input / big plus. Also used by the
 *  Settings page for teams + draft slot. */
export function Stepper({ label, value, min, max, onChange, testId }: StepperProps) {
  const clamp = (n: number) => Math.min(max, Math.max(min, n))
  const btn =
    'grid h-12 w-12 shrink-0 place-items-center rounded-xl border-2 border-edge bg-raised/60 font-display text-2xl font-bold text-ink transition-colors hover:border-accent/60 hover:bg-raised active:scale-95 disabled:opacity-40 disabled:hover:border-edge disabled:hover:bg-raised/60'
  return (
    <div className="flex items-center gap-3">
      <span id={`${testId}-label`} className="w-20 shrink-0 text-lg font-bold sm:w-28">
        {label}
      </span>
      <button
        type="button"
        className={btn}
        aria-label={`Decrease ${label}`}
        data-testid={`${testId}-minus`}
        disabled={value <= min}
        onClick={() => onChange(clamp(value - 1))}
      >
        −
      </button>
      <input
        type="number"
        inputMode="numeric"
        className="h-12 w-20 rounded-xl border-2 border-edge bg-surface text-center font-display text-xl font-bold text-ink tabular-nums"
        value={value}
        min={min}
        max={max}
        aria-labelledby={`${testId}-label`}
        data-testid={testId}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10)
          if (!Number.isNaN(n)) onChange(clamp(n))
        }}
      />
      <button
        type="button"
        className={btn}
        aria-label={`Increase ${label}`}
        data-testid={`${testId}-plus`}
        disabled={value >= max}
        onClick={() => onChange(clamp(value + 1))}
      >
        +
      </button>
    </div>
  )
}

const FIELDS: {
  key: keyof RosterSlots
  label: string
  testKey: string
  min: number
  max: number
}[] = [
  { key: 'qb', label: 'QB', testKey: 'qb', min: 0, max: 4 },
  { key: 'rb', label: 'RB', testKey: 'rb', min: 0, max: 8 },
  { key: 'wr', label: 'WR', testKey: 'wr', min: 0, max: 8 },
  { key: 'te', label: 'TE', testKey: 'te', min: 0, max: 4 },
  { key: 'flex', label: 'FLEX', testKey: 'flex', min: 0, max: 6 },
  { key: 'superflex', label: 'SFLEX', testKey: 'sflex', min: 0, max: 2 },
  { key: 'k', label: 'K', testKey: 'k', min: 0, max: 2 },
  { key: 'dst', label: 'DST', testKey: 'dst', min: 0, max: 2 },
  { key: 'bench', label: 'Bench', testKey: 'bench', min: 0, max: 20 },
]

export function rosterTotal(roster: RosterSlots): number {
  return FIELDS.reduce((sum, f) => sum + roster[f.key], 0)
}

interface RosterEditorProps {
  roster: RosterSlots
  onChange: (roster: RosterSlots) => void
}

export default function RosterEditor({ roster, onChange }: RosterEditorProps) {
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <Stepper
            key={f.key}
            label={f.label}
            value={roster[f.key]}
            min={f.min}
            max={f.max}
            testId={`roster-${f.testKey}-input`}
            onChange={(n) => onChange({ ...roster, [f.key]: n })}
          />
        ))}
      </div>
      <p
        data-testid="rounds-readout"
        className="inline-flex items-center gap-2 rounded-xl bg-raised/60 px-4 py-2 text-xl font-bold"
      >
        <span aria-hidden="true">📋</span> Rounds: {rosterTotal(roster)}
      </p>
      <p className="text-base text-ink-3">One round per roster spot — starters plus bench.</p>
    </div>
  )
}
