// Big board table. Renders rows in the order given (server sorts pinned
// players to the top — trust the response order). Every edit goes through
// onEdit -> api.editPlayer; the page swaps in the server response.
//
// When the board is unfiltered and in rank order, full-width tier divider
// rows band the table ("TIER 3" + gradient hairline). Clicking anywhere on
// a row that is not an action control opens the player drawer.

import type { MouseEvent } from 'react'
import { Fragment, useEffect, useState } from 'react'
import type { BoardPlayer, PlayerEditRequest } from '../../lib/types'
import PositionChip from './PositionChip'
import TierBadge from './TierBadge'

interface BoardTableProps {
  players: BoardPlayer[]
  onEdit: (edit: PlayerEditRequest) => void
  /** Rank-order banding is only honest when no filter reorders/thins the list. */
  showTierBands?: boolean
  onOpenPlayer?: (player: BoardPlayer) => void
}

function fmt1(n: number | null): string {
  return n == null ? '—' : n.toFixed(1)
}

function RankCell({ p }: { p: BoardPlayer }) {
  const rank = p.manual_rank ?? p.model_rank
  if (rank == null) {
    return p.unmodeled ? (
      <span className="chip border border-edge bg-raised/60 text-ink-2">ADP</span>
    ) : (
      <span className="text-ink-3">—</span>
    )
  }
  return (
    <span className="font-display text-xl font-bold tabular-nums tracking-tight">
      {rank}
      {p.manual_rank != null && <span className="sr-only"> (manual rank)</span>}
    </span>
  )
}

function GapCell({ gap }: { gap: number | null }) {
  if (gap == null) return <span className="text-ink-3">—</span>
  if (gap === 0) return <span className="tabular-nums text-ink-2">0</span>
  // Sign AND arrow travel with the color — color is never the only signal.
  return gap > 0 ? (
    <span className="chip whitespace-nowrap border border-good/40 bg-good/10 tabular-nums text-good">
      <span aria-hidden="true">↑</span>+{gap}
    </span>
  ) : (
    <span className="chip whitespace-nowrap border border-bad/40 bg-bad/10 tabular-nums text-bad">
      <span aria-hidden="true">↓</span>
      {gap}
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
        className="w-20 rounded-xl border-2 border-edge bg-raised/60 px-2 py-1.5 text-center text-base text-ink placeholder:text-ink-3"
      />
      {player.manual_rank != null && (
        <button
          type="button"
          onClick={() => onEdit({ player_id: player.player_id, clear_manual_rank: true })}
          aria-label={`Clear manual rank for ${player.name}`}
          data-testid={`rank-clear-${player.player_id}`}
          className="rounded-lg border-2 border-edge bg-raised/60 px-2 py-1 text-base font-bold text-ink-2 transition-colors hover:border-accent/60 hover:text-ink"
        >
          <span aria-hidden="true">✕</span> Clear
        </button>
      )}
    </span>
  )
}

/** Band key for the divider rows: pinned block, then tiers, then untiered. */
function bandOf(p: BoardPlayer): string {
  if (p.pinned) return 'pinned'
  return p.tier == null ? 'untiered' : `tier-${p.tier}`
}

function bandLabel(band: string): string {
  if (band === 'pinned') return '★ Pinned'
  if (band === 'untiered') return 'Untiered'
  return `Tier ${band.slice(5)}`
}

function TierDividerRow({ band }: { band: string }) {
  return (
    <tr data-tier-divider={band} className="hover:!bg-transparent">
      <td colSpan={9} className="!py-2 pl-5">
        <span className="flex items-center gap-3">
          <span className="font-display text-base font-bold uppercase tracking-[0.2em] text-accent">
            {bandLabel(band)}
          </span>
          <span
            aria-hidden="true"
            className="h-px flex-1"
            style={{
              background:
                'linear-gradient(90deg, rgb(var(--de-accent) / 0.6), rgb(var(--de-accent-2) / 0.25), transparent)',
            }}
          />
        </span>
      </td>
    </tr>
  )
}

