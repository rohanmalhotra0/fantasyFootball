// Right-side player drawer for the Big Board. Opens from a row click,
// traps focus (aria-modal dialog), closes on Esc / backdrop / ✕, and shows
// the player's board numbers, a single-hue career PPG line, and a
// season-by-season mini table. Career data comes from
// /api/players/:id/career; until that endpoint is live (404/503) the chart
// area degrades to a friendly "warming up" note.

import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { api, ApiError } from '../../lib/api'
import type { BoardPlayer, PlayerCareerResponse } from '../../lib/types'
import PositionChip from './PositionChip'
import TierBadge from './TierBadge'

// Theme tokens (styles/index.css) — strings resolve per-theme at paint time.
const ACCENT = 'rgb(var(--de-accent))'
const EDGE = 'rgb(var(--de-edge))'
const INK_3 = 'rgb(var(--de-ink-3))'

interface PlayerDrawerProps {
  player: BoardPlayer
  onClose: () => void
}

type CareerState =
  | { kind: 'loading' }
  | { kind: 'ready'; data: PlayerCareerResponse }
  | { kind: 'warming' }
  | { kind: 'error'; message: string }

function fmt1(n: number | null): string {
  return n == null ? '—' : n.toFixed(1)
}

function StatTile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-edge/60 bg-raised/40 p-4">
      <p className="text-base font-bold uppercase tracking-wide text-ink-3">{label}</p>
      <p className="font-display text-2xl font-bold tabular-nums tracking-tight">{children}</p>
    </div>
  )
}

interface SeasonPoint {
  season: number
  games: number
  ppr_points: number
  ppg: number
  receptions: number
  targets: number
  carries: number
}

function CareerTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: { payload: SeasonPoint }[]
}) {
  if (!active || !payload || payload.length === 0) return null
  const s = payload[0].payload
  return (
    <div className="rounded-xl border border-edge bg-surface p-3 text-ink shadow-card">
      <p className="font-bold">{s.season}</p>
      <p className="font-display font-bold tabular-nums">{s.ppg.toFixed(1)} PPG</p>
      <p className="text-ink-2">
        {s.ppr_points.toFixed(1)} pts in {s.games} games
      </p>
    </div>
  )
}

function careerSummary(data: PlayerCareerResponse): string {
  const seasons = data.seasons
  if (seasons.length === 0) return 'No recorded fantasy seasons yet.'
  const best = seasons.reduce((a, b) => (b.ppg > a.ppg ? b : a))
  const latest = seasons[seasons.length - 1]
  return `${seasons.length} season${seasons.length === 1 ? '' : 's'} on record — best year ${
    best.season
  } at ${best.ppg.toFixed(1)} PPG, most recent ${latest.season} at ${latest.ppg.toFixed(1)} PPG.`
}

