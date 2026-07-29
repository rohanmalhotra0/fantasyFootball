"""Live draft recommendations + team outlooks.

Score = VORP + need + scarcity + urgency, with one short scannable
reason per player (the user has dyslexia/ADHD: one line, no walls of
text). Pinned players always surface first; banned players never do.
"""

import math

import pandas as pd
from sqlalchemy import select

from ..db import session_scope
from ..league import LeagueSettings, RosterSlots
from ..orm import PlayerEdit
from . import engine
from .engine import bool_or_false, float_or_none, int_or_none, str_or_none

FLEX_ELIGIBLE = ("RB", "WR", "TE")
SFLEX_ELIGIBLE = ("QB", "RB", "WR", "TE")

NEED_BONUS_STARTER = 25.0
NEED_BONUS_BENCH = 10.0
SCARCITY_BONUS = 15.0
SCARCITY_DROPOFF = 12.0
URGENCY_WEIGHT = 12.0
MAX_RECOMMENDATIONS = 10


# ---------- survival probability ----------


def _normal_cdf(z: float) -> float:
    return 0.5 * (1.0 + math.erf(z / math.sqrt(2.0)))


def survival_probability(
    adp: float | None,
    adp_stdev: float | None,
    model_rank: float | None,
    horizon_overall: int,
) -> float | None:
    """P(player is still available at overall pick `horizon_overall`)."""
    if adp is not None:
        stdev = adp_stdev or 0.0
    elif model_rank is not None:
        adp = float(model_rank)  # pseudo-ADP from model rank
        stdev = 0.15 * float(model_rank) + 3.0
    else:
        return None
    z = (horizon_overall - 0.5 - adp) / max(stdev, 3.0)
    p = 1.0 - _normal_cdf(z)
    return min(0.99, max(0.01, p))


# ---------- roster slot assignment ----------


def slot_sequence(roster: RosterSlots) -> list[str]:
    """Slot labels in roster order: QB, RB..., FLEX, SFLEX, K, DST, BN xN."""
    seq: list[str] = []
    for slot, count in (
        ("QB", roster.qb),
        ("RB", roster.rb),
        ("WR", roster.wr),
        ("TE", roster.te),
        ("FLEX", roster.flex),
        ("SFLEX", roster.superflex),
        ("K", roster.k),
        ("DST", roster.dst),
        ("BN", roster.bench),
    ):
        seq.extend([slot] * count)
    return seq


def assign_roster(settings: LeagueSettings, picks: list[dict]) -> list[dict]:
    """Greedy fill in draft order: pos slot, then FLEX, then SFLEX, then BN.

    Returns slot dicts with a `player_id` key for internal use (pydantic
    drops it when validating RosterSlotFill).
    """
    slots = [
        {"slot": s, "player_name": None, "position": None, "player_id": None}
        for s in slot_sequence(settings.roster)
    ]

    def first_empty(name: str) -> dict | None:
        return next(
            (s for s in slots if s["slot"] == name and s["player_name"] is None), None
        )

    for pick in sorted(picks, key=lambda p: p["overall"]):
        pos = pick["position"]
        target = first_empty(pos)
        if target is None and pos in FLEX_ELIGIBLE:
            target = first_empty("FLEX")
        if target is None and pos in SFLEX_ELIGIBLE:
            target = first_empty("SFLEX")
        if target is None:
            target = first_empty("BN")
        if target is None:
            continue  # roster overflow at this position: player is unrostered
        target["player_name"] = pick["player_name"]
        target["position"] = pos
        target["player_id"] = pick["player_id"]
    return slots


def open_starter_slot(slots: list[dict], pos: str) -> str | None:
    """Label of the empty starter slot `pos` would fill (RB2/FLEX/...), or None."""
    direct = [s for s in slots if s["slot"] == pos]
    for idx, s in enumerate(direct, start=1):
        if s["player_name"] is None:
            return f"{pos}{idx}" if len(direct) > 1 else pos
    if pos in FLEX_ELIGIBLE and any(
        s["slot"] == "FLEX" and s["player_name"] is None for s in slots
    ):
        return "FLEX"
    if pos in SFLEX_ELIGIBLE and any(
        s["slot"] == "SFLEX" and s["player_name"] is None for s in slots
    ):
        return "SFLEX"
    return None


def _bench_backups(slots: list[dict], pos: str) -> int:
    return sum(1 for s in slots if s["slot"] == "BN" and s["position"] == pos)


# ---------- needs / outlooks ----------


def _startable_remaining(remaining: pd.DataFrame, pos: str) -> int:
    """How many startable players at `pos` are left in the pool."""
    at_pos = remaining[remaining["position"] == pos]
    if at_pos.empty:
        return 0
    vorp = at_pos["vorp"]
    if vorp.notna().any():
        return int((vorp > 0).sum())
    return int(len(at_pos))


