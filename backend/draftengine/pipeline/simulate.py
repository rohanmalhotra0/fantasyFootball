"""Historical draft replay: what would the model have drafted in year Y?

For a past season we re-train the model exactly as walk-forward validation
does (only on seasons before Y — no look-ahead), then replay a full snake
draft: "me" drafts by model VORP, opponents draft by that year's ADP (or by
naive last-season points when no ADP is cached). Every team is then scored
by the ACTUAL season points of its best legal starting lineup.

Everything here is deterministic: stable sorts with name tie-breaks, no RNG
beyond XGBoost's fixed random_state.
"""

import numpy as np
import pandas as pd

from ..data import ffc
from ..league import LeagueSettings, RosterSlots
from .dataset import load_features
from .model import validate_year
from .value import add_vorp

# No 2nd QB/TE before this round unless every other starter slot is filled.
ONESIE_ROUND_LIMIT = 10
# K/DST are only draftable in the last N rounds.
KDST_LAST_ROUNDS = 3
# RB/WR depth cap: dedicated starters + flex + this many bench bodies.
DEPTH_PAD = 3

_BASE_SLOT = {"QB": "qb", "RB": "rb", "WR": "wr", "TE": "te", "K": "k", "DST": "dst"}

NO_ADP_STRATEGY = "naive last-season points (no ADP cached)"


def simulate_draft(year: int, slot: int, settings: LeagueSettings) -> dict:
    """Replay a full draft for a past season; shaped like schemas.SimulationResponse."""
    teams = settings.teams
    rounds = settings.roster.total
    if not 1 <= slot <= teams:
        raise ValueError(f"slot must be between 1 and {teams}")

    features = load_features()
    if features is None or features.empty:
        raise ValueError("no data for year")
    try:
        # Holdout frame = that year's players with a trained-on-the-past
        # `predicted` column and the actual `ppr_points_target`.
        _, holdout = validate_year(features, year, adp=None)
    except ValueError as exc:
        raise ValueError("no data for year") from exc

    adp = ffc.load_adp(year)
    pool, strategy = _build_pool(holdout, adp, settings)

    me_order, opp_order = _draft_orders(pool, strategy)
    positions: list[str] = [str(p) for p in pool["position"].tolist()]
    names: list[str] = [str(n) for n in pool["name"].tolist()]
    actuals: list[float] = [float(a) for a in pool["actual"].tolist()]

    taken = [False] * len(pool)
    counts: list[dict[str, int]] = [{} for _ in range(teams + 1)]  # 1-based
    rosters: list[list[tuple[str, float]]] = [[] for _ in range(teams + 1)]
    log: list[dict] = []

    for overall in range(1, teams * rounds + 1):
        r = (overall - 1) // teams + 1
        i = (overall - 1) % teams
        team = i + 1 if r % 2 == 1 else teams - i  # snake, same as the draft engine
        is_me = team == slot

        forced_gaps = None
        if is_me:
            gaps = _starter_gaps(counts[team], settings.roster)
            empty = sum(gaps.values())
            if empty and rounds - r + 1 <= empty + 1:
                forced_gaps = gaps  # running out of picks: fill starters first

        idx = _pick_index(
            me_order if is_me else opp_order,
            positions,
            taken,
            counts[team],
            r,
            rounds,
            settings,
            forced_gaps,
        )
        if idx is None:  # player pool exhausted — rosters just end short
            break
        taken[idx] = True
        counts[team][positions[idx]] = counts[team].get(positions[idx], 0) + 1
        rosters[team].append((positions[idx], actuals[idx]))
        log.append(
            {
                "overall": overall,
                "round": r,
                "team_index": team,
                "name": names[idx],
                "position": positions[idx],
                "points": actuals[idx],
                "is_me": is_me,
            }
        )

    league_totals = [_lineup_total(rosters[t], settings.roster) for t in range(1, teams + 1)]
    return {
        "season": year,
        "slot": slot,
        "my_roster": [p for p in log if p["is_me"]],
        "my_total": league_totals[slot - 1],
        "league_totals": league_totals,
        "league_median": float(np.median(league_totals)) if league_totals else 0.0,
        "opponent_strategy": strategy,
        "log": log,
    }


