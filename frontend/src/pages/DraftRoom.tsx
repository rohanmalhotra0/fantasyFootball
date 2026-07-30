// Draft Room. No :draftId -> lobby (resume or start a draft). With an id
// -> the live room: WS-synced state in the zustand store, one primary
// action at a time, calm big layout with broadcast-booth styling.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import BoardGrid from '../components/draft/BoardGrid'
import MyTeamPanel from '../components/draft/MyTeamPanel'
import NextUpPanel from '../components/draft/NextUpPanel'
import OnClockBanner from '../components/draft/OnClockBanner'
import OpponentTracker from '../components/draft/OpponentTracker'
import PickSearch from '../components/draft/PickSearch'
import PickTicker from '../components/draft/PickTicker'
import PickTimer from '../components/draft/PickTimer'
import ReportView from '../components/draft/ReportView'
import { api } from '../lib/api'
import { useDraftStore } from '../lib/draftStore'
import type {
  BoardPlayer,
  DraftListItem,
  DraftReport,
  PickOut,
  Recommendation,
  SettingsResponse,
} from '../lib/types'
import { connectDraft } from '../lib/ws'

function ErrorAlert({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-bad/50 bg-bad/10 p-4"
    >
      {children}
    </div>
  )
}

// ---------------------------------------------------------------- lobby

function draftProgressLabel(d: DraftListItem): string {
  const round = Math.floor(d.picks_made / d.teams) + 1
  return `R${round}, pick ${d.picks_made + 1}`
}

