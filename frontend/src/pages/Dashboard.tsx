import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import HeatmapGrid from '../components/charts/HeatmapGrid'
import ValidationTable from '../components/research/ValidationTable'
import { api } from '../lib/api'
import type { DashboardResponse } from '../lib/types'

/** "3 hours ago" style label; falls back to the raw string if unparsable. */
export function timeAgo(iso: string, now: Date = new Date()): string {
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

const NO_ADP_MESSAGE = 'ADP history not cached — refresh where FFC is reachable'

function LoadingSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading dashboard" className="space-y-6">
      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card h-56 animate-pulse bg-slate-100" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card h-96 animate-pulse bg-slate-100" />
        <div className="card h-96 animate-pulse bg-slate-100" />
      </div>
    </div>
  )
}

function EmptyHeatmapCard({ title, testId }: { title: string; testId: string }) {
  return (
    <section className="card space-y-3" data-testid={testId} aria-label={title}>
      <h2 className="text-xl font-bold">{title}</h2>
      <p className="text-slate-600">
        <span aria-hidden="true">📭</span> {NO_ADP_MESSAGE}
      </p>
    </section>
  )
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await api.dashboard())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the dashboard.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (loading && !data) return <LoadingSkeleton />

  if (error && !data) {
    return (
      <div role="alert" className="card max-w-xl space-y-4">
        <h1 className="text-2xl font-bold">
          <span aria-hidden="true">⚠️</span> Dashboard failed to load
        </h1>
        <p>{error}</p>
        <button type="button" className="btn-primary" onClick={() => void load()}>
          <span aria-hidden="true">↻</span> Retry
        </button>
      </div>
    )
  }

  if (!data) return null

  const finishedAt =
    data.last_refresh && typeof data.last_refresh.finished_at === 'string'
      ? data.last_refresh.finished_at
      : null

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">DraftEngine</h1>

      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
        {/* 1. Model check */}
        <section className="card space-y-3 md:col-span-2 xl:col-span-1" aria-label="Model check">
          <h2 className="text-xl font-bold">
            <span aria-hidden="true">🧪</span> Model check
          </h2>
          {data.validation.length === 0 ? (
            <p className="text-slate-600">No validation yet — run a refresh from the Data page.</p>
          ) : (
            <ValidationTable validation={data.validation} />
          )}
        </section>

        {/* 2. Data status */}
        <section className="card space-y-3" aria-label="Data status">
          <h2 className="text-xl font-bold">
            <span aria-hidden="true">🗄️</span> Data
          </h2>
          <p data-testid="last-refresh">
            {finishedAt ? (
              <>
                Last refresh:{' '}
                <span className="font-bold" title={finishedAt}>
                  {timeAgo(finishedAt)}
                </span>
              </>
            ) : (
              'Never refreshed'
            )}
          </p>
          <p>
            Active model:{' '}
            <span className="font-bold">{data.model_version ?? 'none yet'}</span>
          </p>
          {data.data_ready ? (
            <p className="font-bold text-green-800">
              <span aria-hidden="true">✅</span> Data ready
            </p>
          ) : (
            <div
              role="status"
              className="rounded-xl border-2 border-amber-300 bg-amber-50 p-3"
            >
              <p className="font-bold text-amber-900">
                <span aria-hidden="true">⚠️</span> Data not ready
              </p>
              <p className="text-amber-900">
                Run a refresh from the <Link to="/admin" className="underline">Data page</Link>.
              </p>
            </div>
          )}
        </section>

        {/* 3. League */}
        <section className="card space-y-3" aria-label="League settings">
          <h2 className="text-xl font-bold">
            <span aria-hidden="true">⚙️</span> League
          </h2>
          <p className="font-bold">{data.settings_summary}</p>
          <Link to="/settings" className="btn-secondary">
            <span aria-hidden="true">✏️</span> Change settings
          </Link>
        </section>

        {/* 4. Primary CTA */}
        <section
          className="card flex flex-col items-start justify-center gap-4 border-blue-200 bg-blue-50"
          aria-label="Start drafting"
        >
          <h2 className="text-xl font-bold">Draft day?</h2>
          <button
            type="button"
            className="btn-primary text-xl"
            data-testid="enter-draft-room"
            onClick={() => navigate('/draft')}
          >
            <span aria-hidden="true">🎯</span> Enter Draft Room
          </button>
        </section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {data.vorp_heatmap ? (
          <HeatmapGrid
            title="What each round actually returned"
            heatmap={data.vorp_heatmap}
            scale="diverging"
            format="number"
            testId="vorp-heatmap"
          />
        ) : (
          <EmptyHeatmapCard title="What each round actually returned" testId="vorp-heatmap" />
        )}
        {data.hit_rate_heatmap ? (
          <HeatmapGrid
            title="How often picks paid off"
            heatmap={data.hit_rate_heatmap}
            scale="sequential"
            format="percent"
            testId="hit-rate-heatmap"
          />
        ) : (
          <EmptyHeatmapCard title="How often picks paid off" testId="hit-rate-heatmap" />
        )}
      </div>
    </div>
  )
}
