"""API response/request contracts. The frontend types mirror this file 1:1
(frontend/src/lib/types.ts) — change both together."""

from pydantic import BaseModel

from ..league import LeagueSettings

# ---------- rankings / board ----------


class BoardPlayer(BaseModel):
    player_id: str
    name: str
    position: str
    team: str | None = None
    projected_points: float | None = None
    vorp: float | None = None
    model_rank: int | None = None
    adp: float | None = None
    adp_rank: int | None = None
    value_gap: int | None = None
    tier: int | None = None
    risk_flag: bool = False
    unmodeled: bool = False  # rookie or no prior-season data: ADP-only row
    pinned: bool = False
    banned: bool = False
    manual_rank: int | None = None


class RankingsResponse(BaseModel):
    players: list[BoardPlayer]
    adp_available: bool
    model_version: str | None
    season: int


class PlayerEditRequest(BaseModel):
    player_id: str
    pinned: bool | None = None
    banned: bool | None = None
    manual_rank: int | None = None
    clear_manual_rank: bool = False


# ---------- settings ----------


class SettingsResponse(BaseModel):
    settings: LeagueSettings
    replacement_counts: dict[str, int]
    rounds: int


# ---------- dashboard / validation ----------


class YearMetrics(BaseModel):
    season: int
    n_players: int
    spearman_model: float
    spearman_naive: float
    mae_model: float
    n_drafted: int | None = None
    spearman_model_drafted: float | None = None
    spearman_naive_drafted: float | None = None
    spearman_adp_drafted: float | None = None
    per_position: dict


class Heatmap(BaseModel):
    rows: list[str]  # e.g. round labels
    cols: list[str]  # positions
    values: list[list[float | None]]
    note: str


class DashboardResponse(BaseModel):
    validation: list[YearMetrics]
    last_refresh: dict | None
    model_version: str | None
    settings_summary: str
    data_ready: bool
    adp_available: bool
    vorp_heatmap: Heatmap | None
    hit_rate_heatmap: Heatmap | None


# ---------- backtest ----------


class ScatterPoint(BaseModel):
    player_id: str
    name: str
    position: str
    rank: int  # model rank or adp rank depending on the series
    actual_rank: int
    predicted: float | None = None
    actual: float


class HitBustRow(BaseModel):
    name: str
    position: str
    rank: int
    actual_rank: int
    predicted: float | None = None
    actual: float
    diff: int  # actual_rank - rank; negative = outperformed


class BacktestYearResponse(BaseModel):
    season: int
    metrics: YearMetrics
    model_scatter: list[ScatterPoint]
    adp_scatter: list[ScatterPoint] | None
    hits: list[HitBustRow]
    busts: list[HitBustRow]
    adp_available: bool


class SimulationRequest(BaseModel):
    slot: int = 5


class SimPick(BaseModel):
    overall: int
    round: int
    team_index: int
    name: str
    position: str
    points: float
    is_me: bool


class SimulationResponse(BaseModel):
    season: int
    slot: int
    my_roster: list[SimPick]
    my_total: float
    league_totals: list[float]  # index = team_index - 1
    league_median: float
    opponent_strategy: str  # "adp" or "naive (no ADP cached)"
    log: list[SimPick]


# ---------- draft room ----------


class PickOut(BaseModel):
    overall: int
    round: int
    team_index: int
    player_id: str
    player_name: str
    position: str
    source: str


class DraftState(BaseModel):
    id: int
    status: str
    teams: int
    rounds: int
    my_slot: int
    team_names: list[str]
    settings: LeagueSettings
    current_overall: int | None  # None when draft is complete
    on_clock_team: int | None
    current_round: int | None
    picks: list[PickOut]
    total_picks: int


class CreateDraftResponse(BaseModel):
    draft: DraftState


class DraftListItem(BaseModel):
    id: int
    created_at: str
    status: str
    teams: int
    rounds: int
    picks_made: int


class MakePickRequest(BaseModel):
    player_id: str | None = None
    player_name: str | None = None  # resolved against the board if no id
    team_index: int | None = None  # default: team on the clock
    source: str = "manual"


class EditPickRequest(BaseModel):
    player_id: str | None = None
    player_name: str | None = None


class Recommendation(BaseModel):
    player_id: str
    name: str
    position: str
    team: str | None
    projected_points: float | None
    vorp: float | None
    adp: float | None
    survival_prob: float | None  # P(available at your next pick)
    tier: int | None
    risk_flag: bool
    reason: str  # one line, scannable


class RosterSlotFill(BaseModel):
    slot: str  # QB / RB / WR / TE / FLEX / SFLEX / K / DST / BN
    player_name: str | None
    position: str | None


class TeamOutlook(BaseModel):
    team_index: int
    name: str
    slots: list[RosterSlotFill]
    projected_points: float
    needs: list[str]  # positions still needed, most urgent first


class RecommendationsResponse(BaseModel):
    on_clock_team: int | None
    my_turn: bool
    picks_until_my_turn: int | None
    recommendations: list[Recommendation]
    my_outlook: TeamOutlook | None
    adp_available: bool


class OpponentPrediction(BaseModel):
    team_index: int
    name: str
    likely_positions: list[str]
    likely_players: list[str]


class DraftReportPickRow(BaseModel):
    overall: int
    round: int
    player_name: str
    position: str
    projected_points: float | None
    vorp: float | None
    adp_rank: int | None
    value_vs_adp: int | None  # adp_rank - overall; positive = value


class DraftReport(BaseModel):
    draft_id: int
    grade: str  # A+ ... F
    grade_reason: str
    my_total_vorp: float
    league_avg_vorp: float
    my_projected_points: float
    picks: list[DraftReportPickRow]
    position_strengths: dict[str, str]  # pos -> "strong" | "average" | "weak"


# ---------- voice ----------


class VoiceParseRequest(BaseModel):
    utterance: str


class VoiceCandidate(BaseModel):
    player_id: str
    name: str
    position: str
    confidence: float  # 0..1


class VoiceParseResponse(BaseModel):
    matched: bool
    needs_confirmation: bool
    team_index: int | None  # team the pick would be logged to
    explicit_team: bool  # utterance named the team
    best: VoiceCandidate | None
    alternatives: list[VoiceCandidate]
    reason: str  # why matched / not matched, for the toast


# ---------- admin ----------


class ModelVersionOut(BaseModel):
    version: str
    created_at: str
    note: str
    active: bool
    metrics: list[YearMetrics]


class AdminModelsResponse(BaseModel):
    versions: list[ModelVersionOut]


class RefreshStatus(BaseModel):
    running: bool
    started_at: str | None = None
    finished_at: str | None = None
    error: str | None = None
    staged_version: str | None = None
    message: str | None = None
