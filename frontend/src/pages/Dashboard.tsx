import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
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
// Mirrors backend/draftengine/config.py STATS_YEARS = range(1999, 2026).
const SEASONS_OF_DATA = 27
// A refresh inside this window counts as "fresh" on the status tile.
const FRESH_WINDOW_MS = 24 * 60 * 60 * 1000

function mean(xs: number[]): number | null {
  if (xs.length === 0) return null
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

function LoadingSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading dashboard" className="space-y-6">
      <div className="skeleton h-14 w-full max-w-md" />
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton h-44" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="skeleton h-80 lg:col-span-2" />
        <div className="skeleton h-80" />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="skeleton h-96" />
        <div className="skeleton h-96" />
      </div>
    </div>
  )
}

function EmptyHeatmapCard({
  title,
  icon,
  testId,
}: {
  title: string
  icon: string
  testId: string
}) {
  return (
    <section
      className="card flex min-h-[16rem] flex-col gap-4 border-dashed"
      data-testid={testId}
      aria-label={title}
    >
      <h2 className="section-title">
        <span aria-hidden="true">{icon}</span> {title}
      </h2>
      <div className="flex flex-1 items-center justify-center gap-4 rounded-xl bg-raised/50 p-5 text-ink-2">
        <span aria-hidden="true" className="text-2xl">
          📭
        </span>
        <p>{NO_ADP_MESSAGE}</p>
      </div>
    </section>
  )
}

/** Uppercase kicker line used above every hero-tile number. */
function TileLabel({ icon, children }: { icon: string; children: ReactNode }) {
  return (
    <p className="flex items-center gap-2 font-bold uppercase tracking-[0.14em] text-ink-3">
      <span aria-hidden="true">{icon}</span>
      {children}
    </p>
  )
}

