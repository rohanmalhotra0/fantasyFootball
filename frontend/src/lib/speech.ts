// Web Speech API wrapper: continuous recognition with auto-restart plus
// spoken replies. Everything degrades to a no-op when the browser lacks the
// APIs, and the recognition constructor is injectable so tests can fake it.

export interface SpeechRecognitionResultLike {
  isFinal: boolean
  0: { transcript: string }
}

export interface SpeechRecognitionEventLike {
  resultIndex: number
  results: {
    length: number
    [index: number]: SpeechRecognitionResultLike
  }
}

export interface SpeechRecognitionErrorEventLike {
  error?: string
}

export interface SpeechRecognitionLike {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
}

export type RecognitionConstructor = new () => SpeechRecognitionLike

export type RecognizerStatus = 'listening' | 'restarting' | 'stopped'

export interface RecognizerCallbacks {
  /** A completed utterance (interim results are off). */
  onFinalTranscript: (text: string) => void
  /** code is the SpeechRecognition error code; 'not-allowed' = mic blocked. */
  onError: (code: string, message: string) => void
  onStatus?: (status: RecognizerStatus) => void
}

export interface Recognizer {
  start(): void
  stop(): void
  isEnabled(): boolean
}

const INITIAL_BACKOFF_MS = 300
const MAX_BACKOFF_MS = 5000
/** Errors that mean "stop trying" — restarting would just fail again. */
const FATAL_ERRORS = new Set(['not-allowed', 'service-not-allowed'])

type SpeechWindow = Window & {
  SpeechRecognition?: RecognitionConstructor
  webkitSpeechRecognition?: RecognitionConstructor
}

function browserConstructor(): RecognitionConstructor | undefined {
  if (typeof window === 'undefined') return undefined
  const w = window as SpeechWindow
  return w.SpeechRecognition ?? w.webkitSpeechRecognition
}

export function isSpeechSupported(): boolean {
  return browserConstructor() !== undefined
}

/** Returns null when no constructor is available (unsupported browser). */
export function createRecognizer(
  callbacks: RecognizerCallbacks,
  recognitionCtor?: RecognitionConstructor,
): Recognizer | null {
  const maybeCtor = recognitionCtor ?? browserConstructor()
  if (!maybeCtor) return null
  const Ctor: RecognitionConstructor = maybeCtor

  let enabled = false
  let current: SpeechRecognitionLike | null = null
  let restartTimer: ReturnType<typeof setTimeout> | null = null
  let backoffMs = INITIAL_BACKOFF_MS

  function clearRestartTimer() {
    if (restartTimer !== null) {
      clearTimeout(restartTimer)
      restartTimer = null
    }
  }

  function detach() {
    if (current) {
      current.onresult = null
      current.onerror = null
      current.onend = null
      try {
        current.stop()
      } catch {
        /* already stopped */
      }
      current = null
    }
  }

  function handleResult(event: SpeechRecognitionEventLike) {
    backoffMs = INITIAL_BACKOFF_MS // healthy session — reset the restart backoff
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i]
      if (result?.isFinal) {
        const text = result[0]?.transcript?.trim()
        if (text) callbacks.onFinalTranscript(text)
      }
    }
  }

  function handleError(event: SpeechRecognitionErrorEventLike) {
    const code = event.error ?? 'unknown'
    if (FATAL_ERRORS.has(code)) {
      enabled = false
      clearRestartTimer()
      detach()
      callbacks.onStatus?.('stopped')
      callbacks.onError(code, 'Mic blocked — check browser permissions')
      return
    }
    callbacks.onError(code, `Speech recognition error: ${code}`)
    // Chrome fires onend right after most errors; restart logic lives there.
  }

  function handleEnd() {
    if (!enabled) return
    // Chrome kills continuous sessions after ~60s: restart with a small backoff.
    callbacks.onStatus?.('restarting')
    clearRestartTimer()
    const delay = backoffMs
    backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS)
    restartTimer = setTimeout(() => {
      restartTimer = null
      if (enabled) startSession()
    }, delay)
  }

  function startSession() {
    detach()
    const rec = new Ctor()
    rec.continuous = true
    rec.interimResults = false
    rec.lang = 'en-US'
    rec.onresult = handleResult
    rec.onerror = handleError
    rec.onend = handleEnd
    current = rec
    try {
      rec.start()
      callbacks.onStatus?.('listening')
    } catch {
      handleEnd() // e.g. "already started" — retry with backoff
    }
  }

  return {
    start() {
      if (enabled) return
      enabled = true
      backoffMs = INITIAL_BACKOFF_MS
      startSession()
    },
    stop() {
      enabled = false
      clearRestartTimer()
      detach()
      callbacks.onStatus?.('stopped')
    },
    isEnabled() {
      return enabled
    },
  }
}

export interface SpeakOptions {
  enabled: boolean
}

/** Speak a short reply. No-op when disabled or speechSynthesis is missing. */
export function speak(text: string, options: SpeakOptions): void {
  if (!options.enabled || typeof window === 'undefined') return
  const synth = window.speechSynthesis as SpeechSynthesis | undefined
  const Utterance = window.SpeechSynthesisUtterance as
    | typeof SpeechSynthesisUtterance
    | undefined
  if (!synth || typeof Utterance !== 'function') return
  try {
    synth.cancel() // drop any queued/ongoing speech — the latest reply wins
    const utterance = new Utterance(text)
    utterance.rate = 1.05
    synth.speak(utterance)
  } catch {
    /* speech is best-effort */
  }
}
