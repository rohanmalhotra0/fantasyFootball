"""Draft room REST + WebSocket routes.

Every mutation commits first (inside the engine), then broadcasts the
full state snapshot to all sockets, then returns the same snapshot —
REST response and WS message are literally the same dict.
"""

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from ..draft import engine, grade, recommend
from ..draft.ws import broadcast_state, manager
from .schemas import (
    DraftListItem,
    DraftReport,
    DraftState,
    EditPickRequest,
    MakePickRequest,
    RecommendationsResponse,
    TeamOutlook,
)

router = APIRouter(prefix="/api")


class TeamOutlooksResponse(BaseModel):
    teams: list[TeamOutlook]


@router.post("/drafts", response_model=DraftState)
def create_draft() -> dict:
    return engine.create_draft()


@router.get("/drafts", response_model=list[DraftListItem])
def list_drafts() -> list[dict]:
    return engine.list_drafts()


@router.get("/drafts/{draft_id}", response_model=DraftState)
def get_draft(draft_id: int) -> dict:
    return engine.get_state(draft_id)


@router.post("/drafts/{draft_id}/picks", response_model=DraftState)
async def make_pick(draft_id: int, body: MakePickRequest) -> dict:
    state = engine.make_pick(
        draft_id,
        player_id=body.player_id,
        player_name=body.player_name,
        team_index=body.team_index,
        source=body.source,
    )
    await broadcast_state(draft_id, state)
    return state


@router.post("/drafts/{draft_id}/undo", response_model=DraftState)
async def undo_pick(draft_id: int) -> dict:
    state = engine.undo_last(draft_id)
    await broadcast_state(draft_id, state)
    return state


@router.put("/drafts/{draft_id}/picks/{overall}", response_model=DraftState)
async def edit_pick(draft_id: int, overall: int, body: EditPickRequest) -> dict:
    state = engine.edit_pick(
        draft_id, overall, player_id=body.player_id, player_name=body.player_name
    )
    await broadcast_state(draft_id, state)
    return state


@router.get("/drafts/{draft_id}/recommendations", response_model=RecommendationsResponse)
def recommendations(draft_id: int) -> dict:
    return recommend.build_recommendations(draft_id)


@router.get("/drafts/{draft_id}/outlooks", response_model=TeamOutlooksResponse)
def outlooks(draft_id: int) -> dict:
    return recommend.team_outlooks(draft_id)


@router.get("/drafts/{draft_id}/report", response_model=DraftReport)
def report(draft_id: int) -> dict:
    return grade.build_report(draft_id)


@router.websocket("/drafts/{draft_id}/ws")
async def draft_ws(websocket: WebSocket, draft_id: int) -> None:
    # Reject unknown drafts before completing the handshake.
    try:
        engine.get_state(draft_id)
    except HTTPException:
        await websocket.close(code=1008)
        return
    await manager.connect(draft_id, websocket)
    try:
        # Register first, THEN snapshot: any mutation committed after this
        # snapshot will also be broadcast to this socket — no gap.
        await websocket.send_json({"type": "state", "state": engine.get_state(draft_id)})
        while True:
            # Clients don't send anything meaningful; this loop just keeps
            # the connection open and detects disconnects.
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(draft_id, websocket)
