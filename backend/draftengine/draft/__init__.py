"""Draft room: engine (state machine), recommendations, grading, WS fanout.

The DB is the single source of truth. Every mutation is committed before
any broadcast, and the WebSocket only ever sends full state snapshots —
clients can never drift because they never apply deltas.
"""