def compute_needs(slots: list[dict], remaining: pd.DataFrame) -> list[str]:
    """Empty starter slot types, scarcest position first.

    K/DST always sort last: nobody "needs" a kicker until the end, and by
    then they are the only empty slots left anyway.
    """
    empty_types: list[str] = []
    for s in slots:
        if s["slot"] != "BN" and s["player_name"] is None and s["slot"] not in empty_types:
            empty_types.append(s["slot"])

    def scarcity(slot_type: str) -> tuple[bool, int]:
        if slot_type == "FLEX":
            n = min(_startable_remaining(remaining, p) for p in FLEX_ELIGIBLE)
        elif slot_type == "SFLEX":
            n = min(_startable_remaining(remaining, p) for p in SFLEX_ELIGIBLE)
        else:
            n = _startable_remaining(remaining, slot_type)
        return (slot_type in ("K", "DST"), n)

    return sorted(empty_types, key=scarcity)  # stable: ties keep roster order


def _outlook_dict(
    team_index: int,
    settings: LeagueSettings,
    slots: list[dict],
    pool: pd.DataFrame,
    remaining: pd.DataFrame,
) -> dict:
    proj_by_id: dict[str, float] = {}
    for pid, pts in zip(pool["player_id"], pool["projected_points"], strict=True):
        v = float_or_none(pts)
        proj_by_id[str(pid)] = 0.0 if v is None else v
    projected = sum(
        proj_by_id.get(s["player_id"], 0.0)
        for s in slots
        if s["slot"] != "BN" and s["player_id"] is not None
    )
    return {
        "team_index": team_index,
        "name": settings.team_name(team_index),
        "slots": [
            {"slot": s["slot"], "player_name": s["player_name"], "position": s["position"]}
            for s in slots
        ],
        "projected_points": round(float(projected), 2),
        "needs": compute_needs(slots, remaining),
    }


def _player_edits() -> tuple[set[str], set[str]]:
    """(pinned_ids, banned_ids) from the board edits table."""
    with session_scope() as session:
        rows = session.scalars(select(PlayerEdit)).all()
    pinned = {r.player_id for r in rows if r.pinned}
    banned = {r.player_id for r in rows if r.banned}
    return pinned, banned


def team_outlooks(draft_id: int) -> dict:
    """TeamOutlook for every team — powers the opponent tracker."""
    ctx = engine.get_context(draft_id)
    settings = ctx.settings
    pool = engine.ensure_pool_columns(engine.get_player_pool(settings))
    _, banned = _player_edits()
    picked = {p["player_id"] for p in ctx.picks}
    remaining = pool[~pool["player_id"].isin(picked | banned)]
    outlooks = []
    for team in range(1, settings.teams + 1):
        team_picks = [p for p in ctx.picks if p["team_index"] == team]
        slots = assign_roster(settings, team_picks)
        outlooks.append(_outlook_dict(team, settings, slots, pool, remaining))
    return {"teams": outlooks}


# ---------- scarcity ----------


def _scarcity_bonus(remaining: pd.DataFrame, row) -> float:
    """15 when this is the last player of his tier at his position AND the
    dropoff to the best next-tier player exceeds 12 projected points."""
    tier = float_or_none(row.tier)
    proj = float_or_none(row.projected_points)
    if tier is None or proj is None:
        return 0.0
    at_pos = remaining[
        (remaining["position"] == row.position)
        & remaining["tier"].notna()
        & remaining["projected_points"].notna()
    ]
    same_tier_others = at_pos[(at_pos["tier"] == tier) & (at_pos["player_id"] != row.player_id)]
    if not same_tier_others.empty:
        return 0.0
    next_tier = at_pos[at_pos["tier"] > tier]
    if next_tier.empty:
        return 0.0
    dropoff = proj - float(next_tier["projected_points"].max())
    return SCARCITY_BONUS if dropoff > SCARCITY_DROPOFF else 0.0


# ---------- main entry ----------


