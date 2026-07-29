// Big Board: full player rankings with search, filters, and per-player
// edits (pin / hide / manual rank). The server is the source of truth —
// every edit swaps in the full response from api.editPlayer.

import Fuse from 'fuse.js'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import BoardTable from '../components/board/BoardTable'
import PositionChip from '../components/board/PositionChip'
import { api } from '../lib/api'
import type { PlayerEditRequest, RankingsResponse } from '../lib/types'

const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DST']
const VALUE_GAP_MIN = 5

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
      <p role="status" className="text-xl font-bold text-slate-600">
        Loading the board…
      </p>
    )
  }

  if (loadError) {
    return (
      <div role="alert" className="card border-red-300 bg-red-50 text-lg text-red-900">
        <p className="font-bold">
          <span aria-hidden="true">❌</span> Could not load the board
        </p>
        <p>{loadError}</p>
      </div>
    )
  }

  if (!data || data.players.length === 0) {
    return (
      <div className="card mx-auto max-w-xl space-y-4 text-center">
        <h1 className="text-2xl font-bold">
          <span aria-hidden="true">🏈</span> The board is empty
        </h1>
        <p className="text-lg">
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
      <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="text-3xl font-bold">
          <span aria-hidden="true">🏈</span> Big Board
        </h1>
        <p className="text-lg text-slate-600">
          Season {data.season} · model {data.model_version ?? 'none'}
        </p>
      </header>

      {!data.adp_available && (
        <p
          role="note"
          className="rounded-2xl border-2 border-amber-300 bg-amber-100 px-4 py-3 text-lg font-bold text-amber-900"
        >
          <span aria-hidden="true">📭</span> No ADP cached — value gap and ADP columns will fill in
          after a refresh where FFC is reachable.
        </p>
      )}

      {editError && (
        <p
          role="alert"
          className="rounded-2xl border-2 border-red-300 bg-red-50 px-4 py-3 text-lg font-bold text-red-900"
        >
          <span aria-hidden="true">❌</span> Edit failed: {editError}
        </p>
      )}

      {/* Toolbar */}
      <div className="card space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="board-search" className="text-lg font-bold">
            <span aria-hidden="true">🔍</span> Search
          </label>
          <input
            id="board-search"
            type="text"
            data-testid="board-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name or team"
            className="w-72 max-w-full rounded-xl border-2 border-slate-300 px-4 py-2.5 text-lg"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="btn-secondary text-lg"
            >
              <span aria-hidden="true">✕</span> Clear
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Position filter">
          <button
            type="button"
            data-testid="filter-pos-All"
            aria-pressed={pos === null}
            onClick={() => setPos(null)}
            className={`rounded-xl border-2 px-4 py-2 text-lg font-bold ${
              pos === null
                ? 'border-blue-700 bg-blue-700 text-white'
                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
            }`}
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
              className={`rounded-xl border-2 px-4 py-2 text-lg font-bold ${
                pos === label
                  ? 'border-blue-700 bg-blue-700 text-white'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
              }`}
            >
              {label}
            </button>
          ))}

          <label htmlFor="filter-tier" className="ml-2 text-lg font-bold">
            Tier
          </label>
          <select
            id="filter-tier"
            data-testid="filter-tier"
            value={tier}
            onChange={(e) => setTier(e.target.value)}
            className="rounded-xl border-2 border-slate-300 bg-white px-3 py-2 text-lg"
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
            className={`ml-2 rounded-xl border-2 px-4 py-2 text-lg font-bold ${
              valueOnly
                ? 'border-green-700 bg-green-700 text-white'
                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
            }`}
          >
            <span aria-hidden="true">💎</span> Value only
          </button>
        </div>
      </div>

      <p className="text-lg font-bold text-slate-600">
        Showing {visible.length} of {active.length} players
      </p>

      {visible.length === 0 ? (
        <div className="card text-center text-xl font-bold text-slate-600">
          No players match your filters.
        </div>
      ) : (
        <BoardTable players={visible} onEdit={handleEdit} />
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
    </div>
  )
}