function CareerSection({ player }: { player: BoardPlayer }) {
  const [state, setState] = useState<CareerState>({ kind: 'loading' })

  useEffect(() => {
    let alive = true
    setState({ kind: 'loading' })
    api
      .playerCareer(player.player_id)
      .then((data) => {
        if (alive) setState({ kind: 'ready', data })
      })
      .catch((err: unknown) => {
        if (!alive) return
        if (err instanceof ApiError && (err.status === 404 || err.status === 503)) {
          setState({ kind: 'warming' })
        } else {
          setState({
            kind: 'error',
            message: err instanceof Error ? err.message : 'Could not load career data',
          })
        }
      })
    return () => {
      alive = false
    }
  }, [player.player_id])

  if (state.kind === 'loading') {
    return (
      <div role="status" aria-label="Loading career data" className="space-y-3">
        <div className="skeleton h-48 w-full" />
        <div className="skeleton h-6 w-2/3" />
      </div>
    )
  }

  if (state.kind === 'warming') {
    return (
      <p role="note" className="rounded-xl border border-edge bg-raised/40 p-4 text-ink-2">
        <span aria-hidden="true">⏳</span> Career data is warming up — check back after the next
        data refresh.
      </p>
    )
  }

  if (state.kind === 'error') {
    return (
      <p role="note" className="rounded-xl border border-warn/50 bg-warn/10 p-4 font-bold text-warn">
        <span aria-hidden="true">⚠️</span> Career data unavailable: {state.message}
      </p>
    )
  }

  const seasons = state.data.seasons
  if (seasons.length === 0) {
    return (
      <p role="note" className="rounded-xl border border-edge bg-raised/40 p-4 text-ink-2">
        <span aria-hidden="true">📭</span> No recorded fantasy seasons yet.
      </p>
    )
  }

  const showTouches = seasons.some((s) => s.carries > 0)
  const showTargets = seasons.some((s) => s.targets > 0)

  return (
    <div className="space-y-5">
      <section aria-label="Career points per game by season" className="space-y-3">
        <h3 className="section-title text-lg">PPG by season</h3>
        <div className="rounded-xl border border-edge/50 bg-bg/40 p-2">
          <div className="h-52 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={seasons} margin={{ top: 12, right: 18, bottom: 4, left: -8 }}>
                <CartesianGrid stroke={EDGE} strokeOpacity={0.5} vertical={false} />
                <XAxis
                  dataKey="season"
                  tick={{ fill: INK_3, fontSize: 14 }}
                  tickLine={{ stroke: EDGE }}
                  axisLine={{ stroke: EDGE }}
                />
                <YAxis
                  tick={{ fill: INK_3, fontSize: 14 }}
                  tickLine={{ stroke: EDGE }}
                  axisLine={{ stroke: EDGE }}
                  width={44}
                />
                <Tooltip
                  content={<CareerTooltip />}
                  cursor={{ stroke: INK_3, strokeDasharray: '4 4' }}
                />
                {/* Single series, single accent hue — no legend needed; the
                    heading names it. */}
                <Line
                  type="monotone"
                  dataKey="ppg"
                  name="PPG"
                  stroke={ACCENT}
                  strokeWidth={2}
                  dot={{ r: 4, fill: ACCENT, stroke: 'rgb(var(--de-surface))', strokeWidth: 2 }}
                  activeDot={{ r: 6 }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        <p className="text-ink-2">{careerSummary(state.data)}</p>
      </section>

      <section aria-label="Season by season stats" className="space-y-3">
        <h3 className="section-title text-lg">Season by season</h3>
        <div className="table-shell overflow-x-auto rounded-xl border border-edge/60 bg-surface/60">
          <table className="w-full text-base">
            <caption className="sr-only">Season-by-season career stats</caption>
            <thead>
              <tr className="text-left">
                <th scope="col" className="pl-4">
                  Season
                </th>
                <th scope="col" className="text-right">
                  G
                </th>
                <th scope="col" className="text-right">
                  PPR pts
                </th>
                <th scope="col" className="text-right">
                  PPG
                </th>
                {showTargets && (
                  <th scope="col" className="text-right">
                    Tgt
                  </th>
                )}
                {showTargets && (
                  <th scope="col" className="text-right">
                    Rec
                  </th>
                )}
                {showTouches && (
                  <th scope="col" className="pr-4 text-right">
                    Carries
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {seasons.map((s) => (
                <tr key={s.season}>
                  <td className="pl-4 font-display font-bold tabular-nums">{s.season}</td>
                  <td className="text-right tabular-nums text-ink-2">{s.games}</td>
                  <td className="text-right tabular-nums text-ink-2">{s.ppr_points.toFixed(1)}</td>
                  <td className="text-right font-bold tabular-nums">{s.ppg.toFixed(1)}</td>
                  {showTargets && (
                    <td className="text-right tabular-nums text-ink-2">{s.targets}</td>
                  )}
                  {showTargets && (
                    <td className="text-right tabular-nums text-ink-2">{s.receptions}</td>
                  )}
                  {showTouches && (
                    <td className="pr-4 text-right tabular-nums text-ink-2">{s.carries}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export default function PlayerDrawer({ player, onClose }: PlayerDrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  // Focus management: remember the opener, focus the close button, restore
  // on unmount. Body scroll locks while the drawer is up.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevOverflow
      opener?.focus?.()
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      // Focus trap: Tab cycles inside the panel.
      const panel = panelRef.current
      if (!panel) return
      const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      )
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = document.activeElement as HTMLElement | null
      if (e.shiftKey) {
        if (active === first || !panel.contains(active)) {
          e.preventDefault()
          last.focus()
        }
      } else if (active === last || !panel.contains(active)) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [onClose])

  const gap = player.value_gap

  return (
    <div data-testid="drawer-root" className="fixed inset-0 z-50">
      {/* Local slide-in; the global reduced-motion rule flattens it. */}
      <style>{`@keyframes de-drawer-in { from { opacity: 0; transform: translateX(32px); } to { opacity: 1; transform: translateX(0); } }`}</style>
      <div
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 bg-bg/70 backdrop-blur-sm"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="player-drawer-title"
        className="absolute inset-y-0 right-0 flex w-full max-w-xl flex-col overflow-y-auto border-l border-edge/70 bg-surface shadow-card"
        style={{ animation: 'de-drawer-in 0.25s ease-out both' }}
      >
        <header className="sticky top-0 z-10 border-b border-edge/60 bg-surface/95 px-6 py-4 backdrop-blur-sm">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 space-y-2">
              <h2
                id="player-drawer-title"
                className="truncate font-display text-2xl font-bold tracking-tight"
              >
                {player.name}
              </h2>
              <div className="flex flex-wrap items-center gap-2">
                <PositionChip position={player.position} team={player.team} />
                <TierBadge tier={player.tier} />
                {player.pinned && (
                  <span className="chip border border-accent/60 bg-accent/15 text-accent">
                    <span aria-hidden="true">★</span> Pinned
                  </span>
                )}
                {player.risk_flag && (
                  <span className="chip border border-warn/50 bg-warn/10 text-warn">
                    <span aria-hidden="true">⚠️</span> thin sample
                  </span>
                )}
                {player.unmodeled && (
                  <span className="chip border border-edge bg-raised/60 text-ink-2">
                    <span aria-hidden="true">🧾</span> ADP only
                  </span>
                )}
              </div>
            </div>
            <button
              type="button"
              ref={closeRef}
              data-testid="drawer-close"
              onClick={onClose}
              aria-label={`Close details for ${player.name}`}
              className="btn-secondary shrink-0 px-3 py-2 text-base"
            >
              <span aria-hidden="true">✕</span> Close
            </button>
          </div>
        </header>

        <div className="space-y-6 px-6 py-6">
          <section aria-label="Board numbers" className="space-y-3">
            <h3 className="section-title text-lg">On the board</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile label="Proj">{fmt1(player.projected_points)}</StatTile>
              <StatTile label="VORP">{fmt1(player.vorp)}</StatTile>
              <StatTile label="ADP">{fmt1(player.adp)}</StatTile>
              <StatTile label="Gap">
                {gap == null ? (
                  '—'
                ) : gap > 0 ? (
                  <span className="text-good">
                    <span aria-hidden="true">↑</span>+{gap}
                  </span>
                ) : gap < 0 ? (
                  <span className="text-bad">
                    <span aria-hidden="true">↓</span>
                    {gap}
                  </span>
                ) : (
                  '0'
                )}
              </StatTile>
            </div>
          </section>

          <CareerSection player={player} />
        </div>
      </div>
    </div>
  )
}