def build_recommendations(draft_id: int) -> dict:
    """Shaped exactly like schemas.RecommendationsResponse."""
    ctx = engine.get_context(draft_id)
    settings = ctx.settings
    teams = settings.teams
    rounds = ctx.rounds
    total_picks = teams * rounds

    pool = engine.ensure_pool_columns(engine.get_player_pool(settings))
    pinned_ids, banned_ids = _player_edits()

    picks = ctx.picks
    picked_ids = {p["player_id"] for p in picks}
    remaining = pool[~pool["player_id"].isin(picked_ids | banned_ids)]

    my_slot = settings.my_slot
    my_picks = [p for p in picks if p["team_index"] == my_slot]
    slots = assign_roster(settings, my_picks)
    my_outlook = _outlook_dict(my_slot, settings, slots, pool, remaining)
    adp_available = bool(pool["adp"].notna().any())

    if len(picks) >= total_picks:  # draft complete: nothing to recommend
        return {
            "on_clock_team": None,
            "my_turn": False,
            "picks_until_my_turn": None,
            "recommendations": [],
            "my_outlook": my_outlook,
            "adp_available": adp_available,
        }

    current_overall = len(picks) + 1
    on_clock = engine.overall_to_team(current_overall, teams)

    my_next = engine.next_overall_for_team(current_overall - 1, my_slot, teams, rounds)
    if my_next is None:  # I have no picks left, draft still running
        my_turn = False
        picks_until = None
        horizon = total_picks + 1
    else:
        picks_until = my_next - current_overall
        my_turn = picks_until == 0
        horizon = my_next
        if my_turn:
            # Urgency is about my NEXT turn after this pick.
            horizon = (
                engine.next_overall_for_team(current_overall, my_slot, teams, rounds)
                or total_picks + 1
            )

    rounds_left_for_me = rounds - len(my_picks)
    open_kdst = sum(
        1 for s in slots if s["slot"] in ("K", "DST") and s["player_name"] is None
    )
    kdst_time = rounds_left_for_me <= open_kdst + 1

    recs: list[dict] = []
    for row in remaining.itertuples(index=False):
        pos = str(row.position)
        pinned = row.player_id in pinned_ids
        proj = float_or_none(row.projected_points)
        vorp = float_or_none(row.vorp)
        adp = float_or_none(row.adp)
        adp_stdev = float_or_none(row.adp_stdev)
        adp_rank = float_or_none(row.adp_rank)
        model_rank = float_or_none(row.model_rank)
        sp = survival_probability(adp, adp_stdev, model_rank, horizon)

        score = 0.0
        reason = "Best value left"

        if pos in ("K", "DST"):
            if not kdst_time and not pinned:
                continue  # too early to burn a pick on K/DST
            if proj is not None:
                score = vorp or 0.0
            elif adp_rank is not None:
                score = 5.0 + max(0.0, current_overall + teams - adp_rank)
            if kdst_time:
                reason = f"Time to grab a {pos}"
        elif proj is None:
            # Unmodeled ADP-only row (rookie / no prior-season data).
            in_window = adp_rank is not None and adp_rank <= current_overall + teams
            if not in_window and not pinned:
                continue
            if in_window:
                score = 5.0 + max(0.0, current_overall + teams - adp_rank)
            reason = "ADP value (no model history)"
        else:
            slot_label = open_starter_slot(slots, pos)
            if slot_label is not None:
                need = NEED_BONUS_STARTER
            elif pos in ("RB", "WR") and _bench_backups(slots, pos) < 2:
                need = NEED_BONUS_BENCH
            else:
                need = 0.0
            scarce = _scarcity_bonus(remaining, row)
            urgency = URGENCY_WEIGHT * (1.0 - sp) if sp is not None else 0.0
            score = (vorp or 0.0) + need + scarce + urgency
            if slot_label is not None:
                reason = f"Fills your {slot_label} hole"
            elif scarce > 0:
                reason = f"Last elite {pos} before the cliff"
            elif sp is not None and sp < 0.5:
                reason = "Likely gone before your next pick"
            else:
                reason = "Best value left"

        if pinned:
            reason = "Pinned by you"

        recs.append(
            {
                "player_id": str(row.player_id),
                "name": str(row.name),
                "position": pos,
                "team": str_or_none(row.team),
                "projected_points": proj,
                "vorp": vorp,
                "adp": adp,
                "survival_prob": None if sp is None else round(sp, 3),
                "tier": int_or_none(row.tier),
                "risk_flag": bool_or_false(row.risk_flag),
                "reason": reason,
                "_score": score,
                "_pinned": pinned,
            }
        )

    recs.sort(key=lambda r: (not r["_pinned"], -r["_score"]))
    top = recs[:MAX_RECOMMENDATIONS]

    # When it's K/DST time, guarantee one of each surfaces even if their
    # raw score is buried — the reminder IS the feature.
    if kdst_time:
        for pos in ("K", "DST"):
            if open_starter_slot(slots, pos) is None:
                continue
            if any(r["position"] == pos for r in top):
                continue
            candidate = max(
                (r for r in recs if r["position"] == pos),
                key=lambda r: r["_score"],
                default=None,
            )
            if candidate is not None:
                top.append(candidate)

    for r in top:
        r.pop("_score", None)
        r.pop("_pinned", None)

    return {
        "on_clock_team": on_clock,
        "my_turn": my_turn,
        "picks_until_my_turn": picks_until,
        "recommendations": top,
        "my_outlook": my_outlook,
        "adp_available": adp_available,
    }
