/**
 * Voice pick logging.
 *
 * Test 1 pins down the no-speech environment (voice-unavailable, no toggle).
 * Test 2 injects a fake webkitSpeechRecognition before navigation and drives
 * SpeechRecognitionEvent-shaped results through it: toast + confirm UI,
 * voice-undo cancels within the countdown, and an untouched 5s countdown
 * auto-logs the pick with source "voice".
 */
import { expect, test } from '@playwright/test'
import { createDraft, getDraftState, getRecs, lastName } from './helpers'

/**
 * Installed pre-navigation. Mirrors the shape of the real Web Speech API:
 * event.results is a SpeechRecognitionResultList-like (indexed, .length,
 * .item()) of SpeechRecognitionResult-like entries (indexed alternatives,
 * .isFinal), each alternative carrying {transcript, confidence}.
 * The live instance lands on window.__fakeRec; window.__emitSpeech(text)
 * fires a final result through its onresult handler.
 */
function installFakeSpeechRecognition() {
  class FakeSpeechRecognitionResult {
    isFinal: boolean
    length: number
    constructor(alternatives: Array<{ transcript: string; confidence: number }>, isFinal: boolean) {
      alternatives.forEach((alt, i) => {
        ;(this as Record<number, unknown>)[i] = alt
      })
      this.length = alternatives.length
      this.isFinal = isFinal
    }
    item(i: number) {
      return (this as Record<number, unknown>)[i]
    }
  }

  class FakeSpeechRecognitionResultList {
    length: number
    constructor(results: FakeSpeechRecognitionResult[]) {
      results.forEach((r, i) => {
        ;(this as Record<number, unknown>)[i] = r
      })
      this.length = results.length
    }
    item(i: number) {
      return (this as Record<number, unknown>)[i]
    }
  }

  class FakeSpeechRecognition {
    continuous = false
    interimResults = false
    lang = 'en-US'
    maxAlternatives = 1
    onstart: ((ev: Event) => void) | null = null
    onresult: ((ev: Event) => void) | null = null
    onerror: ((ev: Event) => void) | null = null
    onend: ((ev: Event) => void) | null = null
    onnomatch: ((ev: Event) => void) | null = null
    _running = false

    constructor() {
      ;(window as unknown as Record<string, unknown>).__fakeRec = this
    }
    start() {
      this._running = true
      this.onstart?.(new Event('start'))
    }
    stop() {
      this._running = false
      this.onend?.(new Event('end'))
    }
    abort() {
      this._running = false
      this.onend?.(new Event('end'))
    }
    // In case the app wires handlers via addEventListener instead of on*.
    addEventListener(type: string, fn: (ev: Event) => void) {
      ;(this as unknown as Record<string, unknown>)[`on${type}`] = fn
    }
    removeEventListener(type: string) {
      ;(this as unknown as Record<string, unknown>)[`on${type}`] = null
    }
  }

  ;(window as unknown as Record<string, unknown>).__emitSpeech = (transcript: string) => {
    const rec = (window as unknown as { __fakeRec?: FakeSpeechRecognition }).__fakeRec
    if (!rec || !rec.onresult) throw new Error('no active FakeSpeechRecognition with an onresult handler')
    const event = new Event('result') as Event & { results?: unknown; resultIndex?: number }
    event.resultIndex = 0
    event.results = new FakeSpeechRecognitionResultList([
      new FakeSpeechRecognitionResult([{ transcript, confidence: 0.92 }], true),
    ])
    rec.onresult(event)
  }

  ;(window as unknown as Record<string, unknown>).webkitSpeechRecognition = FakeSpeechRecognition
  ;(window as unknown as Record<string, unknown>).SpeechRecognition = FakeSpeechRecognition
}

test.describe('voice pick logging', () => {
  test('without SpeechRecognition the room shows voice-unavailable and no toggle', async ({
    page,
    request,
  }) => {
    // Chromium builds can expose a (non-functional) webkitSpeechRecognition;
    // delete both constructors so the no-speech path is deterministic.
    await page.addInitScript(() => {
      delete (window as unknown as Record<string, unknown>).SpeechRecognition
      delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition
    })

    const draft = await createDraft(request)
    await page.goto(`/draft/${draft.id}`)
    await expect(page.getByTestId('my-team-panel')).toBeVisible()

    await expect(page.getByTestId('voice-unavailable')).toBeVisible()
    await expect(page.getByTestId('voice-toggle')).toHaveCount(0)
  })

  test('fake recognition: toast, undo cancels, countdown elapses to a voice-sourced pick', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000)

    const draft = await createDraft(request)
    await page.addInitScript(installFakeSpeechRecognition)
    await page.goto(`/draft/${draft.id}`)
    await expect(page.getByTestId('my-team-panel')).toBeVisible()

    // Enable voice; the app should construct + start our fake.
    await expect(page.getByTestId('voice-unavailable')).toHaveCount(0)
    await page.getByTestId('voice-toggle').click()
    await expect(page.getByTestId('voice-status')).toBeVisible()
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const w = window as unknown as { __fakeRec?: { onresult: unknown } }
            return Boolean(w.__fakeRec && w.__fakeRec.onresult)
          }),
        { message: 'enabling the toggle should construct and wire a recognition instance' },
      )
      .toBe(true)

    // A real remaining player, straight from the API's recommendations.
    const recs = await getRecs(request, draft.id)
    const target = recs.recommendations[0]
    const pickCount = async () => (await getDraftState(request, draft.id)).picks.length
    expect(await pickCount()).toBe(0)

    // --- Utterance 1: toast + confirm appear; voice-undo cancels ---
    await page.evaluate((name) => {
      ;(window as unknown as { __emitSpeech: (t: string) => void }).__emitSpeech(name)
    }, target.name)

    const toast = page.getByTestId('voice-toast')
    await expect(toast).toBeVisible()
    await expect(toast).toContainText(lastName(target.name))
    await expect(page.getByTestId('voice-confirm')).toBeVisible()

    await page.getByTestId('voice-undo').click()
    // Wait out the full 5s auto-confirm window: the cancelled pick must
    // never reach the API.
    await page.waitForTimeout(6_500)
    expect(await pickCount(), 'voice-undo must cancel the pending pick').toBe(0)

    // --- Utterance 2: let the 5s countdown elapse -> pick logs as voice ---
    await page.evaluate((name) => {
      ;(window as unknown as { __emitSpeech: (t: string) => void }).__emitSpeech(name)
    }, target.name)
    await expect(page.getByTestId('voice-confirm')).toBeVisible()

    await expect
      .poll(pickCount, { timeout: 15_000, message: 'countdown expiry should log the pick' })
      .toBe(1)

    const state = await getDraftState(request, draft.id)
    expect(state.picks[0].player_id).toBe(target.player_id)
    expect(state.picks[0].source).toBe('voice')
  })
})
