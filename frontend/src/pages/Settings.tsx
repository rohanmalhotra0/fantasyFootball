// League Settings: teams, slot, scoring, roster, draft type, team names.
// Saving PUTs the full LeagueSettings; the response's replacement_counts
// feed the live replacement preview — visible proof VORP follows settings.

import { useEffect, useState } from 'react'
import RosterEditor, { Stepper } from '../components/settings/RosterEditor'
import ScoringEditor, { PRESET_SCORING } from '../components/settings/ScoringEditor'
import { api, ApiError } from '../lib/api'
import type { LeagueSettings, SettingsResponse } from '../lib/types'

type PresetId = 'ppr' | 'half' | 'standard' | 'custom'

const PRESETS: { id: PresetId; label: string; hint: string; icon: string }[] = [
  { id: 'ppr', label: 'PPR', hint: '1 pt per catch', icon: '🎯' },
  { id: 'half', label: 'Half', hint: '0.5 pt per catch', icon: '➗' },
  { id: 'standard', label: 'Standard', hint: '0 pt per catch', icon: '🏈' },
  { id: 'custom', label: 'Custom', hint: 'Set every stat', icon: '🛠️' },
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

  // Route announcement for screen readers + tab identity (WCAG 2.4.2).
  useEffect(() => {
    document.title = 'League Settings — DraftEngine'
  }, [])

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
      <div role="status" aria-label="Loading settings" className="space-y-6">
        <div className="skeleton h-12 w-full max-w-sm" />
        <div className="skeleton h-48" />
        <div className="skeleton h-56" />
        <div className="skeleton h-72" />
      </div>
    )
  }

  if (loadError || !form || !data) {
    return (
      <div role="alert" className="card border-bad/50 text-lg">
        <p className="font-bold">
          <span aria-hidden="true">❌</span> Could not load settings
        </p>
        <p className="text-ink-2">{loadError ?? 'No settings returned'}</p>
      </div>
    )
  }

  const replacementCounts = REPLACEMENT_ORDER.filter(
    (p) => data.replacement_counts[p] != null,
  ).map((p) => ({ pos: p, count: data.replacement_counts[p] }))

  return (
    <div className="space-y-6 pb-4">
      <h1 className="animate-slide-up font-display text-3xl font-bold tracking-tight">
        <span aria-hidden="true">⚙️</span> League Settings
      </h1>

      <section className="card animate-slide-up space-y-5" aria-label="League size">
        <h2 className="section-title text-2xl">League size</h2>
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
        <p className="text-base text-ink-3">My slot = where you pick in round 1.</p>
      </section>

      <section className="card animate-slide-up space-y-5" aria-label="Scoring">
        <h2 className="section-title text-2xl">Scoring</h2>
        <div role="radiogroup" aria-label="Scoring preset" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {PRESETS.map((p) => {
            const selected = form.scoring_preset === p.id
            return (
              <label
                key={p.id}
                data-testid={`scoring-preset-${p.id}`}
                // The real radio is sr-only, so the card must show the focus
                // ring itself or keyboard focus is invisible (WCAG 2.4.7).
                className={`relative cursor-pointer rounded-2xl border-2 p-5 transition-all has-[:focus-visible]:outline has-[:focus-visible]:outline-[3px] has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent ${
                  selected
                    ? 'border-accent bg-accent/10 shadow-glow-sm'
                    : 'border-edge bg-raised/40 hover:border-accent/50 hover:bg-raised/70'
                }`}
              >
                <input
                  type="radio"
                  name="scoring-preset"
                  className="sr-only"
                  aria-label={p.label}
                  checked={selected}
                  onChange={() => choosePreset(p.id)}
                />
                {selected && (
                  <span className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-full bg-accent font-bold text-bg">
                    <span aria-hidden="true">✓</span>
                    <span className="sr-only">selected</span>
                  </span>
                )}
                <span aria-hidden="true" className="block text-2xl">
                  {p.icon}
                </span>
                <span className="block font-display text-xl font-bold">{p.label}</span>
                <span className="block text-base text-ink-2">{p.hint}</span>
              </label>
            )
          })}
        </div>
        {form.scoring_preset === 'custom' && (
          <ScoringEditor scoring={form.scoring} onChange={(scoring) => update({ scoring })} />
        )}
      </section>

      <section className="card animate-slide-up space-y-5" aria-label="Roster">
        <h2 className="section-title text-2xl">Roster</h2>
        <RosterEditor roster={form.roster} onChange={(roster) => update({ roster })} />
        {/* Live proof the value math follows the roster + scoring above. */}
        <div
          data-testid="replacement-preview"
          className="space-y-2 rounded-2xl border border-edge/70 bg-raised/40 p-4"
        >
          <p className="text-base font-bold uppercase tracking-[0.14em] text-ink-3">
            Replacement level
          </p>
          <div className="flex flex-wrap gap-2">
            {replacementCounts.map(({ pos, count }) => (
              <span
                key={`${pos}${count}`}
                className="chip animate-slide-up border border-edge bg-surface/80 font-display text-ink tabular-nums"
              >
                {pos}
                {count}
              </span>
            ))}
          </div>
          <p className="text-base text-ink-3">
            Last startable player per position — VORP measures against these. Updates when you
            save.
          </p>
        </div>
      </section>

      <section className="card animate-slide-up space-y-5" aria-label="Draft">
        <h2 className="section-title text-2xl">Draft</h2>
        <div className="flex flex-wrap gap-3" role="group" aria-label="Draft type">
          <button
            type="button"
            data-testid="draft-type-snake"
            aria-pressed={form.draft_type === 'snake'}
            onClick={() => update({ draft_type: 'snake' })}
            className={`rounded-xl border-2 px-5 py-2.5 text-lg font-bold transition-colors ${
              form.draft_type === 'snake'
                ? 'border-accent bg-accent text-bg shadow-glow-sm'
                : 'border-edge bg-raised/60 text-ink hover:border-accent/60 hover:bg-raised'
            }`}
          >
            <span aria-hidden="true">🐍</span> Snake
          </button>
          <button
            type="button"
            data-testid="draft-type-auction"
            aria-pressed={form.draft_type === 'auction'}
            onClick={() => update({ draft_type: 'auction' })}
            className={`rounded-xl border-2 px-5 py-2.5 text-lg font-bold transition-colors ${
              form.draft_type === 'auction'
                ? 'border-accent bg-accent text-bg shadow-glow-sm'
                : 'border-edge bg-raised/60 text-ink hover:border-accent/60 hover:bg-raised'
            }`}
          >
            <span aria-hidden="true">💰</span> Auction
          </button>
        </div>
        {form.draft_type === 'auction' && (
          <p role="note" className="text-lg text-ink-2">
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
                className="rounded-xl border-2 border-edge bg-surface px-4 py-2.5 text-lg text-ink placeholder:text-ink-3 transition-colors hover:border-accent/60"
              />
            ))}
          </div>
        )}
      </section>

      {saveError && (
        <p
          role="alert"
          className="rounded-2xl border-2 border-bad/60 bg-bad/10 px-4 py-3 text-lg font-bold"
        >
          <span aria-hidden="true">❌</span> Not saved: {saveError}
        </p>
      )}

      {/* Slim sticky footer: just the one primary action + its confirmation. */}
      <div className="sticky bottom-0 z-10 -mx-4 border-t border-edge/70 bg-bg/85 px-4 py-3 shadow-[0_-16px_40px_-18px_rgb(var(--de-accent)/0.35)] backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2">
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
            // role=status: the confirmation is announced, not just shown
            // (WCAG 4.1.3 status messages).
            <p data-testid="settings-saved" role="status" className="text-lg font-bold text-good">
              ✓ Saved — VORP updated everywhere
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