export default function BoardTable({
  players,
  onEdit,
  showTierBands = false,
  onOpenPlayer,
}: BoardTableProps) {
  const handleRowClick = (e: MouseEvent<HTMLTableRowElement>, p: BoardPlayer) => {
    if (!onOpenPlayer) return
    // Action controls keep their own behavior — only plain row space opens
    // the drawer.
    if ((e.target as HTMLElement).closest('button, a, input, select, label')) return
    onOpenPlayer(p)
  }

  let prevBand: string | null = null

  return (
    <div className="table-shell overflow-x-auto rounded-2xl border border-edge/70 bg-surface/80 shadow-card backdrop-blur-sm">
      <table className="w-full text-lg" data-testid="board-table">
        <caption className="sr-only">
          Big board player rankings. Click a player row to open career details.
        </caption>
        <thead>
          <tr className="text-left">
            <th scope="col" className="pl-5">
              Rank
            </th>
            <th scope="col">Player</th>
            <th scope="col" className="text-right">
              Proj
            </th>
            <th scope="col" className="text-right">
              VORP
            </th>
            <th scope="col" className="text-right">
              ADP
            </th>
            <th scope="col" className="text-right">
              Gap
            </th>
            <th scope="col">Tier</th>
            <th scope="col">Flags</th>
            <th scope="col" className="pr-5">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {players.map((p) => {
            const band = bandOf(p)
            const divider = showTierBands && band !== prevBand ? <TierDividerRow band={band} /> : null
            prevBand = band
            return (
              <Fragment key={p.player_id}>
                {divider}
                <tr
                  onClick={(e) => handleRowClick(e, p)}
                  className={`align-middle ${onOpenPlayer ? 'cursor-pointer' : ''} ${
                    p.pinned ? 'border-l-4 border-l-accent bg-accent/5' : ''
                  }`}
                >
                  <td className="pl-5">
                    <RankCell p={p} />
                  </td>
                  <td>
                    <span className="flex flex-wrap items-center gap-2.5">
                      {p.pinned && (
                        <>
                          <span aria-hidden="true" title="Pinned" className="text-accent">
                            ★
                          </span>
                          <span className="sr-only">Pinned:</span>
                        </>
                      )}
                      {onOpenPlayer ? (
                        <button
                          type="button"
                          data-testid={`player-open-${p.player_id}`}
                          onClick={() => onOpenPlayer(p)}
                          aria-haspopup="dialog"
                          aria-label={`Open details for ${p.name}`}
                          className="whitespace-nowrap rounded-md font-bold text-ink underline-offset-4 hover:text-accent hover:underline"
                        >
                          {p.name}
                        </button>
                      ) : (
                        <span className="font-bold">{p.name}</span>
                      )}
                      <PositionChip position={p.position} team={p.team} />
                    </span>
                  </td>
                  <td className="text-right tabular-nums text-ink-2">{fmt1(p.projected_points)}</td>
                  <td className="text-right font-display font-bold tabular-nums">{fmt1(p.vorp)}</td>
                  <td className="text-right tabular-nums text-ink-2">{fmt1(p.adp)}</td>
                  <td className="text-right">
                    <GapCell gap={p.value_gap} />
                  </td>
                  <td>
                    <TierBadge tier={p.tier} />
                  </td>
                  <td>
                    <span className="flex flex-col items-start gap-1.5">
                      {p.risk_flag && (
                        <span className="chip whitespace-nowrap border border-warn/50 bg-warn/10 text-warn">
                          <span aria-hidden="true">⚠️</span> thin sample
                        </span>
                      )}
                      {p.unmodeled && (
                        <span className="chip whitespace-nowrap border border-edge bg-raised/60 text-ink-2">
                          <span aria-hidden="true">🧾</span> ADP only
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="pr-5">
                    <span className="flex flex-nowrap items-center gap-2">
                      <button
                        type="button"
                        data-testid={`pin-${p.player_id}`}
                        aria-pressed={p.pinned}
                        aria-label={p.pinned ? `Unpin ${p.name}` : `Pin ${p.name}`}
                        onClick={() => onEdit({ player_id: p.player_id, pinned: !p.pinned })}
                        className={`whitespace-nowrap rounded-xl border-2 px-3 py-1.5 text-base font-bold transition-colors ${
                          p.pinned
                            ? 'border-accent bg-accent/15 text-accent shadow-glow-sm'
                            : 'border-edge bg-raised/60 text-ink-2 hover:border-accent/60 hover:text-ink'
                        }`}
                      >
                        <span aria-hidden="true">{p.pinned ? '★' : '☆'}</span>{' '}
                        {p.pinned ? 'Pinned' : 'Pin'}
                      </button>
                      <button
                        type="button"
                        data-testid={`ban-${p.player_id}`}
                        aria-label={`Hide ${p.name}`}
                        onClick={() => onEdit({ player_id: p.player_id, banned: true })}
                        className="whitespace-nowrap rounded-xl border-2 border-edge bg-raised/60 px-3 py-1.5 text-base font-bold text-ink-2 transition-colors hover:border-bad/60 hover:bg-bad/10 hover:text-ink"
                      >
                        <span aria-hidden="true">🚫</span> Hide
                      </button>
                      <ManualRankInput player={p} onEdit={onEdit} />
                    </span>
                  </td>
                </tr>
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
