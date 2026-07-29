// Mirrors backend/draftengine/api/schemas.py 1:1 — change both together.

export interface ScoringSettings {
  pass_yd: number
  pass_td: number
  interception: number
  rush_yd: number
  rush_td: number
  reception: number
  rec_yd: number
  rec_td: number
  fumble_lost: number
  two_pt: number
  special_teams_td: number
}

export interface RosterSlots {
  qb: number
  rb: number
  wr: number
  te: number
  flex: number
  superflex: number
  k: number
  dst: number
  bench: number
}

export interface LeagueSettings {
  teams: number
  scoring_preset: 'ppr' | 'half' | 'standard' | 'custom'
  scoring: ScoringSettings
  roster: RosterSlots
  draft_type: 'snake' | 'auction'
  my_slot: number
  team_names: string[]
}

export interface BoardPlayer {
  player_id: string
  name: string
  position: string
  team: string | null
  projected_points: number | null
  vorp: number | null
  model_rank: number | null
  adp: number | null
  adp_rank: number | null
  value_gap: number | null
  tier: number | null
  risk_flag: boolean
  unmodeled: boolean
  pinned: boolean
  banned: boolean
  manual_rank: number | null
}

export interface RankingsResponse {
  players: BoardPlayer[]
  adp_available: boolean
  model_version: string | null
  season: number
}

export interface PlayerEditRequest {
  player_id: string
  pinned?: boolean
  banned?: boolean
  manual_rank?: number | null
  clear_manual_rank?: boolean
}

export interface SettingsResponse {
  settings: LeagueSettings
  replacement_counts: Record<string, number>
  rounds: number
}

export interface YearMetrics {
  season: number
  n_players: number
  spearman_model: number
  spearman_naive: number
  mae_model: number
  n_drafted: number | null
  spearman_model_drafted: number | null
  spearman_naive_drafted: number | null
  spearman_adp_drafted: number | null
  per_position: Record<
    string,
    { n: number; spearman_model: number; spearman_naive: number; mae_model: number }
  >
}

export interface Heatmap {
  rows: string[]
  cols: string[]
  values: (number | null)[][]
  note: string
}

export interface DashboardResponse {
  validation: YearMetrics[]
  last_refresh: Record<string, unknown> | null
  model_version: string | null
  settings_summary: string
  data_ready: boolean
  adp_available: boolean
  vorp_heatmap: Heatmap | null
  hit_rate_heatmap: Heatmap | null
}

export interface ScatterPoint {
  player_id: string
  name: string
  position: string
  rank: number
  actual_rank: number
  predicted: number | null
  actual: number
}

export interface HitBustRow {
  name: string
  position: string
  rank: number
  actual_rank: number
  predicted: number | null
  actual: number
  diff: number
}

export interface BacktestYearResponse {
  season: number
  metrics: YearMetrics
  model_scatter: ScatterPoint[]
  adp_scatter: ScatterPoint[] | null
  hits: HitBustRow[]
  busts: HitBustRow[]
  adp_available: boolean
}

export interface SimPick {
  overall: number
  round: number
  team_index: number
  name: string
  position: string
  points: number
  is_me: boolean
}

export interface SimulationResponse {
  season: number
  slot: number
  my_roster: SimPick[]
  my_total: number
  league_totals: number[]
  league_median: number
  opponent_strategy: string
  log: SimPick[]
}

export interface PickOut {
  overall: number
  round: number
  team_index: number
  player_id: string
  player_name: string
  position: string
  source: string
}

export interface DraftState {
  id: number
  status: 'active' | 'complete'
  teams: number
  rounds: number
  my_slot: number
  team_names: string[]
  settings: LeagueSettings
  current_overall: number | null
  on_clock_team: number | null
  current_round: number | null
  picks: PickOut[]
  total_picks: number
}

export interface DraftListItem {
  id: number
  created_at: string
  status: string
  teams: number
  rounds: number
  picks_made: number
}

export interface MakePickRequest {
  player_id?: string
  player_name?: string
  team_index?: number
  source?: string
}

export interface Recommendation {
  player_id: string
  name: string
  position: string
  team: string | null
  projected_points: number | null
  vorp: number | null
  adp: number | null
  survival_prob: number | null
  tier: number | null
  risk_flag: boolean
  reason: string
}

export interface RosterSlotFill {
  slot: string
  player_name: string | null
  position: string | null
}

export interface TeamOutlook {
  team_index: number
  name: string
  slots: RosterSlotFill[]
  projected_points: number
  needs: string[]
}

export interface RecommendationsResponse {
  on_clock_team: number | null
  my_turn: boolean
  picks_until_my_turn: number | null
  recommendations: Recommendation[]
  my_outlook: TeamOutlook | null
  adp_available: boolean
}

export interface DraftReportPickRow {
  overall: number
  round: number
  player_name: string
  position: string
  projected_points: number | null
  vorp: number | null
  adp_rank: number | null
  value_vs_adp: number | null
}

export interface DraftReport {
  draft_id: number
  grade: string
  grade_reason: string
  my_total_vorp: number
  league_avg_vorp: number
  my_projected_points: number
  picks: DraftReportPickRow[]
  position_strengths: Record<string, 'strong' | 'average' | 'weak'>
}

export interface SimulationRequest {
  slot: number
}

export interface EditPickRequest {
  player_id?: string
  player_name?: string
}

export interface VoiceParseRequest {
  utterance: string
}

export interface TeamOutlooksResponse {
  teams: TeamOutlook[]
}

export interface AdminModelsResponse {
  versions: ModelVersionOut[]
}

export interface VoiceCandidate {
  player_id: string
  name: string
  position: string
  confidence: number
}

export interface VoiceParseResponse {
  matched: boolean
  needs_confirmation: boolean
  team_index: number | null
  explicit_team: boolean
  best: VoiceCandidate | null
  alternatives: VoiceCandidate[]
  reason: string
}

export interface ModelVersionOut {
  version: string
  created_at: string
  note: string
  active: boolean
  metrics: YearMetrics[]
}

export interface RefreshStatus {
  running: boolean
  started_at: string | null
  finished_at: string | null
  error: string | null
  staged_version: string | null
  message: string | null
}
