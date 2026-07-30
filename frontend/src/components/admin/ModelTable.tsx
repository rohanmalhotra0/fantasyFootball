import { Fragment, useState } from 'react'
import { api } from '../../lib/api'
import type { ModelVersionOut } from '../../lib/types'

/**
 * Model version history: one row per trained model with its validation
 * Spearman per year, mean, and an explicit Activate flow. Activation is
 * never one click — a plain-words confirm panel compares the candidate's
 * mean Spearman against the currently active model first.
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

/** Plain-words comparison: "New: 0.712 · Current: 0.705 — small improvement". */
export function comparisonText(candidate: ModelVersionOut, active: ModelVersionOut | null): string {
  const cand = meanSpearman(candidate)
  if (cand === null) return 'No validation metrics for this model — activate only if you are sure.'
  const cur = active ? meanSpearman(active) : null
  if (cur === null) {
    return `New: ${cand.toFixed(3)} — no active model to compare, this becomes the live model.`
  }
  const diff = cand - cur
  let verdict: string
  if (Math.abs(diff) <= 0.002) verdict = 'about the same'
  else if (diff > 0.02) verdict = 'clear improvement'
  else if (diff > 0) verdict = 'small improvement'
  else if (diff < -0.02) verdict = 'clearly worse'
  else verdict = 'slightly worse'
  return `New: ${cand.toFixed(3)} · Current: ${cur.toFixed(3)} — ${verdict}`
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
    <section className="card space-y-4" data-testid="models-table" aria-label="Model versions">
      <h2 className="text-xl font-bold">
        <span aria-hidden="true">📚</span> Model versions
      </h2>

      {versions.length === 0 ? (
        <p className="text-slate-600">
          <span aria-hidden="true">📭</span> No models yet — run your first refresh
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b-2 border-slate-200">
                <th scope="col" className="py-2 pr-4">
                  Version
                </th>
                <th scope="col" className="py-2 pr-4">
                  Created
                </th>
                <th scope="col" className="py-2 pr-4">
                  Spearman by year
                </th>
                <th scope="col" className="py-2 pr-4">
                  Mean
                </th>
                <th scope="col" className="py-2 pr-4">
                  Status
                </th>
                <th scope="col" className="py-2">
                  <span className="sr-only">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => {
                const mean = meanSpearman(v)
                return (
                  <Fragment key={v.version}>
                    <tr className="border-b border-slate-100" data-testid={`model-row-${v.version}`}>
                      <th scope="row" className="py-3 pr-4 align-top font-normal">
                        <span className="font-mono font-bold">{v.version}</span>
                        {v.note && <span className="block text-slate-600">{v.note}</span>}
                      </th>
                      <td className="py-3 pr-4 align-top" title={v.created_at}>
                        {timeAgo(v.created_at)}
                      </td>
                      <td className="py-3 pr-4 align-top">
                        <span className="flex flex-wrap gap-2">
                          {v.metrics.map((m) => (
                            <span
                              key={m.season}
                              className="inline-block whitespace-nowrap rounded-full border border-slate-300 bg-slate-100 px-3 py-0.5 tabular-nums"
                            >
                              {`${m.season}: ${m.spearman_model.toFixed(2)}`}
                            </span>
                          ))}
                          {v.metrics.length === 0 && <span className="text-slate-400">—</span>}
                        </span>
                      </td>
                      <td className="py-3 pr-4 align-top font-bold tabular-nums">
                        {mean === null ? '—' : mean.toFixed(3)}
                      </td>
                      <td className="py-3 pr-4 align-top">
                        {v.active ? (
                          <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border-2 border-green-700 bg-green-100 px-3 py-1 font-bold text-green-800">
                            <span aria-hidden="true">✓</span> active
                          </span>
                        ) : (
                          <span className="text-slate-500">staged</span>
                        )}
                      </td>
                      <td className="py-3 align-top">
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
                          <div
                            role="region"
                            aria-label={`Confirm activating ${v.version}`}
                            className="space-y-3 rounded-xl border-2 border-blue-300 bg-blue-50 p-4"
                          >
                            <p className="text-lg font-bold">
                              Make <span className="font-mono">{v.version}</span> the live model?
                            </p>
                            <p data-testid="activate-comparison" className="tabular-nums">
                              {comparisonText(v, active)}
                            </p>
                            {error && (
                              <p role="alert" className="font-bold text-red-900">
                                <span aria-hidden="true">⚠️</span> {error}
                              </p>
                            )}
                            <div className="flex flex-wrap gap-3">
                              <button
                                type="button"
                                data-testid="confirm-activate"
                                className="btn-primary"
                                disabled={busy}
                                onClick={() => void confirmActivate(v.version)}
                              >
                                <span aria-hidden="true">✓</span> Confirm — activate
                              </button>
                              <button
                                type="button"
                                data-testid="cancel-activate"
                                className="btn-secondary"
                                disabled={busy}
                                onClick={() => {
                                  setConfirming(null)
                                  setError(null)
                                }}
                              >
                                <span aria-hidden="true">✕</span> Cancel
                              </button>
                            </div>
                          </div>
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
