// Big board table. Renders rows in the order given (server sorts pinned
// players to the top — trust the response order). Every edit goes through
// onEdit -> api.editPlayer; the page swaps in the server response.

import { useEffect, useState } from 'react'
import type { BoardPlayer, PlayerEditRequest } from '../../lib/types'
import PositionChip from './PositionChip'
import TierBadge from './TierBadge'

interface BoardTableProps {
  players: BoardPlayer[]
  onEdit: (edit: PlayerEditRequest) => void
}

function fmt1(n: number | null): string {
  return n == null ? '—' : n.toFixed(1)
}

function RankCell({ p }: { p: BoardPlayer }) {
  const rank = p.manual_rank ?? p.model_rank
  if (rank == null) {
    return p.unmodeled ? (
      <span className="rounded-lg bg-slate-200 px-2 py-0.5 text-base font-bold text-slate-700">
        ADP
      </span>
    ) : (
      <span className="text-slate-400">—</span>
    )
  }
  return (
    <span className="font-bold tabular-nums">
      {rank}
      {p.manual_rank != null && <span className="sr-only"> (manual rank)</span>}
    </span>
  )
}

function GapCell({ gap }: { gap: number | null }) {
  if (gap == null) return <span className="text-slate-400">—</span>
  if (gap === 0) return <span className="tabular-nums text-slate-600">0</span>
  // Sign AND arrow travel with the color — color is never the only signal.
  return gap > 0 ? (
    <span className="whitespace-nowrap font-bold tabular-nums text-green-700">+{gap} ↑</span>
  ) : (
    <span className="whitespace-nowrap font-bold tabular-nums text-red-700">
      {gap} ↓
    </span>
  )
}

function ManualRankInput({
  player,
  onEdit,
}: {
  player: BoardPlayer
  onEdit: (edit: PlayerEditRequest) => void
}) {
  const [text, setText] = useState(player.manual_rank?.toString() ?? '')
  useEffect(() => {
    setText(player.manual_rank?.toString() ?? '')
  }, [player.manual_rank])

  const commit = () => {
    const trimmed = text.trim()
    if (trimmed === '') {
      if (player.manual_rank != null) {
        onEdit({ player_id: player.player_id, clear_manual_rank: true })
      }
      return
    }
    const n = Number(trimmed)
    if (!Number.isInteger(n) || n < 1) {
      setText(player.manual_rank?.toString() ?? '')
      return
    }
    if (n !== player.manual_rank) {
      onEdit({ player_id: player.player_id, manual_rank: n })
    }
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <input
        type="number"
        min={1}
        value={text}
        placeholder="rank"
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
        }}
        aria-label={`Manual rank for ${player.name}`}
        data-testid={`rank-${player.player_id}`}
        className="w-20 rounded-xl border-2 border-slate-300 px-2 py-1.5 text-center text-base"
      />
      {player.manual_rank != null && (
        <button
          type="button"
          onClick={() => onEdit({ player_id: player.player_id, clear_manual_rank: true })}
          aria-label={`Clear manual rank for ${player.name}`}
          data-testid={`rank-clear-${player.player_id}`}
          className="rounded-lg border-2 border-slate-300 bg-white px-2 py-1 text-base font-bold text-slate-700 hover:bg-slate-100"
        >
          <span aria-hidden="true">✕</span> Clear
        </button>
      )}
    </span>
  )
}

export default function BoardTable({ players, onEdit }: BoardTableProps) {
  return (
    <div className="overflow-x-auto rounded-2xl border-2 border-slate-200 bg-white shadow-sm">
      <table className="w-full text-lg" data-testid="board-table">
        <caption className="sr-only">Big board player rankings</caption>
        <thead>
          <tr className="border-b-2 border-slate-300 bg-slate-100 text-left">
            <th scope="col" className="px-4 py-3">
              Rank
            </th>
            <th scope="col" className="px-4 py-3">
              Player
            </th>
            <th scope="col" className="px-4 py-3 text-right">
              Proj
            </th>
            <th scope="col" className="px-4 py-3 text-right">
              VORP
            </th>
            <th scope="col" className="px-4 py-3 text-right">
              ADP
            </th>
            <th scope="col" className="px-4 py-3 text-right">
              Gap
            </th>
            <th scope="col" className="px-4 py-3">
              Tier
            </th>
            <th scope="col" className="px-4 py-3">
              Flags
            </th>
            <th scope="col" className="px-4 py-3">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {players.map((p) => (
            <tr
              key={p.player_id}
              className={`border-b border-slate-200 align-middle odd:bg-white even:bg-slate-50 ${
                p.pinned ? 'border-l-4 border-l-amber-400' : ''
              }`}
            >
              <td className="px-4 py-3">
                <RankCell p={p} />
              </td>
              <td className="px-4 py-3">
                <span className="flex flex-wrap items-center gap-2">
                  {p.pinned && (
                    <>
                      <span aria-hidden="true" title="Pinned">
                        ⭐
                      </span>
                      <span className="sr-only">Pinned:</span>
                    </>
                  )}
                  <span className="font-bold">{p.name}</span>
                  <PositionChip position={p.position} team={p.team} />
                </span>
              </td>
              <td className="px-4 py-3 text-right tabular-nums">{fmt1(p.projected_points)}</td>
              <td className="px-4 py-3 text-right font-bold tabular-nums">{fmt1(p.vorp)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{fmt1(p.adp)}</td>
              <td className="px-4 py-3 text-right">
                <GapCell gap={p.value_gap} />
              </td>
              <td className="px-4 py-3">
                <TierBadge tier={p.tier} />
              </td>
              <td className="px-4 py-3">
                <span className="flex flex-col items-start gap-1.5">
                  {p.risk_flag && (
                    <span className="whitespace-nowrap rounded-lg border-2 border-amber-400 bg-amber-100 px-2 py-0.5 text-base font-bold text-amber-900">
                      <span aria-hidden="true">⚠️</span> thin sample
                    </span>
                  )}
                  {p.unmodeled && (
                    <span className="whitespace-nowrap rounded-lg border-2 border-slate-300 bg-slate-100 px-2 py-0.5 text-base font-bold text-slate-700">
                      <span aria-hidden="true">🧾</span> ADP only
                    </span>
                  )}
                </span>
              </td>
              <td className="px-4 py-3">
                <span className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    data-testid={`pin-${p.player_id}`}
                    aria-pressed={p.pinned}
                    aria-label={p.pinned ? `Unpin ${p.name}` : `Pin ${p.name}`}
                    onClick={() => onEdit({ player_id: p.player_id, pinned: !p.pinned })}
                    className={`whitespace-nowrap rounded-xl border-2 px-3 py-1.5 text-base font-bold ${
                      p.pinned
                        ? 'border-amber-500 bg-amber-100 text-amber-900'
                        : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <span aria-hidden="true">⭐</span> {p.pinned ? 'Pinned' : 'Pin'}
                  </button>
                  <button
                    type="button"
                    data-testid={`ban-${p.player_id}`}
                    aria-label={`Hide ${p.name}`}
                    onClick={() => onEdit({ player_id: p.player_id, banned: true })}
                    className="whitespace-nowrap rounded-xl border-2 border-slate-300 bg-white px-3 py-1.5 text-base font-bold text-slate-700 hover:border-red-400 hover:bg-red-50"
                  >
                    <span aria-hidden="true">🚫</span> Hide
                  </button>
                  <ManualRankInput player={p} onEdit={onEdit} />
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