# ---------- pool construction ----------


def _build_pool(
    holdout: pd.DataFrame, adp: pd.DataFrame | None, settings: LeagueSettings
) -> tuple[pd.DataFrame, str]:
    """Draftable pool: holdout players (+ unmatched ADP players) with VORP.

    Unmatched ADP players (rookies, K/DST — positions the model never sees)
    get predicted=NaN / actual=0 but CAN be drafted; that mirrors a real
    room where opponents happily take players my model knows nothing about.
    """
    pool = holdout[
        ["name", "norm_name", "position", "predicted", "ppr_points_target", "lag1_ppr_points"]
    ].copy()
    pool = pool.rename(columns={"ppr_points_target": "actual"})
    pool["actual"] = pool["actual"].fillna(0.0).astype(float)

    if adp is not None and not adp.empty:
        strategy = "adp"
        adp = adp.drop_duplicates(subset=["norm_name", "position"], keep="first")
        pool = pool.merge(
            adp[["norm_name", "position", "adp", "adp_rank"]],
            on=["norm_name", "position"],
            how="left",
        )
        known = pd.MultiIndex.from_frame(holdout[["norm_name", "position"]])
        adp_keys = pd.MultiIndex.from_frame(adp[["norm_name", "position"]])
        extra = adp[~adp_keys.isin(known)]
        extra_rows = pd.DataFrame(
            {
                "name": extra["name"].astype(str),
                "norm_name": extra["norm_name"],
                "position": extra["position"],
                "predicted": np.nan,
                "actual": 0.0,
                "lag1_ppr_points": np.nan,
                "adp": extra["adp"].astype(float),
                "adp_rank": extra["adp_rank"].astype(float),
            }
        )
        pool = pd.concat([pool, extra_rows], ignore_index=True)
    else:
        strategy = NO_ADP_STRATEGY
        pool["adp"] = np.nan
        pool["adp_rank"] = np.nan

    # My value board: VORP on the model's predicted points under the passed
    # league settings. NaN-predicted rows keep NaN vorp (sorted last for me).
    pool = add_vorp(pool, settings, points_col="predicted")
    return pool.reset_index(drop=True), strategy


def _draft_orders(pool: pd.DataFrame, strategy: str) -> tuple[list[int], list[int]]:
    """(my order, opponents' order) as lists of pool row positions."""
    me = pool.sort_values(
        ["vorp", "adp", "name"], ascending=[False, True, True], na_position="last"
    ).index.tolist()
    if strategy == "adp":
        opp = pool.sort_values(
            ["adp", "lag1_ppr_points", "name"],
            ascending=[True, False, True],
            na_position="last",
        ).index.tolist()
    else:
        opp = pool.sort_values(
            ["lag1_ppr_points", "name"], ascending=[False, True], na_position="last"
        ).index.tolist()
    return me, opp


# ---------- roster-need rules ----------


def _fillable(pos: str) -> set[str]:
    """Starter slot categories a position can occupy."""
    if pos == "QB":
        return {"QB", "SFLEX"}
    if pos in ("RB", "WR"):
        return {pos, "FLEX", "SFLEX"}
    if pos == "TE":
        return {"TE", "FLEX", "SFLEX"}
    return {pos}  # K / DST


