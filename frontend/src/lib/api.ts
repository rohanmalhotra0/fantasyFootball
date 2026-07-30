// Typed API client. All calls go through apiFetch so errors surface uniformly.

import type {
  AgingCurvesResponse,
  BacktestYearResponse,
  ConsistencyResponse,
  TrendsResponse,
  DashboardResponse,
  DraftListItem,
  DraftReport,
  DraftState,
  MakePickRequest,
  ModelVersionOut,
  PlayerEditRequest,
  RankingsResponse,
  RecommendationsResponse,
  RefreshStatus,
  SettingsResponse,
  SimulationResponse,
  VoiceParseResponse,
  LeagueSettings,
} from './types'

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

/** True when built for a static host (GitHub Pages): GETs come from
 *  pre-exported JSON snapshots and every mutation is disabled. */
export const STATIC_MODE = import.meta.env.VITE_STATIC_API === '1'

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  if (STATIC_MODE) {
    const method = init?.method ?? 'GET'
    if (method !== 'GET') {
      throw new ApiError(
        503,
        'Read-only demo — clone the repo and run `make dev` for the live app',
      )
    }
    const base = import.meta.env.BASE_URL ?? '/'
    const resp = await fetch(`${base}api-static${path}.json`)
    if (!resp.ok) {
      throw new ApiError(resp.status, `No static snapshot for ${path}`)
    }
    return resp.json() as Promise<T>
  }
  const resp = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!resp.ok) {
    let detail = resp.statusText
    try {
      const body = await resp.json()
      detail = body.detail ?? detail
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(resp.status, typeof detail === 'string' ? detail : JSON.stringify(detail))
  }
  return resp.json() as Promise<T>
}

export const api = {
  dashboard: () => apiFetch<DashboardResponse>('/api/dashboard'),

  backtestYears: () => apiFetch<{ years: number[] }>('/api/backtest/years'),
  backtestYear: (year: number) => apiFetch<BacktestYearResponse>(`/api/backtest/${year}`),
  simulate: (year: number, slot: number) =>
    apiFetch<SimulationResponse>(`/api/backtest/${year}/simulate`, {
      method: 'POST',
      body: JSON.stringify({ slot }),
    }),

  rankings: () => apiFetch<RankingsResponse>('/api/rankings'),
  editPlayer: (edit: PlayerEditRequest) =>
    apiFetch<RankingsResponse>('/api/rankings/edits', {
      method: 'POST',
      body: JSON.stringify(edit),
    }),

  getSettings: () => apiFetch<SettingsResponse>('/api/settings'),
  putSettings: (settings: LeagueSettings) =>
    apiFetch<SettingsResponse>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    }),

  listDrafts: () => apiFetch<DraftListItem[]>('/api/drafts'),
  createDraft: () => apiFetch<DraftState>('/api/drafts', { method: 'POST' }),
  draftState: (id: number) => apiFetch<DraftState>(`/api/drafts/${id}`),
  makePick: (id: number, pick: MakePickRequest) =>
    apiFetch<DraftState>(`/api/drafts/${id}/picks`, {
      method: 'POST',
      body: JSON.stringify(pick),
    }),
  undoPick: (id: number) => apiFetch<DraftState>(`/api/drafts/${id}/undo`, { method: 'POST' }),
  editPick: (id: number, overall: number, body: MakePickRequest) =>
    apiFetch<DraftState>(`/api/drafts/${id}/picks/${overall}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  recommendations: (id: number) =>
    apiFetch<RecommendationsResponse>(`/api/drafts/${id}/recommendations`),
  outlooks: (id: number) => apiFetch<{ teams: import('./types').TeamOutlook[] }>(`/api/drafts/${id}/outlooks`),
  report: (id: number) => apiFetch<DraftReport>(`/api/drafts/${id}/report`),

  voiceParse: (id: number, utterance: string) =>
    apiFetch<VoiceParseResponse>(`/api/drafts/${id}/voice`, {
      method: 'POST',
      body: JSON.stringify({ utterance }),
    }),

  analysisAging: () => apiFetch<AgingCurvesResponse>('/api/analysis/aging'),
  analysisConsistency: (season: number) =>
    apiFetch<ConsistencyResponse>(`/api/analysis/consistency/${season}`),
  analysisTrends: () => apiFetch<TrendsResponse>('/api/analysis/trends'),

  adminModels: () => apiFetch<{ versions: ModelVersionOut[] }>('/api/admin/models'),
  activateModel: (version: string) =>
    apiFetch<{ versions: ModelVersionOut[] }>(`/api/admin/models/${version}/activate`, {
      method: 'POST',
    }),
  refreshStatus: () => apiFetch<RefreshStatus>('/api/admin/refresh/status'),
  startRefresh: () => apiFetch<RefreshStatus>('/api/admin/refresh', { method: 'POST' }),
}

export function draftWsUrl(id: number): string {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${window.location.host}/api/drafts/${id}/ws`
}
