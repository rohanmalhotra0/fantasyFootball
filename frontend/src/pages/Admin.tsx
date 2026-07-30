import { useCallback, useEffect, useState } from 'react'
import ModelTable from '../components/admin/ModelTable'
import RefreshCard from '../components/admin/RefreshCard'
import { api } from '../lib/api'
import type { ModelVersionOut } from '../lib/types'

/**
 * Data admin page: one-click refresh (staged, never silent), the model
 * version history with explicit activation, and a plain-words card about
 * where the data comes from.
 */
export default function Admin() {
  const [versions, setVersions] = useState<ModelVersionOut[] | null>(null)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [adpErrors, setAdpErrors] = useState<Record<string, string>>({})

  const loadModels = useCallback(async () => {
    try {
      const resp = await api.adminModels()
      setVersions(resp.versions)
      setModelsError(null)
    } catch (err) {
      setModelsError(err instanceof Error ? err.message : 'Could not load model versions.')
    }
  }, [])

  useEffect(() => {
    void loadModels()
  }, [loadModels])

  // Best-effort: surface ADP fetch errors from the last refresh in the
  // Data sources card. If the dashboard call fails we just skip it.
  useEffect(() => {
    let cancelled = false
    api
      .dashboard()
      .then((d) => {
        if (cancelled) return
        const errs = d.last_refresh?.adp_errors
        if (errs && typeof errs === 'object' && !Array.isArray(errs)) {
          setAdpErrors(errs as Record<string, string>)
        }
      })
      .catch(() => {
        /* no warning banner, nothing else lost */
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="space-y-6">
      <h1 className="animate-slide-up font-display text-3xl font-bold tracking-tight">
        <span aria-hidden="true">🗄️</span> Data &amp; models
      </h1>

      <RefreshCard onFinished={() => void loadModels()} />

      {modelsError ? (
        <div role="alert" className="card space-y-3 border-warn/50">
          <p className="text-lg font-bold">
            <span aria-hidden="true">⚠️</span> Could not load model versions
          </p>
          <p className="text-ink-2">{modelsError}</p>
          <button type="button" className="btn-secondary" onClick={() => void loadModels()}>
            <span aria-hidden="true">↻</span> Retry
          </button>
        </div>
      ) : versions === null ? (
        <div aria-busy="true" aria-label="Loading model versions" className="card">
          <div className="skeleton h-32" />
        </div>
      ) : (
        <ModelTable versions={versions} onVersions={setVersions} />
      )}

      <DataSourcesCard adpErrors={adpErrors} />
    </div>
  )
}

function DataSourcesCard({ adpErrors }: { adpErrors: Record<string, string> }) {
  const errorYears = Object.keys(adpErrors).sort()
  return (
    <section
      className="card animate-slide-up space-y-3"
      aria-label="Data sources"
      data-testid="data-sources"
    >
      <h2 className="section-title">
        <span aria-hidden="true">🔌</span> Data sources
      </h2>
      <ul className="space-y-2">
        <li className="flex items-start gap-3 rounded-xl bg-raised/40 px-3 py-2">
          <span aria-hidden="true">📊</span>
          <span>
            <strong>nflverse</strong>{' '}
            <span className="text-ink-2">— weekly player stats, 2015–2025</span>
          </span>
        </li>
        <li className="flex items-start gap-3 rounded-xl bg-raised/40 px-3 py-2">
          <span aria-hidden="true">📋</span>
          <span>
            <strong>FantasyFootballCalculator</strong>{' '}
            <span className="text-ink-2">— ADP (average draft position)</span>
          </span>
        </li>
      </ul>
      <p className="text-ink-3">
        The ADP download can fail on restricted networks. That is OK — the app keeps working, just
        without ADP columns.
      </p>
      {errorYears.length > 0 && (
        <p
          role="status"
          data-testid="adp-errors"
          className="rounded-xl border-2 border-warn/60 bg-warn/10 p-3 font-bold"
        >
          <span aria-hidden="true">⚠️</span> Last refresh could not fetch ADP for:{' '}
          {errorYears.join(', ')}
        </p>
      )}
    </section>
  )
}
