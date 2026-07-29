"""WebSocket fanout for the draft room.

Full-state snapshots ONLY — never deltas. Every successful REST mutation
broadcasts the freshly committed state to every connected socket, so two
tabs (or a phone + laptop) can never disagree: whichever message arrives
last IS the whole truth.
"""

import logging

from fastapi import WebSocket

log = logging.getLogger(__name__)


class ConnectionManager:
    """draft_id -> set of live sockets."""

    def __init__(self) -> None:
        self._connections: dict[int, set[WebSocket]] = {}

    async def connect(self, draft_id: int, websocket: WebSocket) -> None:
        await websocket.accept()
        self._connections.setdefault(draft_id, set()).add(websocket)

    def disconnect(self, draft_id: int, websocket: WebSocket) -> None:
        conns = self._connections.get(draft_id)
        if conns is None:
            return
        conns.discard(websocket)
        if not conns:
            self._connections.pop(draft_id, None)

    def connection_count(self, draft_id: int) -> int:
        return len(self._connections.get(draft_id, ()))

    async def broadcast_state(self, draft_id: int, state: dict) -> None:
        """Send {"type": "state", "state": ...} to every socket on the draft."""
        message = {"type": "state", "state": state}
        for websocket in list(self._connections.get(draft_id, ())):
            try:
                await websocket.send_json(message)
            except Exception:  # dead socket: drop it, never break the loop
                log.debug("dropping dead websocket for draft %s", draft_id, exc_info=True)
                self.disconnect(draft_id, websocket)


manager = ConnectionManager()


async def broadcast_state(draft_id: int, state: dict) -> None:
    """Module-level convenience used by the REST mutation endpoints."""
    await manager.broadcast_state(draft_id, state)