function PulseDot({ live }: { live: boolean }) {
  return (
    <span aria-hidden="true" className="relative flex h-3 w-3">
      {live && (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-good opacity-60" />
      )}
      <span
        className={`relative inline-flex h-3 w-3 rounded-full ${live ? 'bg-good' : 'bg-warn'}`}
      />
    </span>
  )
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  // Route announcement for screen readers + tab identity (WCAG 2.4.2).
  useEffect(() => {
    document.title = 'Home — DraftEngine'
  }, [])

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
      <div role="alert" className="card-hero max-w-xl space-y-4 animate-slide-up">
        <h1 className="section-title text-2xl">
          <span aria-hidden="true">⚠️</span> Dashboard failed to load
        </h1>
        <p className="text-ink-2">{error}</p>
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
  const refreshAgeMs = finishedAt ? Date.now() - new Date(finishedAt).getTime() : NaN
  const isFresh = Number.isFinite(refreshAgeMs) && refreshAgeMs < FRESH_WINDOW_MS

  const validation = data.validation
  const meanModel = mean(validation.map((v) => v.spearman_model))
  const latest =
    validation.length > 0
      ? validation.reduce((a, b) => (b.season > a.season ? b : a))
      : null

  // Headline delta: vs ADP on the drafted subset when cached, else vs the
  // naive baseline (same fallback the validation table makes explicit).
  const adpYears = validation.filter((v) => v.spearman_adp_drafted !== null)
  let delta: { value: number; label: string } | null = null
  if (adpYears.length > 0) {
    const value = mean(
      adpYears.map(
        (v) => (v.spearman_model_drafted ?? v.spearman_model) - (v.spearman_adp_drafted as number),
      ),
    )
    if (value !== null) delta = { value, label: 'ADP' }
  } else {
    const value = mean(validation.map((v) => v.spearman_model - v.spearman_naive))
    if (value !== null) delta = { value, label: 'naive' }
  }

  return (
    <div className="space-y-8">
      {/* Command header + giant CTA */}
      <section className="flex flex-wrap items-center justify-between gap-6 animate-slide-up">
        <div className="space-y-1">
          <p className="flex items-center gap-2 font-bold uppercase tracking-[0.2em] text-accent">
            <span aria-hidden="true">🎙️</span> Command center
          </p>
          <h1 className="font-display text-4xl font-bold tracking-tight">DraftEngine</h1>
        </div>
        <button
          type="button"
          className="btn-primary animate-pulse-ring px-10 py-5 text-xl"
          data-testid="enter-draft-room"
          onClick={() => navigate('/draft')}
        >
          <span aria-hidden="true">🎯</span> Enter Draft Room
        </button>
      </section>

      {/* Hero stat tiles */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
        <section
          className="card-hero space-y-2 animate-slide-up"
          aria-label="Model accuracy"
          style={{ animationDelay: '40ms' }}
        >
          <TileLabel icon="🎯">Model accuracy</TileLabel>
          <p className="stat-number">{meanModel === null ? '—' : meanModel.toFixed(2)}</p>
          <p className="text-ink-3">
            {validation.length > 0
              ? `mean Spearman · ${validation.length} season${validation.length === 1 ? '' : 's'}`
              : 'no validation yet'}
          </p>
          {delta && (
            <p className={`font-bold ${delta.value >= 0 ? 'text-good' : 'text-bad'}`}>
              <span aria-hidden="true">{delta.value >= 0 ? '▲' : '▼'}</span>{' '}
              {delta.value >= 0 ? 'beats' : 'trails'} {delta.label} by{' '}
              <span className="tabular-nums">
                {delta.value >= 0 ? '+' : ''}
                {delta.value.toFixed(2)}
              </span>
            </p>
          )}
        </section>

        <section
          className="card-hero space-y-2 animate-slide-up"
          aria-label="Seasons of data"
          style={{ animationDelay: '80ms' }}
        >
          <TileLabel icon="📚">Seasons of data</TileLabel>
          <p className="stat-number">{SEASONS_OF_DATA}</p>
          <p className="text-ink-3">nflverse history, 1999–2025</p>
        </section>

        <section
          className="card-hero space-y-2 animate-slide-up"
          aria-label="Players modeled"
          style={{ animationDelay: '120ms' }}
        >
          <TileLabel icon="🏈">Players modeled</TileLabel>
          <p className="stat-number">{latest ? latest.n_players : '—'}</p>
          <p className="text-ink-3">
            {latest ? `scored in the ${latest.season} validation` : 'run a refresh to validate'}
          </p>
        </section>

        <section
          className="card-hero space-y-2 animate-slide-up"
          aria-label="Data freshness"
          style={{ animationDelay: '160ms' }}
        >
          <TileLabel icon="📡">Last refresh</TileLabel>
          <p
            data-testid="last-refresh"
            className="font-display text-2xl font-bold"
            title={finishedAt ?? undefined}
          >
            {finishedAt ? timeAgo(finishedAt) : 'Never refreshed'}
          </p>
          <p
            className={`flex items-center gap-2 font-bold ${isFresh ? 'text-good' : 'text-warn'}`}
          >
            <PulseDot live={isFresh} />
            {isFresh ? 'fresh' : 'stale'}
          </p>
        </section>
      </div>

      {/* Scoreboard + status column */}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
        <section
          className="card-hero space-y-3 animate-slide-up lg:col-span-2"
          aria-label="Model check"
          style={{ animationDelay: '200ms' }}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="section-title">
              <span aria-hidden="true">🧪</span> Model check
            </h2>
            <span className="chip bg-raised text-ink-2">
              <span aria-hidden="true">🏆</span> glowing cell = year&apos;s best
            </span>
          </div>
          {validation.length === 0 ? (
            <p className="rounded-xl bg-raised/50 p-4 text-ink-2">
              No validation yet — run a refresh from the Data page.
            </p>
          ) : (
            <ValidationTable validation={validation} />
          )}
        </section>

        <div className="space-y-6">
          <section
            className="card space-y-3 animate-slide-up"
            aria-label="Data status"
            style={{ animationDelay: '240ms' }}
          >
            <h2 className="section-title">
              <span aria-hidden="true">🗄️</span> Data
            </h2>
            <p className="text-ink-2">
              Active model:{' '}
              <span className="font-bold text-ink">{data.model_version ?? 'none yet'}</span>
            </p>
            {data.data_ready ? (
              <p className="font-bold text-good">
                <span aria-hidden="true">✅</span> Data ready
              </p>
            ) : (
              <div role="status" className="rounded-xl border-2 border-warn/50 bg-warn/10 p-3">
                <p className="font-bold text-warn">
                  <span aria-hidden="true">⚠️</span> Data not ready
                </p>
                <p className="text-ink-2">
                  Run a refresh from the{' '}
                  <Link to="/admin" className="font-bold text-accent underline">
                    Data page
                  </Link>
                  .
                </p>
              </div>
            )}
          </section>

          <section
            className="card space-y-3 animate-slide-up"
            aria-label="League settings"
            style={{ animationDelay: '280ms' }}
          >
            <h2 className="section-title">
              <span aria-hidden="true">⚙️</span> League
            </h2>
            <p className="font-bold">{data.settings_summary}</p>
            <Link to="/settings" className="btn-secondary">
              <span aria-hidden="true">✏️</span> Change settings
            </Link>
          </section>
        </div>
      </div>

      {/* Round-by-round heatmaps */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {data.vorp_heatmap ? (
          <HeatmapGrid
            title="What each round actually returned"
            icon="💰"
            heatmap={data.vorp_heatmap}
            scale="diverging"
            format="number"
            testId="vorp-heatmap"
          />
        ) : (
          <EmptyHeatmapCard
            title="What each round actually returned"
            icon="💰"
            testId="vorp-heatmap"
          />
        )}
        {data.hit_rate_heatmap ? (
          <HeatmapGrid
            title="How often picks paid off"
            icon="✅"
            heatmap={data.hit_rate_heatmap}
            scale="sequential"
            format="percent"
            testId="hit-rate-heatmap"
          />
        ) : (
          <EmptyHeatmapCard title="How often picks paid off" icon="✅" testId="hit-rate-heatmap" />
        )}
      </div>
    </div>
  )
}