function Lobby() {
  const navigate = useNavigate()
  const [drafts, setDrafts] = useState<DraftListItem[] | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [settings, setSettings] = useState<SettingsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  // Route announcement for screen readers + tab identity (WCAG 2.4.2).
  // The live Room's title is owned by OnClockBanner (pick-by-pick).
  useEffect(() => {
    document.title = 'Draft Room — DraftEngine'
  }, [])

  useEffect(() => {
    let cancelled = false
    void api
      .listDrafts()
      .then((list) => {
        if (!cancelled) setDrafts(list)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load drafts')
      })
    void api
      .getSettings()
      .then((resp) => {
        if (!cancelled) setSettings(resp)
      })
      .catch(() => {
        /* summary card degrades to a link */
      })
    return () => {
      cancelled = true
    }
  }, [])

  const create = async () => {
    setCreating(true)
    setError(null)
    try {
      const state = await api.createDraft()
      navigate(`/draft/${state.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the draft')
      setCreating(false)
    }
  }

  const summary = settings
    ? `${settings.settings.teams}-team ${settings.settings.scoring_preset.toUpperCase()} ` +
      `${settings.settings.draft_type}, pick ${settings.settings.my_slot}, ` +
      `${settings.rounds} rounds`
    : null

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="animate-slide-up font-display text-3xl font-bold tracking-tight">
        <span aria-hidden="true">🎯</span> Draft Room
      </h1>

      {error && (
        <ErrorAlert>
          <p className="font-bold text-bad">
            <span aria-hidden="true">⚠️</span> {error}
          </p>
        </ErrorAlert>
      )}

      <section className="card-hero animate-slide-up space-y-4" aria-label="Start a new draft">
        <p className="font-bold uppercase tracking-[0.14em] text-ink-3">
          <span aria-hidden="true">🏟️</span> Tonight's broadcast
        </p>
        <h2 className="font-display text-2xl font-bold tracking-tight">New draft</h2>
        <p className="text-lg">
          League: <span className="font-bold text-accent-2">{summary ?? 'loading settings…'}</span>
        </p>
        <p className="text-ink-2">
          Wrong setup?{' '}
          <Link to="/settings" className="font-bold text-accent underline">
            Change it first
          </Link>{' '}
          — settings are frozen once the draft starts.
        </p>
        <button
          type="button"
          className="btn-primary text-xl"
          data-testid="create-draft"
          disabled={creating}
          onClick={() => void create()}
        >
          <span aria-hidden="true">🏈</span> Start new draft
        </button>
      </section>

      <section className="space-y-3" aria-label="Previous drafts">
        <h2 className="section-title">Previous drafts</h2>
        {drafts == null ? (
          <p role="status" className="text-ink-3">
            Loading drafts…
          </p>
        ) : drafts.length === 0 ? (
          <p className="card text-ink-3">No drafts yet — start your first one above.</p>
        ) : (
          <ul className="space-y-3">
            {(showAll ? drafts : drafts.slice(0, 6)).map((d) => (
              <li key={d.id} className="card animate-slide-up flex flex-wrap items-center gap-4">
                <div>
                  <p className="flex items-center gap-2 font-display text-lg font-bold">
                    Draft #{d.id}
                    {d.status === 'complete' ? (
                      <span className="chip border border-good/50 bg-good/10 text-base text-good">
                        <span aria-hidden="true">✓</span> complete
                      </span>
                    ) : (
                      <span className="chip border border-accent/50 bg-accent/10 text-base text-accent">
                        <span aria-hidden="true">●</span> live
                      </span>
                    )}
                  </p>
                  <p className="text-ink-2">
                    {d.teams} teams · {d.rounds} rounds ·{' '}
                    {d.status === 'complete' ? 'complete' : draftProgressLabel(d)}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-secondary ml-auto"
                  onClick={() => navigate(`/draft/${d.id}`)}
                >
                  {d.status === 'complete' ? (
                    <>
                      <span aria-hidden="true">📋</span> View report — draft #{d.id}
                    </>
                  ) : (
                    <>
                      <span aria-hidden="true">▶</span> Resume draft #{d.id} —{' '}
                      {draftProgressLabel(d)}
                    </>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
        {drafts != null && drafts.length > 6 && !showAll && (
          <button type="button" className="btn-secondary" onClick={() => setShowAll(true)}>
            <span aria-hidden="true">▾</span> Show all {drafts.length} drafts
          </button>
        )}
      </section>
    </div>
  )
}

// ----------------------------------------------------------------- room

const TABS = [
  { id: 'next', label: 'Next up', icon: '🎯' },
  { id: 'board', label: 'Board', icon: '🗂️' },
  { id: 'teams', label: 'Teams', icon: '👥' },
] as const

type TabId = (typeof TABS)[number]['id']

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded-md border border-edge bg-raised px-1.5 py-0.5 font-mono text-sm font-bold text-ink-2">
      {children}
    </kbd>
  )
}

function RoomSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading draft room" className="space-y-6">
      <div className="skeleton h-40" />
      <div className="skeleton h-10" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-4">
          <div className="skeleton h-44" />
          <div className="skeleton h-44" />
        </div>
        <div className="skeleton h-80" />
      </div>
    </div>
  )
}

function Room({ draftId }: { draftId: number }) {
  const navigate = useNavigate()
  const state = useDraftStore((s) => s.state)
  const recs = useDraftStore((s) => s.recs)
  const outlooks = useDraftStore((s) => s.outlooks)
  const connection = useDraftStore((s) => s.connection)
  const rankings = useDraftStore((s) => s.rankings)
  const error = useDraftStore((s) => s.error)

  const [loadError, setLoadError] = useState<string | null>(null)
  const [tab, setTab] = useState<TabId>('next')
  const [editing, setEditing] = useState<PickOut | null>(null)
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<DraftReport | null>(null)
  const [reportError, setReportError] = useState<string | null>(null)

  // Mount: initial REST state, rankings pool, then the socket. The socket
  // itself re-fetches state before every reconnect, so nothing is lost.
  useEffect(() => {
    const store = useDraftStore.getState()
    store.reset()
    setLoadError(null)
    setReport(null)
    setReportError(null)
    let cancelled = false
    void api
      .draftState(draftId)
      .then((s) => {
        if (!cancelled) useDraftStore.getState().applyState(s)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : 'Could not load the draft')
        }
      })
    void store.loadRankings()
    const dispose = connectDraft(draftId, {
      onState: (s) => useDraftStore.getState().applyState(s),
      onStatus: (c) => useDraftStore.getState().setConnection(c),
    })
    return () => {
      cancelled = true
      dispose()
      useDraftStore.getState().reset()
    }
  }, [draftId])

  // Draft finished -> pull the report.
  const complete = state?.status === 'complete'
  useEffect(() => {
    if (!complete) return
    let cancelled = false
    void api
      .report(draftId)
      .then((r) => {
        if (!cancelled) setReport(r)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setReportError(err instanceof Error ? err.message : 'Could not build the report')
        }
      })
    return () => {
      cancelled = true
    }
  }, [complete, draftId])

  const pool = useMemo<BoardPlayer[]>(() => {
    if (!rankings || !state) return []
    const picked = new Set(state.picks.map((p) => p.player_id))
    return rankings.filter((p) => !picked.has(p.player_id))
  }, [rankings, state])

  const myOutlook = useMemo(() => {
    if (!state) return null
    return outlooks.find((t) => t.team_index === state.my_slot) ?? recs?.my_outlook ?? null
  }, [outlooks, recs, state])

  const runBusy = useCallback(async (fn: () => Promise<boolean>): Promise<boolean> => {
    setBusy(true)
    try {
      return await fn()
    } finally {
      setBusy(false)
    }
  }, [])

  // Keyboard shortcuts (documented in the Keys hint row). The listener
  // ignores typing contexts so search inputs keep every letter.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return
      }
      const store = useDraftStore.getState()
      const s = store.state
      if (!s || s.status === 'complete' || editing) return
      switch (e.key.toLowerCase()) {
        case 'u':
          if (s.picks.length > 0 && !busy) {
            e.preventDefault()
            void runBusy(() => store.undoPick())
          }
          break
        case '/': {
          e.preventDefault()
          setTab('next')
          // The Next panel may not be rendered yet — retry across a few
          // frames until its search input exists, then focus it.
          const tryFocus = (attempt: number) => {
            const input = document.querySelector<HTMLInputElement>(
              '[data-testid="pick-search-input"]',
            )
            if (input) {
              const details = input.closest('details')
              if (details) details.open = true
              input.focus()
              return
            }
            if (attempt < 10) requestAnimationFrame(() => tryFocus(attempt + 1))
          }
          tryFocus(0)
          break
        }
        case 'b':
          setTab('board')
          break
        case 'n':
          setTab('next')
          break
        case 't':
          setTab('teams')
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, editing, runBusy])

  const handleDraft = (rec: Recommendation) =>
    void runBusy(() =>
      useDraftStore.getState().makePick({ player_id: rec.player_id, source: 'manual' }),
    )

  const handleLogPick = (player: BoardPlayer) =>
    void runBusy(() =>
      useDraftStore.getState().makePick({ player_id: player.player_id, source: 'manual' }),
    )

  const handleUndo = () => void runBusy(() => useDraftStore.getState().undoPick())

  const handleEditPick = (player: BoardPlayer) => {
    if (!editing) return
    void runBusy(async () => {
      const ok = await useDraftStore.getState().editPick(editing.overall, player.player_id)
      if (ok) setEditing(null)
      return ok
    })
  }

  if (loadError) {
    return (
      <div role="alert" className="card mx-auto max-w-xl space-y-4">
        <h1 className="text-2xl font-bold">
          <span aria-hidden="true">⚠️</span> Could not open draft #{draftId}
        </h1>
        <p>{loadError}</p>
        <Link to="/draft" className="btn-primary">
          <span aria-hidden="true">←</span> Back to Draft Room
        </Link>
      </div>
    )
  }

  if (!state) return <RoomSkeleton />

  return (
    <div className="space-y-6">
      {/* The banner's "Pick N" line is visually the headline; this gives the
          page its one h1 for the heading outline (WCAG 1.3.1 / 2.4.6). */}
      <h1 className="sr-only">Live draft room — draft #{draftId}</h1>
      {error && (
        <ErrorAlert>
          <p className="text-lg font-bold text-bad">
            <span aria-hidden="true">⚠️</span> {error}
          </p>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => useDraftStore.getState().clearError()}
          >
            <span aria-hidden="true">✕</span> Dismiss
          </button>
        </ErrorAlert>
      )}

      <OnClockBanner
        state={state}
        connection={connection}
        timer={
          !complete ? <PickTimer resetKey={state.current_overall ?? 'done'} /> : null
        }
      />
      <PickTicker state={state} />

      {complete ? (
        report ? (
          <ReportView report={report} onNewDraft={() => navigate('/draft')} />
        ) : reportError ? (
          <div role="alert" className="card space-y-3">
            <p className="text-lg font-bold text-bad">
              <span aria-hidden="true">⚠️</span> {reportError}
            </p>
            <button type="button" className="btn-secondary" onClick={() => navigate('/draft')}>
              <span aria-hidden="true">←</span> Back to Draft Room
            </button>
          </div>
        ) : (
          <p role="status" className="card text-xl font-bold text-ink-2">
            Grading your draft…
          </p>
        )
      ) : (
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div
                role="tablist"
                aria-label="Draft views"
                className="inline-flex max-w-full gap-1 overflow-x-auto rounded-xl border border-edge bg-surface/80 p-1 backdrop-blur-sm"
              >
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    id={`tab-${t.id}`}
                    data-testid={`tab-${t.id}`}
                    aria-selected={tab === t.id}
                    aria-controls={`panel-${t.id}`}
                    className={`flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-base font-bold transition-colors sm:px-4 sm:text-lg ${
                      tab === t.id
                        ? 'bg-accent text-bg shadow-glow-sm'
                        : 'text-ink-2 hover:bg-raised hover:text-ink'
                    }`}
                    onClick={() => setTab(t.id)}
                  >
                    <span aria-hidden="true">{t.icon}</span> {t.label}
                  </button>
                ))}
              </div>
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-base text-ink-3">
                Keys: <Kbd>U</Kbd> undo · <Kbd>/</Kbd> search · <Kbd>B</Kbd> board · <Kbd>N</Kbd>{' '}
                next · <Kbd>T</Kbd> teams
              </p>
            </div>

            <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
              {tab === 'next' && (
                <NextUpPanel
                  state={state}
                  recs={recs}
                  pool={pool}
                  onDraft={handleDraft}
                  onLogPick={handleLogPick}
                  busy={busy}
                />
              )}
              {tab === 'board' && <BoardGrid state={state} onEditPick={setEditing} />}
              {tab === 'teams' && <OpponentTracker state={state} outlooks={outlooks} />}
            </div>
          </div>

          <MyTeamPanel
            state={state}
            outlook={myOutlook}
            outlooks={outlooks}
            onUndo={handleUndo}
            onVoiceCommitted={() => void useDraftStore.getState().refresh()}
            busy={busy}
          />
        </div>
      )}

      {editing && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Edit pick ${editing.overall}`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-bg/80 p-4 backdrop-blur-sm"
          onKeyDown={(e) => {
            if (e.key === 'Escape') setEditing(null)
          }}
        >
          <div className="card max-h-[85vh] w-full max-w-2xl space-y-4 overflow-y-auto">
            <div className="flex items-start justify-between gap-4">
              <h2 className="section-title">
                <span aria-hidden="true">✏️</span> Edit pick #{editing.overall} —{' '}
                {editing.player_name}
              </h2>
              <button type="button" className="btn-secondary" onClick={() => setEditing(null)}>
                <span aria-hidden="true">✕</span> Close
              </button>
            </div>
            <PickSearch
              players={pool}
              actionLabel="Use this player"
              onPick={handleEditPick}
              busy={busy}
              inputLabel="Replace with"
            />
          </div>
        </div>
      )}
    </div>
  )
}

// ----------------------------------------------------------------- page

export default function DraftRoom() {
  const { draftId } = useParams()
  if (draftId == null) return <Lobby />
  const id = Number(draftId)
  if (!Number.isInteger(id) || id <= 0) {
    return (
      <div role="alert" className="card mx-auto max-w-xl space-y-4">
        <h1 className="text-2xl font-bold">
          <span aria-hidden="true">⚠️</span> That draft link looks wrong
        </h1>
        <Link to="/draft" className="btn-primary">
          <span aria-hidden="true">←</span> Back to Draft Room
        </Link>
      </div>
    )
  }
  return <Room draftId={id} />
}
