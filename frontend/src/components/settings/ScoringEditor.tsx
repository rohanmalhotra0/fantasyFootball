// Custom scoring editor: one short-labeled number input per stat.
// Also exports the client-side preset -> scoring value mapping (mirrors
// backend ScoringSettings.preset in scoring.py).

import { useEffect, useState } from 'react'
import type { ScoringSettings } from '../../lib/types'

const BASE_SCORING: ScoringSettings = {
  pass_yd: 0.04,
  pass_td: 4.0,
  interception: -2.0,
  rush_yd: 0.1,
  rush_td: 6.0,
  reception: 1.0,
  rec_yd: 0.1,
  rec_td: 6.0,
  fumble_lost: -2.0,
  two_pt: 2.0,
  special_teams_td: 6.0,
}

export const PRESET_SCORING: Record<'ppr' | 'half' | 'standard', ScoringSettings> = {
  ppr: { ...BASE_SCORING, reception: 1.0 },
  half: { ...BASE_SCORING, reception: 0.5 },
  standard: { ...BASE_SCORING, reception: 0.0 },
}

const FIELDS: { key: keyof ScoringSettings; label: string }[] = [
  { key: 'pass_yd', label: 'Pass yd' },
  { key: 'pass_td', label: 'Pass TD' },
  { key: 'interception', label: 'INT' },
  { key: 'rush_yd', label: 'Rush yd' },
  { key: 'rush_td', label: 'Rush TD' },
  { key: 'reception', label: 'Rec' },
  { key: 'rec_yd', label: 'Rec yd' },
  { key: 'rec_td', label: 'Rec TD' },
  { key: 'fumble_lost', label: 'Fumble' },
  { key: 'two_pt', label: '2-pt' },
  { key: 'special_teams_td', label: 'ST TD' },
]

function ScoreField({
  id,
  label,
  value,
  onCommit,
}: {
  id: string
  label: string
  value: number
  onCommit: (n: number) => void
}) {
  const [text, setText] = useState(String(value))
  useEffect(() => {
    setText(String(value))
  }, [value])
  return (
    <div className="flex items-center gap-3">
      <label htmlFor={id} className="w-24 shrink-0 text-lg font-bold">
        {label}
      </label>
      <input
        id={id}
        data-testid={id}
        type="number"
        step="any"
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          const n = parseFloat(e.target.value)
          if (!Number.isNaN(n)) onCommit(n)
        }}
        onBlur={() => setText(String(value))}
        className="h-12 w-24 rounded-xl border-2 border-edge bg-surface px-2 text-center text-lg text-ink tabular-nums transition-colors hover:border-accent/60"
      />
    </div>
  )
}

interface ScoringEditorProps {
  scoring: ScoringSettings
  onChange: (scoring: ScoringSettings) => void
}

export default function ScoringEditor({ scoring, onChange }: ScoringEditorProps) {
  return (
    <div className="space-y-4">
      <p className="text-base text-ink-3">Points per stat. Negative numbers are allowed.</p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FIELDS.map((f) => (
          <ScoreField
            key={f.key}
            id={`scoring-${f.key}`}
            label={f.label}
            value={scoring[f.key]}
            onCommit={(n) => onChange({ ...scoring, [f.key]: n })}
          />
        ))}
      </div>
    </div>
  )
}
