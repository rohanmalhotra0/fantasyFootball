// Zustand store for the live draft room.
//
// The server is the source of truth: every mutation (pick / undo / edit)
// swaps in the full DraftState from the REST response, and the WS echo of
// the same state arrives moments later. applyState() dedupes those races
// by ignoring snapshots that are older than what we already have.

import { create } from 'zustand'
import { api } from './api'
import type {
  BoardPlayer,
  DraftState,
  MakePickRequest,
  RecommendationsResponse,
  TeamOutlook,
} from './types'
import type { ConnectionStatus } from './ws'

/** Snake order: 1-based overall pick number -> 1-based team index. */
export function overallToTeam(overall: number, teams: number): number {
  const round = Math.ceil(overall / teams)
  const posInRound = overall - (round - 1) * teams // 1..teams
  return round % 2 === 1 ? posInRound : teams - posInRound + 1
}

/** Snake order: round + column (team index) -> 1-based overall pick number. */
export function slotToOverall(round: number, teamIndex: number, teams: number): number {
  const posInRound = round % 2 === 1 ? teamIndex : teams - teamIndex + 1
  return (round - 1) * teams + posInRound
}

const REFETCH_DEBOUNCE_MS = 150

export interface DraftStore {
  state: DraftState | null
  recs: RecommendationsResponse | null
  outlooks: TeamOutlook[]
  connection: ConnectionStatus
  /** Remaining-player pool source; fetched once per room visit. */
  rankings: BoardPlayer[] | null
  /** Last mutation/server error — shown verbatim in the alert bar. */
  error: string | null

  /** Apply a server snapshot. Stale snapshots (same draft, fewer picks)
   *  are ignored unless force=true (used by undo, whose newer truth
   *  legitimately has fewer picks). */
  applyState: (next: DraftState, force?: boolean) => void
  setConnection: (connection: ConnectionStatus) => void
  loadRankings: () => Promise<void>
  /** Re-pull draft state over REST (used by voice commits + retry). */
  refresh: () => Promise<void>
  makePick: (req: MakePickRequest) => Promise<boolean>
  undoPick: () => Promise<boolean>
  editPick: (overall: number, playerId: string) => Promise<boolean>
  clearError: () => void
  reset: () => void
}

let refetchTimer: ReturnType<typeof setTimeout> | null = null
let rankingsPromise: Promise<void> | null = null

function clearRefetchTimer() {
  if (refetchTimer != null) {
    clearTimeout(refetchTimer)
    refetchTimer = null
  }
}

export const useDraftStore = create<DraftStore>((set, get) => {
  function scheduleDerivedRefetch() {
    const current = get().state
    if (!current || current.status !== 'active') return
    clearRefetchTimer()
    refetchTimer = setTimeout(() => {
      refetchTimer = null
      const snapshot = get().state
      if (!snapshot || snapshot.status !== 'active') return
      const id = snapshot.id
      void api
        .recommendations(id)
        .then((recs) => {
          if (get().state?.id === id) set({ recs })
        })
        .catch(() => {
          /* transient — next state change retries */
        })
      void api
        .outlooks(id)
        .then((resp) => {
          if (get().state?.id === id) set({ outlooks: resp.teams })
        })
        .catch(() => {
          /* transient — next state change retries */
        })
    }, REFETCH_DEBOUNCE_MS)
  }

  async function runMutation(fn: (id: number) => Promise<DraftState>): Promise<boolean> {
    const current = get().state
    if (!current) return false
    try {
      const next = await fn(current.id)
      get().applyState(next, true)
      set({ error: null })
      return true
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Request failed' })
      return false
    }
  }

  return {
    state: null,
    recs: null,
    outlooks: [],
    connection: 'connecting',
    rankings: null,
    error: null,

    applyState: (next, force = false) => {
      const current = get().state
      if (!force && current && current.id === next.id && next.picks.length < current.picks.length) {
        return // stale snapshot from a WS/REST race — ignore
      }
      set({ state: next })
      scheduleDerivedRefetch()
    },

    setConnection: (connection) => set({ connection }),

    loadRankings: async () => {
      if (get().rankings != null) return
      if (rankingsPromise == null) {
        rankingsPromise = api
          .rankings()
          .then((resp) => set({ rankings: resp.players }))
          .catch(() => {
            /* pool search degrades gracefully; retried on next call */
          })
          .finally(() => {
            rankingsPromise = null
          })
      }
      await rankingsPromise
    },

    refresh: async () => {
      const current = get().state
      if (!current) return
      try {
        const next = await api.draftState(current.id)
        get().applyState(next, true)
      } catch (err) {
        set({ error: err instanceof Error ? err.message : 'Could not refresh the draft' })
      }
    },

    makePick: (req) => runMutation((id) => api.makePick(id, { source: 'manual', ...req })),

    undoPick: () => runMutation((id) => api.undoPick(id)),

    editPick: (overall, playerId) =>
      runMutation((id) => api.editPick(id, overall, { player_id: playerId })),

    clearError: () => set({ error: null }),

    reset: () => {
      clearRefetchTimer()
      set({
        state: null,
        recs: null,
        outlooks: [],
        connection: 'connecting',
        rankings: null,
        error: null,
      })
    },
  }
})
