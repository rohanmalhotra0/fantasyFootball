import { Fragment, useState } from 'react'
import { api } from '../../lib/api'
import type { ModelVersionOut } from '../../lib/types'

/**
 * Model version history: one row per trained model with its validation
 * Spearman per year, mean, and an explicit Activate flow. Activation is
 * never one click — a confirm panel puts the candidate's and the active
 * model's mean Spearman side by side as stat tiles with a plain-words
 * verdict first.
 */

interface Props {
  versions: ModelVersionOut[]
  /** Called with the fresh version list the activate endpoint returns. */
  onVersions: (versions: ModelVersionOut[]) => void
}

/** "3 hours ago" style label; raw string if unparsable, em dash if empty. */
export function timeAgo(iso: string, now: Date = new Date()): string {
  if (!iso) return '—'
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return iso
  const seconds = Math.floor((now.getTime() - then.getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

export function meanSpearman(v: ModelVersionOut): number | null {
  if (v.metrics.length === 0) return null
  const sum = v.metrics.reduce((acc, m) => acc + m.spearman_model, 0)
  return sum / v.metrics.length
}

interface Verdict {
  tone: 'good' | 'bad' | 'neutral' | 'warn'
  glyph: string
  text: string
}

/** Plain-words verdict for candidate-vs-active mean Spearman. Glyph + words
 *  always travel together so the tone color never carries meaning alone. */
export function activationVerdict(cand: number | null, cur: number | null): Verdict {
  if (cand === null) {
    return {
      tone: 'warn',
      glyph: '⚠️',
      text: 'No validation metrics for this model — activate only if you are sure.',
    }
  }
  if (cur === null) {
    return {
      tone: 'neutral',
      glyph: 'ℹ️',
      text: 'No active model to compare — this becomes the live model.',
    }
  }
  const diff = cand - cur
  if (Math.abs(diff) <= 0.002)
    return { tone: 'neutral', glyph: '≈', text: 'About the same as the current model.' }
  if (diff > 0.02)
    return { tone: 'good', glyph: '↑', text: 'Clear improvement over the current model.' }
  if (diff > 0)
    return { tone: 'good', glyph: '↑', text: 'Small improvement over the current model.' }
  if (diff < -0.02)
    return { tone: 'bad', glyph: '↓', text: 'Clearly worse than the current model.' }
  return { tone: 'bad', glyph: '↓', text: 'Slightly worse than the current model.' }
}

const VERDICT_TONE: Record<Verdict['tone'], string> = {
  good: 'text-good',
  bad: 'text-bad',
  warn: 'text-warn',
  neutral: 'text-ink-2',
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-edge bg-surface/80 p-3 text-center">
      <p className="font-bold uppercase tracking-[0.14em] text-ink-3">{label}</p>
      <p className="stat-number text-3xl">{value}</p>
    </div>
  )
}

export default function ModelTable({ versions, onVersions }: Props) {
  const [confirming, setConfirming] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const active = versions.find((v) => v.active) ?? null

  async function confirmActivate(version: string) {
    setBusy(true)
    setError(null)
    try {
      const resp = await api.activateModel(version)
      onVersions(resp.versions)
      setConfirming(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Activation failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      className="card animate-slide-up space-y-4"
      data-testid="models-table"
      aria-label="Model versions"
    >
      <h2 className="section-title">
        <span aria-hidden="true">📚</span> Model versions
      </h2>

      {versions.length === 0 ? (
        <p className="text-ink-2">
          <span aria-hidden="true">📭</span> No models yet — run your first refresh
        </p>
      ) : (
        <div className="table-shell overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr>
                <th scope="col">Version</th>
                <th scope="col">Created</th>
                <th scope="col">Spearman by year</th>
                <th scope="col">Mean</th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="sr-only">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => {
                const mean = meanSpearman(v)
                return (
                  <Fragment key={v.version}>
                    <tr data-testid={`model-row-${v.version}`}>
                      {/* row headers opt out of the sticky column-header skin */}
                      <th
                        scope="row"
                        className="border-t border-edge/40 align-top font-normal !static !bg-transparent !text-ink"
                      >
                        <span className="font-mono font-bold">{v.version}</span>
                        {v.note && <span className="block text-ink-3">{v.note}</span>}
                      </th>
                      <td className="align-top" title={v.created_at}>
                        {timeAgo(v.created_at)}
                      </td>
                      <td className="align-top">
                        <span className="flex flex-wrap gap-2">
                          {v.metrics.map((m) => (
                            <span
                              key={m.season}
                              className="chip whitespace-nowrap border border-edge/70 bg-raised/60 text-ink-2 tabular-nums"
                            >
                              {`${m.season}: ${m.spearman_model.toFixed(2)}`}
                            </span>
                          ))}
                          {v.metrics.length === 0 && <span className="text-ink-3">—</span>}
                        </span>
                      </td>
                      <td className="align-top font-display font-bold tabular-nums">
                        {mean === null ? '—' : mean.toFixed(3)}
                      </td>
                      <td className="align-top">
                        {v.active ? (
                          <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border-2 border-good/60 bg-good/15 px-3 py-1 font-bold uppercase tracking-wide text-good">
                            <span aria-hidden="true">✓</span> active
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-ink-3">
                            <span aria-hidden="true">◇</span> staged
                          </span>
                        )}
                      </td>
                      <td className="align-top">
                        {!v.active && (
                          <button
                            type="button"
                            data-testid={`activate-${v.version}`}
                            className="btn-secondary whitespace-nowrap"
                            disabled={busy}
                            onClick={() => {
                              setError(null)
                              setConfirming(v.version)
                            }}
                          >
                            <span aria-hidden="true">▶</span> Activate
                          </button>
                        )}
                      </td>
                    </tr>
                    {confirming === v.version && (
                      <tr>
                        <td colSpan={6} className="py-3">
                          <ConfirmPanel
                            candidate={v}
                            active={active}
                            busy={busy}
                            error={error}
                            onConfirm={() => void confirmActivate(v.version)}
                            onCancel={() => {
                              setConfirming(null)
                              setError(null)
                            }}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function ConfirmPanel({
  candidate,
  active,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  candidate: ModelVersionOut
  active: ModelVersionOut | null
  busy: boolean
  error: string | null
  onConfirm: () => void
  onCancel: () => void
}) {
  const cand = meanSpearman(candidate)
  const cur = active ? meanSpearman(active) : null
  const verdict = activationVerdict(cand, cur)
  return (
    <div
      role="region"
      aria-label={`Confirm activating ${candidate.version}`}
      className="space-y-4 rounded-xl border-2 border-accent/50 bg-accent/10 p-5"
    >
      <p className="text-lg font-bold">
        Make <span className="font-mono">{candidate.version}</span> the live model?
      </p>
      <div data-testid="activate-comparison" className="space-y-3">
        {cand !== null && (
          <div className="grid max-w-md grid-cols-2 gap-3">
            <StatTile label="New" value={cand.toFixed(3)} />
            {cur !== null && <StatTile label="Current" value={cur.toFixed(3)} />}
          </div>
        )}
        <p className={`flex items-start gap-2 font-bold ${VERDICT_TONE[verdict.tone]}`}>
          <span aria-hidden="true">{verdict.glyph}</span> {verdict.text}
        </p>
        <p className="text-ink-3">Mean validation Spearman — higher ranks players better.</p>
      </div>
      {error && (
        <p role="alert" className="font-bold text-bad">
          <span aria-hidden="true">⚠️</span> {error}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          data-testid="confirm-activate"
          className="btn-primary"
          disabled={busy}
          onClick={onConfirm}
        >
          <span aria-hidden="true">✓</span> Confirm — activate
        </button>
        <button
          type="button"
          data-testid="cancel-activate"
          className="btn-secondary"
          disabled={busy}
          onClick={onCancel}
        >
          <span aria-hidden="true">✕</span> Cancel
        </button>
      </div>
    </div>
  )
}
