// Draft-room WebSocket with bulletproof reconnect.
//
// Contract: the server broadcasts {"type": "state", "state": DraftState}
// after every pick. On ANY reconnect we fetch fresh state over REST *first*
// and only then resume the socket, so a pick made while we were offline can
// never be lost. The store dedupes the REST snapshot vs. the WS echo.

import { api, draftWsUrl } from './api'
import type { DraftState } from './types'

export type ConnectionStatus = 'connecting' | 'live' | 'reconnecting' | 'offline'

export interface ConnectDraftHandlers {
  onState: (state: DraftState) => void
  onStatus: (status: ConnectionStatus) => void
}

const BACKOFF_MS = [500, 1000, 2000, 4000]
const MAX_BACKOFF_MS = 10_000
const HEARTBEAT_MS = 20_000

/** Open the draft socket. Returns a dispose() that stops everything. */
export function connectDraft(id: number, handlers: ConnectDraftHandlers): () => void {
  let disposed = false
  let socket: WebSocket | null = null
  let attempt = 0
  let heartbeat: ReturnType<typeof setInterval> | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  function stopHeartbeat() {
    if (heartbeat != null) {
      clearInterval(heartbeat)
      heartbeat = null
    }
  }

  function scheduleReconnect() {
    if (disposed || reconnectTimer != null) return
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false
    handlers.onStatus(offline ? 'offline' : 'reconnecting')
    const delay = attempt < BACKOFF_MS.length ? BACKOFF_MS[attempt] : MAX_BACKOFF_MS
    attempt += 1
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      void open(true)
    }, delay)
  }

  async function open(isReconnect: boolean) {
    if (disposed) return

    if (isReconnect) {
      // Fresh state FIRST — no lost picks, ever. If REST fails the backend
      // is likely down; back off and try the whole sequence again.
      try {
        const state = await api.draftState(id)
        if (disposed) return
        handlers.onState(state)
      } catch {
        scheduleReconnect()
        return
      }
    }

    let ws: WebSocket
    try {
      ws = new WebSocket(draftWsUrl(id))
    } catch {
      scheduleReconnect()
      return
    }
    socket = ws

    ws.onopen = () => {
      if (disposed) {
        ws.close()
        return
      }
      attempt = 0
      handlers.onStatus('live')
      stopHeartbeat()
      heartbeat = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.send('ping')
          } catch {
            /* socket is closing; onclose will handle it */
          }
        }
      }, HEARTBEAT_MS)
    }

    ws.onmessage = (event: MessageEvent) => {
      if (disposed || typeof event.data !== 'string') return
      try {
        const msg: unknown = JSON.parse(event.data)
        if (
          typeof msg === 'object' &&
          msg !== null &&
          (msg as { type?: unknown }).type === 'state' &&
          (msg as { state?: unknown }).state != null
        ) {
          handlers.onState((msg as { state: DraftState }).state)
        }
      } catch {
        /* ignore non-JSON frames (pong etc.) */
      }
    }

    ws.onerror = () => {
      // Force the close path; onclose owns the reconnect.
      try {
        ws.close()
      } catch {
        /* already closed */
      }
    }

    ws.onclose = () => {
      stopHeartbeat()
      if (socket === ws) socket = null
      if (!disposed) scheduleReconnect()
    }
  }

  handlers.onStatus('connecting')
  void open(false)

  return function dispose() {
    disposed = true
    if (reconnectTimer != null) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    stopHeartbeat()
    if (socket != null) {
      const ws = socket
      socket = null
      ws.onclose = null
      ws.onerror = null
      ws.onmessage = null
      try {
        ws.close()
      } catch {
        /* already closed */
      }
    }
  }
}
