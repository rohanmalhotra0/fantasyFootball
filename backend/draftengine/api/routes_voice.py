"""POST /api/drafts/{id}/voice — parse an utterance, match a player.

This endpoint NEVER writes a pick. It returns graded candidates and the
UI commits through the normal picks endpoint after confirmation.

Confidence policy (prime directive: no confident wrong answer silently):
  best >= 0.92 and lead >= 0.08  -> matched, needs_confirmation (UI may show
                                    a 5s auto-commit toast)
  0.60 <= best < 0.92 or close   -> matched, needs_confirmation with up to 3
                                    alternatives (UI requires an explicit tap)
  best < 0.60                    -> not matched, ask for the full name
"""

from __future__ import annotations

import inspect

from fastapi import APIRouter, HTTPException

from ..voice.matching import match_player
from ..voice.parser import parse_utterance
from .schemas import VoiceCandidate, VoiceParseRequest, VoiceParseResponse

router = APIRouter(prefix="/api")

AUTO_COMMIT_CONFIDENCE = 0.92
AUTO_COMMIT_LEAD = 0.08
MATCH_FLOOR = 0.60
ALTERNATIVE_FLOOR = 0.45
NO_MATCH_REASON = "No confident match — try the full name"


def _engine():
    """Lazy import: the draft engine module is owned by another workstream."""
    try:
        from ..draft import engine
    except ImportError as exc:  # pragma: no cover - only before engine lands
        raise HTTPException(status_code=503, detail="Draft engine not available") from exc
    return engine


def _get_state(draft_id: int):
    engine = _engine()
    try:
        return engine.get_state(draft_id)
    except HTTPException:
        raise
    except (KeyError, LookupError, ValueError) as exc:
        raise HTTPException(status_code=404, detail=f"Draft {draft_id} not found") from exc


def _get_player_pool(draft_id: int):
    engine = _engine()
    fn = engine.get_player_pool
    try:
        params = [
            p
            for p in inspect.signature(fn).parameters.values()
            if p.kind in (p.POSITIONAL_ONLY, p.POSITIONAL_OR_KEYWORD) and p.default is p.empty
        ]
    except (TypeError, ValueError):  # pragma: no cover - exotic callables
        params = []
    return fn(draft_id) if params else fn()


def _no_match(team_index, explicit_team, reason: str) -> VoiceParseResponse:
    return VoiceParseResponse(
        matched=False,
        needs_confirmation=False,
        team_index=team_index,
        explicit_team=explicit_team,
        best=None,
        alternatives=[],
        reason=reason,
    )


@router.post("/drafts/{draft_id}/voice", response_model=VoiceParseResponse)
def parse_voice(draft_id: int, req: VoiceParseRequest) -> VoiceParseResponse:
    state = _get_state(draft_id)
    pool = _get_player_pool(draft_id)

    parsed = parse_utterance(req.utterance, list(state.team_names or []), state.teams)
    explicit_team = bool(parsed["explicit_team"])
    team_index = parsed["team_index"] if explicit_team else state.on_clock_team

    mismatch_note = None
    if (
        explicit_team
        and state.on_clock_team is not None
        and parsed["team_index"] != state.on_clock_team
    ):
        mismatch_note = (
            f"Team {parsed['team_index']} isn't on the clock — Team {state.on_clock_team} is"
        )

    player_text = str(parsed["player_text"] or "").strip()
    if not player_text:
        return _no_match(team_index, explicit_team, "I didn't hear a player name — try again")

    picked_ids = {p.player_id for p in state.picks}

    # Match against the FULL pool first: if the utterance most plausibly names
    # a player who is already gone, say so instead of guessing someone else.
    full_matches = match_player(player_text, pool)
    available_pool = pool[~pool["player_id"].isin(picked_ids)] if picked_ids else pool
    matches = match_player(player_text, available_pool)
    best_available = matches[0]["confidence"] if matches else 0.0
    if full_matches:
        top = full_matches[0]
        if (
            top["player_id"] in picked_ids
            and top["confidence"] >= MATCH_FLOOR
            and top["confidence"] > best_available
        ):
            return _no_match(team_index, explicit_team, f'"{top["name"]}" is already drafted')

    if not matches or matches[0]["confidence"] < MATCH_FLOOR:
        return _no_match(team_index, explicit_team, NO_MATCH_REASON)

    best = matches[0]
    rest = matches[1:]
    second = rest[0]["confidence"] if rest else 0.0
    alternatives = [VoiceCandidate(**c) for c in rest if c["confidence"] >= ALTERNATIVE_FLOOR][:3]

    confident = (
        best["confidence"] >= AUTO_COMMIT_CONFIDENCE
        and (best["confidence"] - second) >= AUTO_COMMIT_LEAD
    )
    if confident:
        reason = f'Heard "{best["name"]}" ({best["position"]})'
    else:
        reason = f'Did you mean "{best["name"]}" ({best["position"]})?'
    if mismatch_note:
        reason = f"{reason} — {mismatch_note}"

    return VoiceParseResponse(
        matched=True,
        needs_confirmation=True,
        team_index=team_index,
        explicit_team=explicit_team,
        best=VoiceCandidate(**best),
        alternatives=alternatives,
        reason=reason,
    )