def _starter_gaps(counts: dict[str, int], roster: RosterSlots) -> dict[str, int]:
    """Unfilled starter slots by category, greedy allocation."""
    base = {pos: getattr(roster, field) for pos, field in _BASE_SLOT.items()}
    gaps = {pos: max(0, need - counts.get(pos, 0)) for pos, need in base.items()}
    flex_supply = sum(max(0, counts.get(p, 0) - base[p]) for p in ("RB", "WR", "TE"))
    flex_used = min(roster.flex, flex_supply)
    gaps["FLEX"] = roster.flex - flex_used
    sflex_supply = max(0, counts.get("QB", 0) - base["QB"]) + (flex_supply - flex_used)
    gaps["SFLEX"] = max(0, roster.superflex - sflex_supply)
    return gaps


def _fills_gap(pos: str, gaps: dict[str, int]) -> bool:
    return any(gaps.get(slot, 0) > 0 for slot in _fillable(pos))


def _allowed(
    pos: str,
    counts: dict[str, int],
    round_num: int,
    rounds: int,
    settings: LeagueSettings,
) -> bool:
    """Roster-need constraints shared by me and opponents."""
    roster = settings.roster
    if pos not in _BASE_SLOT:
        return False  # unknown position label: never draftable
    base = getattr(roster, _BASE_SLOT[pos])
    have = counts.get(pos, 0)
    if pos in ("K", "DST"):
        # Only in the last rounds, and never more than the starter slots.
        return round_num > rounds - KDST_LAST_ROUNDS and have < base
    if pos in ("RB", "WR"):
        return have < base + roster.flex + DEPTH_PAD
    # QB / TE: no extra one before round 10 unless every other starter slot
    # (including K/DST) is already filled.
    cap = max(1, base + (roster.superflex if pos == "QB" else 0))
    if have >= cap and round_num < ONESIE_ROUND_LIMIT:
        gaps = _starter_gaps(counts, roster)
        fillable = _fillable(pos)
        return all(g == 0 for slot, g in gaps.items() if slot not in fillable)
    return True


def _pick_index(
    order: list[int],
    positions: list[str],
    taken: list[bool],
    counts: dict[str, int],
    round_num: int,
    rounds: int,
    settings: LeagueSettings,
    forced_gaps: dict[str, int] | None,
) -> int | None:
    """First player in `order` that passes the constraints.

    When forced_gaps is set (me, low on picks) prefer players that fill an
    empty starter slot; fall back to the best legal player, then — if the
    caps left nothing at all — to the best remaining player, so a draft
    never stalls while the pool still has bodies.
    """
    fallback = None
    for idx in order:
        if taken[idx]:
            continue
        pos = positions[idx]
        if not _allowed(pos, counts, round_num, rounds, settings):
            continue
        if fallback is None:
            fallback = idx
        if forced_gaps is None or _fills_gap(pos, forced_gaps):
            return idx
    if fallback is not None:
        return fallback
    for idx in order:
        if not taken[idx]:
            return idx
    return None


# ---------- outcome scoring ----------


def _lineup_total(players: list[tuple[str, float]], roster: RosterSlots) -> float:
    """Actual points of the best legal starting lineup (greedy fill)."""
    by_pos: dict[str, list[float]] = {}
    for pos, pts in players:
        by_pos.setdefault(pos, []).append(pts)
    for lst in by_pos.values():
        lst.sort(reverse=True)

    total = 0.0

    def take(pos: str, n: int) -> None:
        nonlocal total
        lst = by_pos.get(pos, [])
        for _ in range(min(n, len(lst))):
            total += lst.pop(0)

    def take_flex(eligible: tuple[str, ...], n: int) -> None:
        nonlocal total
        for _ in range(n):
            best = None
            for p in eligible:
                lst = by_pos.get(p)
                if lst and (best is None or lst[0] > by_pos[best][0]):
                    best = p
            if best is None:
                return
            total += by_pos[best].pop(0)

    take("QB", roster.qb)
    take("RB", roster.rb)
    take("WR", roster.wr)
    take("TE", roster.te)
    take_flex(("RB", "WR", "TE"), roster.flex)
    take_flex(("QB", "RB", "WR", "TE"), roster.superflex)
    take("K", roster.k)
    take("DST", roster.dst)
    return total
