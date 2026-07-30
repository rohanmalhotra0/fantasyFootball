"""Post-draft grading: my haul vs the league average, letter grade + why.

Grade = my total VORP minus the league-average team VORP, banded into
letters. The reason sentence cites concrete picks so the grade never
feels like a black box.
"""

from . import engine, recommend
from .engine import float_or_none, int_or_none

GRADE_BANDS: list[tuple[float, str]] = [
    (60.0, "A+"),
    (40.0, "A"),
    (20.0, "B"),
    (-10.0, "C"),
    (-30.0, "D"),
]

POSITION_ORDER = ("QB", "RB", "WR", "TE", "K", "DST")


def letter_grade(diff: float) -> str:
    """diff = my_total_vorp - league_avg_vorp -> letter."""
    for threshold, letter in GRADE_BANDS:
        if diff >= threshold:
            return letter
    return "F"


def _cite(row: dict) -> str:
    return f"{row['player_name']} ({row['value_vs_adp']:+d} vs ADP)"


def _grade_reason(rows: list[dict], diff: float) -> str:
    if not rows:
        return "No picks logged for your team."
    valued = [r for r in rows if r["value_vs_adp"] is not None]
    if valued:
        best = sorted(valued, key=lambda r: r["value_vs_adp"], reverse=True)[:2]
        worst = sorted(valued, key=lambda r: r["value_vs_adp"])[:2]
        if diff >= 20:  # B or better: celebrate the steals
            return f"Strong value picks: {' and '.join(_cite(r) for r in best)}."
        if diff < -10:  # D/F: name the reaches
            return f"Biggest reaches: {' and '.join(_cite(r) for r in worst)}."
        return f"Best value: {_cite(best[0])}; biggest reach: {_cite(worst[0])}."
    top = sorted(rows, key=lambda r: r["vorp"] or 0.0, reverse=True)[:2]
    return f"Top projected picks: {' and '.join(r['player_name'] for r in top)}."


def build_report(draft_id: int) -> dict:
    """Shaped exactly like schemas.DraftReport."""
    ctx = engine.get_context(draft_id)
    settings = ctx.settings
    teams = settings.teams
    my_slot = settings.my_slot

    pool = engine.ensure_pool_columns(engine.get_player_pool(settings))
    board = pool.drop_duplicates("player_id").set_index("player_id")

    def board_value(pid: str, col: str):
        if pid in board.index:
            return board.at[pid, col]
        return None

    team_vorp = {t: 0.0 for t in range(1, teams + 1)}
    my_rows: list[dict] = []
    for p in ctx.picks:
        vorp = float_or_none(board_value(p["player_id"], "vorp"))
        team_vorp[p["team_index"]] += vorp or 0.0
        if p["team_index"] == my_slot:
            adp_rank = int_or_none(board_value(p["player_id"], "adp_rank"))
            my_rows.append(
                {
                    "overall": p["overall"],
                    "round": p["round"],
                    "player_name": p["player_name"],
                    "position": p["position"],
                    "projected_points": float_or_none(
                        board_value(p["player_id"], "projected_points")
                    ),
                    "vorp": vorp,
                    "adp_rank": adp_rank,
                    "value_vs_adp": (adp_rank - p["overall"]) if adp_rank is not None else None,
                }
            )

    my_total = team_vorp[my_slot]
    league_avg = sum(team_vorp.values()) / teams
    diff = my_total - league_avg

    # Starters-only projected sums per position, per team.
    proj_by_id = {
        str(pid): (float_or_none(v) or 0.0)
        for pid, v in zip(pool["player_id"], pool["projected_points"], strict=True)
    }
    pos_sums: dict[int, dict[str, float]] = {}
    my_projected = 0.0
    for t in range(1, teams + 1):
        team_picks = [p for p in ctx.picks if p["team_index"] == t]
        slots = recommend.assign_roster(settings, team_picks)
        sums: dict[str, float] = {}
        for s in slots:
            if s["slot"] == "BN" or s["player_id"] is None:
                continue
            sums[s["position"]] = sums.get(s["position"], 0.0) + proj_by_id.get(
                s["player_id"], 0.0
            )
        pos_sums[t] = sums
        if t == my_slot:
            my_projected = sum(sums.values())

    strengths: dict[str, str] = {}
    for pos in POSITION_ORDER:
        if not any(pos in sums for sums in pos_sums.values()):
            continue
        league_mean = sum(sums.get(pos, 0.0) for sums in pos_sums.values()) / teams
        mine = pos_sums[my_slot].get(pos, 0.0)
        if league_mean <= 0:
            strengths[pos] = "strong" if mine > 0 else "average"
        elif mine > league_mean * 1.10:
            strengths[pos] = "strong"
        elif mine < league_mean * 0.90:
            strengths[pos] = "weak"
        else:
            strengths[pos] = "average"

    return {
        "draft_id": ctx.id,
        "grade": letter_grade(diff),
        "grade_reason": _grade_reason(my_rows, diff),
        "my_total_vorp": round(my_total, 2),
        "league_avg_vorp": round(league_avg, 2),
        "my_projected_points": round(my_projected, 2),
        "picks": my_rows,
        "position_strengths": strengths,
    }
