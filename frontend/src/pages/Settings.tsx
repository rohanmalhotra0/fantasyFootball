// League Settings: teams, slot, scoring, roster, draft type, team names.
// Saving PUTs the full LeagueSettings; the response's replacement_counts
// feed the live replacement preview — visible proof VORP follows settings.

import { useEffect, useState } from 'react'
import RosterEditor, { Stepper } from '../components/settings/RosterEditor'
import ScoringEditor, { PRESET_SCORING } from '../components/settings/ScoringEditor'
import { api, ApiError } from '../lib/api'
import type { LeagueSettings, SettingsResponse } from '../lib/types'

type PresetId = 'ppr' | 'half' | 'standard' | 'custom'

const PRESETS: { id: PresetId; label: string; hint: string }[] = [
  { id: 'ppr', label: 'PPR', hint: '1 pt per catch' },
  { id: 'half', label: 'Half', hint: '0.5 pt per catch' },
  { id: 'standard', label: 'Standard', hint: '0 pt per catch' },
  { id: 'custom', label: 'Custom', hint: 'Set every stat' },
]

const REPLACEMENT_ORDER = ['QB', 'RB', 'WR', 'TE', 'K', 'DST']

/** Turn an API error (including FastAPI 422 detail arrays) into plain words. */
function friendlyError(err: unknown): string {
  if (err instanceof ApiError) {
    try {
      const parsed: unknown = JSON.parse(err.message)
      if (Array.isArray(parsed)) {
        return parsed
          .map((d: { loc?: unknown[]; msg?: string }) => {
            const loc = Array.isArray(d.loc)
              ? d.loc.filter((x) => x !== 'body').join(' ')
              : ''
            const msg = String(d.msg ?? 'invalid value').replace(/^Value error, /, '')
            return loc ? `${loc}: ${msg}` : msg
          })
          .join('. ')
      }
    } catch {
      /* detail was a plain string */
    }
    return err.message
  }
  return err instanceof Error ? err.message : 'Something went wrong'
}

