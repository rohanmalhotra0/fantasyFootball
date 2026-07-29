// Fuzzy search over the remaining player pool. Used to log opponents'
// picks, to pick off-board on my turn, and inside the edit-pick dialog.

import Fuse from 'fuse.js'
import { useMemo, useState } from 'react'
import type { BoardPlayer } from '../../lib/types'
import { PosChip } from './RecCard'

const MAX_RESULTS = 8

interface PickSearchProps {
  /** Remaining pool: rankings minus already-picked ids. */
  players: BoardPlayer[]
  /** Button text, e.g. "Log pick" or "Use this player". */
  actionLabel: string
  onPick: (player: BoardPlayer) => void
  busy?: boolean
  inputLabel?: string
}

export default function PickSearch({
  players,
  actionLabel,
  onPick,
  busy = false,
  inputLabel = 'Search players',
}: PickSearchProps) {
  const [query, setQuery] = useState('')

  const fuse = useMemo(
    () =>
      new Fuse(players, {
        keys: ['name', 'team', 'position'],
        threshold: 0.35,
        ignoreLocation: true,
      }),
    [players],
  )

  const results = useMemo(() => {
    const q = query.trim()
    if (!q) return players.slice(0, MAX_RESULTS)
    return fuse.search(q, { limit: MAX_RESULTS }).map((r) => r.item)
  }, [players, fuse, query])

  return (
    <div data-testid="pick-search" className="space-y-3">
      <label className="block space-y-1">
        <span className="font-bold">{inputLabel}</span>
        <input
          type="search"
          data-testid="pick-search-input"
          className="w-full rounded-xl border-2 border-slate-300 px-4 py-3 text-lg"
          placeholder="Type a name, press Enter for the top match"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            // Keyboard path: Enter commits the top match.
            if (e.key === 'Enter' && !busy && results.length > 0) {
              e.preventDefault()
              onPick(results[0])
            }
          }}
        />
      </label>
      {players.length === 0 ? (
        <p className="text-slate-600">Player pool not loaded yet.</p>
      ) : results.length === 0 ? (
        <p className="text-slate-600">No remaining players match “{query.trim()}”.</p>
      ) : (
        <ul className="space-y-2">
          {results.map((p) => (
            <li
              key={p.player_id}
              className="flex flex-wrap items-center gap-3 rounded-xl border-2 border-slate-200 bg-white px-4 py-3"
            >
              <span className="text-lg font-bold">{p.name}</span>
              <PosChip position={p.position} team={p.team} />
              {p.projected_points != null && (
                <span className="text-slate-700">{Math.round(p.projected_points)} pts</span>
              )}
              <button
                type="button"
                className="btn-secondary ml-auto"
                data-testid={`pick-result-${p.player_id}`}
                disabled={busy}
                aria-label={`${actionLabel}: ${p.name}`}
                onClick={() => onPick(p)}
              >
                <span aria-hidden="true">✏️</span> {actionLabel}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
