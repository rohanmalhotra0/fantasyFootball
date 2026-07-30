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
      <h1 className="text-3xl font-bold">Data &amp; models</h1>

      <RefreshCard onFinished={() => void loadModels()} />

      {modelsError ? (
        <div role="alert" className="card space-y-3">
          <p className="text-lg font-bold">
            <span aria-hidden="true">⚠️</span> Could not load model versions
          </p>
          <p>{modelsError}</p>
          <button type="button" className="btn-secondary" onClick={() => void loadModels()}>
            <span aria-hidden="true">↻</span> Retry
          </button>
        </div>
      ) : versions === null ? (
        <div aria-busy="true" aria-label="Loading model versions" className="card">
          <div className="h-32 animate-pulse rounded-xl bg-slate-100" />
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
    <section className="card space-y-3" aria-label="Data sources" data-testid="data-sources">
      <h2 className="text-xl font-bold">
        <span aria-hidden="true">🔌</span> Data sources
      </h2>
      <ul className="space-y-2">
        <li>
          <span aria-hidden="true">📊</span> <strong>nflverse</strong> — weekly player stats,
          2015–2025
        </li>
        <li>
          <span aria-hidden="true">📋</span> <strong>FantasyFootballCalculator</strong> — ADP
          (average draft position)
        </li>
      </ul>
      <p className="text-slate-600">
        The ADP download can fail on restricted networks. That is OK — the app keeps working, just
        without ADP columns.
      </p>
      {errorYears.length > 0 && (
        <p
          role="status"
          data-testid="adp-errors"
          className="rounded-xl border-2 border-amber-300 bg-amber-50 p-3 font-bold text-amber-900"
        >
          <span aria-hidden="true">⚠️</span> Last refresh could not fetch ADP for:{' '}
          {errorYears.join(', ')}
        </p>
      )}
    </section>
  )
}
