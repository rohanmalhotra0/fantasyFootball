// Big Board: full player rankings with search, filters, and per-player
// edits (pin / hide / manual rank). The server is the source of truth —
// every edit swaps in the full response from api.editPlayer. Clicking a
// player row opens the career drawer.

import Fuse from 'fuse.js'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import BoardTable from '../components/board/BoardTable'
import PlayerDrawer from '../components/board/PlayerDrawer'
import PositionChip from '../components/board/PositionChip'
import { api } from '../lib/api'
import type { BoardPlayer, PlayerEditRequest, RankingsResponse } from '../lib/types'

const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DST']
const VALUE_GAP_MIN = 5

/** Filter chips share one look: quiet at rest, accent glow when pressed. */
function filterChipClass(active: boolean): string {
  return `rounded-xl border-2 px-4 py-2 text-lg font-bold transition-colors ${
    active
      ? 'border-accent bg-accent/15 text-accent shadow-glow-sm'
      : 'border-edge bg-raised/60 text-ink-2 hover:border-accent/50 hover:text-ink'
  }`
}

export default function Rankings() {
  const [data, setData] = useState<RankingsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editError, setEditError] = useState<string | null>(null)

  const [query, setQuery] = useState('')
  const [pos, setPos] = useState<string | null>(null)
  const [tier, setTier] = useState('all')
  const [valueOnly, setValueOnly] = useState(false)
  const [showHidden, setShowHidden] = useState(false)
  const [selected, setSelected] = useState<BoardPlayer | null>(null)

  useEffect(() => {
    api
      .rankings()
      .then((resp) => setData(resp))
      .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : 'Load failed'))
      .finally(() => setLoading(false))
  }, [])

  const active = useMemo(() => (data?.players ?? []).filter((p) => !p.banned), [data])
  const hidden = useMemo(() => (data?.players ?? []).filter((p) => p.banned), [data])

  const fuse = useMemo(
    () => new Fuse(active, { keys: ['name', 'team'], threshold: 0.35 }),
    [active],
  )

  const visible = useMemo(() => {
    let list = active
    const q = query.trim()
    if (q) {
      // Fuse finds the matches; we keep the board's own order (pinned
      // rows stay on top) instead of fuse relevance order.
      const ids = new Set(fuse.search(q).map((r) => r.item.player_id))
      list = list.filter((p) => ids.has(p.player_id))
    }
    if (pos) list = list.filter((p) => p.position === pos)
    if (tier !== 'all') list = list.filter((p) => p.tier === Number(tier))
    if (valueOnly) list = list.filter((p) => p.value_gap != null && p.value_gap >= VALUE_GAP_MIN)
    return list
  }, [active, fuse, query, pos, tier, valueOnly])

  // Tier bands are only honest on the untouched rank order.
  const unfiltered = query.trim() === '' && pos === null && tier === 'all' && !valueOnly

  const tiersPresent = useMemo(() => {
    const set = new Set<number>()
    for (const p of active) if (p.tier != null) set.add(p.tier)
    return [...set].sort((a, b) => a - b)
  }, [active])

  const handleEdit = async (edit: PlayerEditRequest) => {
    setEditError(null)
    try {
      setData(await api.editPlayer(edit))
    } catch (err: unknown) {
      setEditError(err instanceof Error ? err.message : 'Edit failed')
    }
  }

  if (loading) {
    return (
      <div role="status" className="space-y-4" aria-label="Loading the board">
        <p className="sr-only">Loading the board…</p>
        <div aria-hidden="true" className="skeleton h-12 w-64" />
        <div aria-hidden="true" className="skeleton h-24 w-full" />
        <div aria-hidden="true" className="skeleton h-96 w-full" />
      </div>
    )
  }

  if (loadError) {
    return (
      <div role="alert" className="card space-y-1 border-bad/50 text-lg">
        <p className="font-bold text-bad">
          <span aria-hidden="true">❌</span> Could not load the board
        </p>
        <p className="text-ink-2">{loadError}</p>
      </div>
    )
  }

  if (!data || data.players.length === 0) {
    return (
      <div className="card-hero mx-auto max-w-xl animate-slide-up space-y-4 text-center">
        <h1 className="text-2xl font-bold">
          <span aria-hidden="true">🏈</span> The board is empty
        </h1>
        <p className="text-lg text-ink-2">
          No players yet — download data and train a model first. It takes one click.
        </p>
        <Link to="/admin" className="btn-primary">
          <span aria-hidden="true">🗄️</span> Go to the Data page
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <header className="flex animate-slide-up flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="font-display text-3xl font-bold tracking-tight">
          <span aria-hidden="true">🏈</span> Big Board
        </h1>
        <p className="text-lg text-ink-2">
          Season <span className="font-bold text-ink">{data.season}</span> · model{' '}
          <span className="font-bold text-ink">{data.model_version ?? 'none'}</span>
        </p>
      </header>

      {!data.adp_available && (
        <p
          role="note"
          className="rounded-2xl border border-warn/50 bg-warn/10 px-4 py-3 text-lg font-bold text-warn"
        >
          <span aria-hidden="true">📭</span> No ADP cached — value gap and ADP columns will fill in
          after a refresh where FFC is reachable.
        </p>
      )}

      {editError && (
        <p
          role="alert"
          className="rounded-2xl border border-bad/50 bg-bad/10 px-4 py-3 text-lg font-bold text-bad"
        >
          <span aria-hidden="true">❌</span> Edit failed: {editError}
        </p>
      )}

      {/* Sticky glass toolbar — stays with you down 200+ rows. */}
      <div className="sticky top-[76px] z-30 animate-slide-up rounded-2xl border border-edge/70 bg-surface/85 p-4 shadow-card backdrop-blur-md">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <label htmlFor="board-search" className="sr-only">
              Search players by name or team
            </label>
            <span className="relative">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3"
              >
                🔍
              </span>
              <input
                id="board-search"
                type="text"
                data-testid="board-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name or team"
                className="w-80 max-w-full rounded-xl border-2 border-edge bg-raised/60 py-2.5 pl-11 pr-4 text-lg text-ink placeholder:text-ink-3 focus:border-accent/70"
              />
            </span>
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="btn-secondary px-3 py-2 text-base"
              >
                <span aria-hidden="true">✕</span> Clear
              </button>
            )}
            <span className="ml-auto hidden text-base font-bold text-ink-3 sm:block">
              <span aria-hidden="true">👆</span> Click a row for career detail
            </span>
          </div>

          <div
            className="flex flex-wrap items-center gap-2"
            role="group"
            aria-label="Position filter"
          >
            <button
              type="button"
              data-testid="filter-pos-All"
              aria-pressed={pos === null}
              onClick={() => setPos(null)}
              className={filterChipClass(pos === null)}
            >
              All
            </button>
            {POSITIONS.map((label) => (
              <button
                key={label}
                type="button"
                data-testid={`filter-pos-${label}`}
                aria-pressed={pos === label}
                onClick={() => setPos(pos === label ? null : label)}
                className={filterChipClass(pos === label)}
              >
                {label}
              </button>
            ))}

            <label htmlFor="filter-tier" className="ml-2 text-lg font-bold text-ink-2">
              Tier
            </label>
            <select
              id="filter-tier"
              data-testid="filter-tier"
              value={tier}
              onChange={(e) => setTier(e.target.value)}
              className="rounded-xl border-2 border-edge bg-raised/60 px-3 py-2 text-lg text-ink"
            >
              <option value="all">All tiers</option>
              {tiersPresent.map((t) => (
                <option key={t} value={String(t)}>
                  Tier {t}
                </option>
              ))}
            </select>

            <button
              type="button"
              data-testid="filter-value"
              aria-pressed={valueOnly}
              onClick={() => setValueOnly((v) => !v)}
              className={`ml-2 rounded-xl border-2 px-4 py-2 text-lg font-bold transition-colors ${
                valueOnly
                  ? 'border-good bg-good/15 text-good shadow-glow-sm'
                  : 'border-edge bg-raised/60 text-ink-2 hover:border-good/50 hover:text-ink'
              }`}
            >
              <span aria-hidden="true">💎</span> Value only
            </button>
          </div>
        </div>
      </div>

      <p className="text-lg font-bold text-ink-2">
        Showing {visible.length} of {active.length} players
      </p>

      {visible.length === 0 ? (
        <div className="card text-center text-xl font-bold text-ink-2">
          <span aria-hidden="true">🕳️</span> No players match your filters.
        </div>
      ) : (
        <div className="animate-slide-up">
          <BoardTable
            players={visible}
            onEdit={handleEdit}
            showTierBands={unfiltered}
            onOpenPlayer={setSelected}
          />
        </div>
      )}

      {hidden.length > 0 && (
        <section className="card space-y-4" aria-label="Hidden players">
          <button
            type="button"
            data-testid="hidden-toggle"
            aria-expanded={showHidden}
            onClick={() => setShowHidden((v) => !v)}
            className="btn-secondary text-lg"
          >
            <span aria-hidden="true">🚫</span> Hidden players ({hidden.length}){' '}
            <span aria-hidden="true">{showHidden ? '▲' : '▼'}</span>
          </button>
          {showHidden && (
            <ul className="space-y-3">
              {hidden.map((p) => (
                <li key={p.player_id} className="flex flex-wrap items-center gap-3 text-lg">
                  <span className="font-bold">{p.name}</span>
                  <PositionChip position={p.position} team={p.team} />
                  <button
                    type="button"
                    data-testid={`unban-${p.player_id}`}
                    aria-label={`Unhide ${p.name}`}
                    onClick={() => handleEdit({ player_id: p.player_id, banned: false })}
                    className="btn-secondary"
                  >
                    <span aria-hidden="true">👁️</span> Unhide
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {selected && <PlayerDrawer player={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
