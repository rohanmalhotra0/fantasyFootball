import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  createRecognizer,
  isSpeechSupported,
  speak,
  type RecognizerCallbacks,
  type SpeechRecognitionEventLike,
  type SpeechRecognitionLike,
} from '../lib/speech'

class FakeRecognition implements SpeechRecognitionLike {
  static instances: FakeRecognition[] = []
  continuous = false
  interimResults = true
  lang = ''
  onresult: ((event: SpeechRecognitionEventLike) => void) | null = null
  onerror: ((event: { error?: string }) => void) | null = null
  onend: (() => void) | null = null
  startCalls = 0
  stopCalls = 0

  constructor() {
    FakeRecognition.instances.push(this)
  }

  start() {
    this.startCalls += 1
  }

  stop() {
    this.stopCalls += 1
  }

  emitFinal(text: string) {
    this.onresult?.({
      resultIndex: 0,
      results: { length: 1, 0: { isFinal: true, 0: { transcript: text } } },
    })
  }

  emitError(code: string) {
    this.onerror?.({ error: code })
  }

  emitEnd() {
    this.onend?.()
  }
}

function makeCallbacks(): RecognizerCallbacks & {
  onFinalTranscript: ReturnType<typeof vi.fn>
  onError: ReturnType<typeof vi.fn>
  onStatus: ReturnType<typeof vi.fn>
} {
  return {
    onFinalTranscript: vi.fn(),
    onError: vi.fn(),
    onStatus: vi.fn(),
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  FakeRecognition.instances = []
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

test('isSpeechSupported reflects available constructors', () => {
  expect(isSpeechSupported()).toBe(false) // jsdom has no speech API
  vi.stubGlobal('webkitSpeechRecognition', FakeRecognition)
  expect(isSpeechSupported()).toBe(true)
})

test('createRecognizer returns null when the browser has no constructor', () => {
  expect(createRecognizer(makeCallbacks())).toBeNull()
})

test('start wires a continuous en-US session and delivers final transcripts', () => {
  const cbs = makeCallbacks()
  const rec = createRecognizer(cbs, FakeRecognition)
  expect(rec).not.toBeNull()
  rec?.start()

  expect(FakeRecognition.instances).toHaveLength(1)
  const inst = FakeRecognition.instances[0]
  expect(inst.continuous).toBe(true)
  expect(inst.interimResults).toBe(false)
  expect(inst.lang).toBe('en-US')
  expect(inst.startCalls).toBe(1)
  expect(cbs.onStatus).toHaveBeenCalledWith('listening')
  expect(rec?.isEnabled()).toBe(true)

  inst.emitFinal('  team 3 takes bijan ')
  expect(cbs.onFinalTranscript).toHaveBeenCalledTimes(1)
  expect(cbs.onFinalTranscript).toHaveBeenCalledWith('team 3 takes bijan')
})

test('auto-restarts after onend while enabled, with growing backoff', () => {
  const cbs = makeCallbacks()
  const rec = createRecognizer(cbs, FakeRecognition)
  rec?.start()

  // First drop: restarts after the initial 300ms backoff.
  FakeRecognition.instances[0].emitEnd()
  expect(cbs.onStatus).toHaveBeenCalledWith('restarting')
  expect(FakeRecognition.instances).toHaveLength(1)
  vi.advanceTimersByTime(300)
  expect(FakeRecognition.instances).toHaveLength(2)
  expect(FakeRecognition.instances[1].startCalls).toBe(1)

  // Second consecutive drop: backoff doubled to 600ms.
  FakeRecognition.instances[1].emitEnd()
  vi.advanceTimersByTime(300)
  expect(FakeRecognition.instances).toHaveLength(2)
  vi.advanceTimersByTime(300)
  expect(FakeRecognition.instances).toHaveLength(3)

  // A healthy result resets the backoff to 300ms.
  FakeRecognition.instances[2].emitFinal('hello')
  FakeRecognition.instances[2].emitEnd()
  vi.advanceTimersByTime(300)
  expect(FakeRecognition.instances).toHaveLength(4)
})

test('stop fully tears down and blocks any restart', () => {
  const cbs = makeCallbacks()
  const rec = createRecognizer(cbs, FakeRecognition)
  rec?.start()
  const inst = FakeRecognition.instances[0]

  rec?.stop()
  expect(inst.stopCalls).toBe(1)
  expect(cbs.onStatus).toHaveBeenCalledWith('stopped')
  expect(rec?.isEnabled()).toBe(false)

  inst.emitEnd() // handlers are detached — must be a no-op
  vi.advanceTimersByTime(60_000)
  expect(FakeRecognition.instances).toHaveLength(1)
})

test('stop cancels a pending auto-restart', () => {
  const cbs = makeCallbacks()
  const rec = createRecognizer(cbs, FakeRecognition)
  rec?.start()
  FakeRecognition.instances[0].emitEnd() // restart now pending
  rec?.stop()
  vi.advanceTimersByTime(60_000)
  expect(FakeRecognition.instances).toHaveLength(1)
})

test('not-allowed error surfaces distinctly and stops for good', () => {
  const cbs = makeCallbacks()
  const rec = createRecognizer(cbs, FakeRecognition)
  rec?.start()
  const inst = FakeRecognition.instances[0]

  inst.emitError('not-allowed')
  expect(cbs.onError).toHaveBeenCalledWith('not-allowed', expect.stringContaining('permissions'))
  expect(rec?.isEnabled()).toBe(false)

  inst.emitEnd()
  vi.advanceTimersByTime(60_000)
  expect(FakeRecognition.instances).toHaveLength(1) // never restarted
})

test('transient errors report but the session keeps restarting', () => {
  const cbs = makeCallbacks()
  const rec = createRecognizer(cbs, FakeRecognition)
  rec?.start()
  const inst = FakeRecognition.instances[0]

  inst.emitError('no-speech')
  expect(cbs.onError).toHaveBeenCalledWith('no-speech', expect.any(String))
  expect(rec?.isEnabled()).toBe(true)

  inst.emitEnd()
  vi.advanceTimersByTime(300)
  expect(FakeRecognition.instances).toHaveLength(2)
})

describe('speak', () => {
  class FakeUtterance {
    rate = 1
    constructor(public text: string) {}
  }

  test('no-ops without speechSynthesis support', () => {
    expect(() => speak('hi', { enabled: true })).not.toThrow()
  })

  test('no-ops when disabled', () => {
    const cancel = vi.fn()
    const speakFn = vi.fn()
    vi.stubGlobal('speechSynthesis', { cancel, speak: speakFn })
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance)
    speak('hi', { enabled: false })
    expect(cancel).not.toHaveBeenCalled()
    expect(speakFn).not.toHaveBeenCalled()
  })

  test('cancels the queue then speaks at rate 1.05', () => {
    const cancel = vi.fn()
    const speakFn = vi.fn()
    vi.stubGlobal('speechSynthesis', { cancel, speak: speakFn })
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance)

    speak('Got it — Bijan Robinson to Team 3', { enabled: true })
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(speakFn).toHaveBeenCalledTimes(1)
    const utterance = speakFn.mock.calls[0][0] as FakeUtterance
    expect(utterance.text).toBe('Got it — Bijan Robinson to Team 3')
    expect(utterance.rate).toBeCloseTo(1.05)
    // cancel happens before speak
    expect(cancel.mock.invocationCallOrder[0]).toBeLessThan(speakFn.mock.invocationCallOrder[0])
  })
})