export default function Settings() {
  const [data, setData] = useState<SettingsResponse | null>(null)
  const [form, setForm] = useState<LeagueSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [namesOpen, setNamesOpen] = useState(false)

  useEffect(() => {
    api
      .getSettings()
      .then((resp) => {
        setData(resp)
        setForm(resp.settings)
      })
      .catch((err: unknown) => setLoadError(friendlyError(err)))
      .finally(() => setLoading(false))
  }, [])

  const update = (patch: Partial<LeagueSettings>) => {
    setForm((f) => (f ? { ...f, ...patch } : f))
    setSaved(false)
    setSaveError(null)
  }

  const choosePreset = (id: PresetId) => {
    if (id === 'custom') {
      update({ scoring_preset: 'custom' })
    } else {
      // Preset click fills the scoring values client-side too, so the
      // Custom editor always starts from what you last picked.
      update({ scoring_preset: id, scoring: { ...PRESET_SCORING[id] } })
    }
  }

  const setTeamName = (index: number, name: string) => {
    setForm((f) => {
      if (!f) return f
      const names = [...f.team_names]
      while (names.length < f.teams) names.push('')
      names[index] = name
      return { ...f, team_names: names }
    })
    setSaved(false)
    setSaveError(null)
  }

  const save = async () => {
    if (!form) return
    setSaving(true)
    setSaveError(null)
    try {
      const resp = await api.putSettings({
        ...form,
        team_names: form.team_names.slice(0, form.teams),
      })
      setData(resp)
      setForm(resp.settings)
      setSaved(true)
    } catch (err: unknown) {
      setSaveError(friendlyError(err))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <p role="status" className="text-xl font-bold text-slate-600">
        Loading settings…
      </p>
    )
  }

  if (loadError || !form || !data) {
    return (
      <div role="alert" className="card border-red-300 bg-red-50 text-lg text-red-900">
        <p className="font-bold">
          <span aria-hidden="true">❌</span> Could not load settings
        </p>
        <p>{loadError ?? 'No settings returned'}</p>
      </div>
    )
  }

  const replacementText = REPLACEMENT_ORDER.filter((p) => data.replacement_counts[p] != null)
    .map((p) => `${p}${data.replacement_counts[p]}`)
    .join(' · ')

  return (
    <div className="space-y-6 pb-4">
      <h1 className="text-3xl font-bold">
        <span aria-hidden="true">⚙️</span> League Settings
      </h1>

      <section className="card space-y-5" aria-label="League size">
        <h2 className="text-2xl font-bold">League size</h2>
        <Stepper
          label="Teams"
          value={form.teams}
          min={8}
          max={16}
          testId="teams-input"
          onChange={(n) => update({ teams: n, my_slot: Math.min(form.my_slot, n) })}
        />
        <Stepper
          label="My slot"
          value={form.my_slot}
          min={1}
          max={form.teams}
          testId="my-slot-input"
          onChange={(n) => update({ my_slot: n })}
        />
        <p className="text-base text-slate-600">My slot = where you pick in round 1.</p>
      </section>

      <section className="card space-y-5" aria-label="Scoring">
        <h2 className="text-2xl font-bold">Scoring</h2>
        <div role="radiogroup" aria-label="Scoring preset" className="grid gap-3 sm:grid-cols-4">
          {PRESETS.map((p) => {
            const selected = form.scoring_preset === p.id
            return (
              <label
                key={p.id}
                className={`cursor-pointer rounded-2xl border-2 p-4 ${
                  selected ? 'border-blue-700 bg-blue-50' : 'border-slate-300 bg-white'
                }`}
              >
                <input
                  type="radio"
                  name="scoring-preset"
                  className="sr-only"
                  data-testid={`scoring-preset-${p.id}`}
                  checked={selected}
                  onChange={() => choosePreset(p.id)}
                />
                <span className="block text-lg font-bold">
                  {selected && <span aria-hidden="true">✓ </span>}
                  {p.label}
                </span>
                <span className="block text-base text-slate-600">{p.hint}</span>
              </label>
            )
          })}
        </div>
        {form.scoring_preset === 'custom' && (
          <ScoringEditor scoring={form.scoring} onChange={(scoring) => update({ scoring })} />
        )}
      </section>

      <section className="card space-y-5" aria-label="Roster">
        <h2 className="text-2xl font-bold">Roster</h2>
        <RosterEditor roster={form.roster} onChange={(roster) => update({ roster })} />
      </section>

      <section className="card space-y-5" aria-label="Draft">
        <h2 className="text-2xl font-bold">Draft</h2>
        <div className="flex flex-wrap gap-3" role="group" aria-label="Draft type">
          <button
            type="button"
            data-testid="draft-type-snake"
            aria-pressed={form.draft_type === 'snake'}
            onClick={() => update({ draft_type: 'snake' })}
            className={`rounded-xl border-2 px-5 py-2.5 text-lg font-bold ${
              form.draft_type === 'snake'
                ? 'border-blue-700 bg-blue-700 text-white'
                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
            }`}
          >
            <span aria-hidden="true">🐍</span> Snake
          </button>
          <button
            type="button"
            data-testid="draft-type-auction"
            aria-pressed={form.draft_type === 'auction'}
            onClick={() => update({ draft_type: 'auction' })}
            className={`rounded-xl border-2 px-5 py-2.5 text-lg font-bold ${
              form.draft_type === 'auction'
                ? 'border-blue-700 bg-blue-700 text-white'
                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
            }`}
          >
            <span aria-hidden="true">💰</span> Auction
          </button>
        </div>
        {form.draft_type === 'auction' && (
          <p role="note" className="text-lg text-slate-600">
            Auction: board values only, live room is snake-first
          </p>
        )}

        <button
          type="button"
          aria-expanded={namesOpen}
          onClick={() => setNamesOpen((v) => !v)}
          className="btn-secondary text-lg"
        >
          <span aria-hidden="true">🏷️</span> Team names{' '}
          <span aria-hidden="true">{namesOpen ? '▲' : '▼'}</span>
        </button>
        {namesOpen && (
          <div className="grid gap-3 sm:grid-cols-2">
            {Array.from({ length: form.teams }, (_, i) => (
              <input
                key={i}
                type="text"
                value={form.team_names[i] ?? ''}
                onChange={(e) => setTeamName(i, e.target.value)}
                placeholder={`Team ${i + 1}`}
                aria-label={`Team ${i + 1} name`}
                className="rounded-xl border-2 border-slate-300 px-4 py-2.5 text-lg"
              />
            ))}
          </div>
        )}
      </section>

      {saveError && (
        <p
          role="alert"
          className="rounded-2xl border-2 border-red-300 bg-red-50 px-4 py-3 text-lg font-bold text-red-900"
        >
          <span aria-hidden="true">❌</span> Not saved: {saveError}
        </p>
      )}

      {/* Sticky footer: the one primary action + live proof of the value math */}
      <div className="sticky bottom-0 z-10 -mx-4 border-t-2 border-slate-200 bg-white px-4 py-4 shadow-[0_-4px_12px_rgba(0,0,0,0.06)]">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-3">
          <button
            type="button"
            data-testid="save-settings"
            className="btn-primary"
            onClick={save}
            disabled={saving}
          >
            <span aria-hidden="true">💾</span> {saving ? 'Saving…' : 'Save settings'}
          </button>
          {saved && (
            <p data-testid="settings-saved" className="text-lg font-bold text-green-800">
              ✓ Saved — VORP updated everywhere
            </p>
          )}
          <div
            data-testid="replacement-preview"
            className="rounded-xl border-2 border-slate-200 bg-slate-50 px-4 py-2 text-lg"
          >
            <span className="font-bold">Replacement:</span> {replacementText}
            <span className="block text-base text-slate-600">
              Last startable player per position — VORP measures against these.
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
