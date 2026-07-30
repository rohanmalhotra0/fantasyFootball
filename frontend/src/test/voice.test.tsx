import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import VoicePanel from '../components/voice/VoicePanel'
import type { RecommendationsResponse, VoiceParseResponse } from '../lib/types'

// ---- module mocks -----------------------------------------------------------

const speechMock = vi.hoisted(() => ({
  supported: true,
  recognizers: [] as Array<{
    callbacks: {
      onFinalTranscript: (text: string) => void
      onError: (code: string, message: string) => void
    }
    started: boolean
    stopped: boolean
  }>,
  speakCalls: [] as Array<{ text: string; enabled: boolean }>,
}))

vi.mock('../lib/speech', () => ({
  isSpeechSupported: () => speechMock.supported,
  createRecognizer: (callbacks: {
    onFinalTranscript: (text: string) => void
    onError: (code: string, message: string) => void
  }) => {
    const rec = { callbacks, started: false, stopped: false }
    speechMock.recognizers.push(rec)
    return {
      start: () => {
        rec.started = true
      },
      stop: () => {
        rec.stopped = true
      },
      isEnabled: () => rec.started && !rec.stopped,
    }
  },
  speak: (text: string, options: { enabled: boolean }) => {
    speechMock.speakCalls.push({ text, enabled: options.enabled })
  },
}))

const apiMock = vi.hoisted(() => ({
  voiceParse: vi.fn(),
  makePick: vi.fn(),
  recommendations: vi.fn(),
}))

vi.mock('../lib/api', () => ({ api: apiMock }))

// ---- fixtures ---------------------------------------------------------------

function parseResponse(overrides: Partial<VoiceParseResponse> = {}): VoiceParseResponse {
  return {
    matched: true,
    needs_confirmation: true,
    team_index: 3,
    explicit_team: true,
    best: { player_id: 'p1', name: 'Bijan Robinson', position: 'RB', confidence: 0.97 },
    alternatives: [],
    reason: 'Heard "Bijan Robinson" (RB)',
    ...overrides,
  }
}

const recsResponse: RecommendationsResponse = {
  on_clock_team: 3,
  my_turn: true,
  picks_until_my_turn: 0,
  recommendations: [
    {
      player_id: 'p1',
      name: 'Justin Jefferson',
      position: 'WR',
      team: 'MIN',
      projected_points: 280.5,
      vorp: 120.3,
      adp: 2.1,
      survival_prob: 0.4,
      tier: 1,
      risk_flag: false,
      reason: 'Best available by VORP',
    },
  ],
  my_outlook: null,
  adp_available: true,
}

let onCommitted: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.useFakeTimers()
  window.localStorage.clear()
  speechMock.supported = true
  speechMock.recognizers.length = 0
  speechMock.speakCalls.length = 0
  apiMock.voiceParse.mockReset()
  apiMock.makePick.mockReset()
  apiMock.recommendations.mockReset()
  onCommitted = vi.fn()
})

afterEach(() => {
  vi.useRealTimers()
})

function renderPanelOn() {
  render(<VoicePanel draftId={7} onCommitted={onCommitted} />)
  fireEvent.click(screen.getByTestId('voice-toggle'))
  expect(speechMock.recognizers).toHaveLength(1)
  expect(speechMock.recognizers[0].started).toBe(true)
  return speechMock.recognizers[0]
}

async function hear(rec: (typeof speechMock.recognizers)[number], text: string) {
  await act(async () => {
    rec.callbacks.onFinalTranscript(text)
  })
}

// ---- tests ------------------------------------------------------------------

test('unsupported browser shows the unavailable card with no toggle', () => {
  speechMock.supported = false
  render(<VoicePanel draftId={7} onCommitted={onCommitted} />)
  const card = screen.getByTestId('voice-unavailable')
  expect(card).toHaveTextContent('Voice not supported in this browser')
  expect(screen.queryByTestId('voice-toggle')).not.toBeInTheDocument()
})

test('mic permission denied flips to the unavailable card', async () => {
  const rec = renderPanelOn()
  await act(async () => {
    rec.callbacks.onError('not-allowed', 'Mic blocked — check browser permissions')
  })
  expect(screen.getByTestId('voice-unavailable')).toHaveTextContent(
    'Mic blocked — check browser permissions',
  )
  expect(screen.queryByTestId('voice-toggle')).not.toBeInTheDocument()
})

test('high-confidence parse -> auto toast -> 5s countdown -> single voice pick', async () => {
  apiMock.voiceParse.mockResolvedValue(parseResponse())
  apiMock.makePick.mockResolvedValue({})
  const rec = renderPanelOn()
  expect(screen.getByTestId('voice-toggle')).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByTestId('voice-toggle')).toHaveTextContent('listening')

  await hear(rec, 'team 3 takes bijan')
  expect(apiMock.voiceParse).toHaveBeenCalledWith(7, 'team 3 takes bijan')
  expect(screen.getByTestId('voice-status')).toHaveTextContent('team 3 takes bijan')

  const toast = screen.getByTestId('voice-toast')
  expect(toast).toHaveTextContent('Bijan Robinson')
  expect(toast).toHaveTextContent('Team 3')
  expect(screen.getByTestId('voice-undo')).toBeInTheDocument()
  expect(apiMock.makePick).not.toHaveBeenCalled()

  await act(async () => {
    vi.advanceTimersByTime(5000)
  })
  await act(async () => {})

  expect(apiMock.makePick).toHaveBeenCalledTimes(1)
  expect(apiMock.makePick).toHaveBeenCalledWith(7, {
    player_id: 'p1',
    team_index: 3,
    source: 'voice',
  })
  expect(onCommitted).toHaveBeenCalledTimes(1)
  expect(screen.queryByTestId('voice-toast')).not.toBeInTheDocument()
})

test('undo cancels the countdown — makePick is never called', async () => {
  apiMock.voiceParse.mockResolvedValue(parseResponse())
  const rec = renderPanelOn()
  await hear(rec, 'team 3 takes bijan')

  await act(async () => {
    vi.advanceTimersByTime(3000)
  })
  fireEvent.click(screen.getByTestId('voice-undo'))
  expect(screen.queryByTestId('voice-toast')).not.toBeInTheDocument()

  await act(async () => {
    vi.advanceTimersByTime(60_000)
  })
  expect(apiMock.makePick).not.toHaveBeenCalled()
  expect(onCommitted).not.toHaveBeenCalled()
})

test('low-confidence match needs an explicit confirm tap', async () => {
  apiMock.voiceParse.mockResolvedValue(
    parseResponse({
      best: { player_id: 'p5', name: 'Jaylen Waddle', position: 'WR', confidence: 0.74 },
      alternatives: [
        { player_id: 'p6', name: 'Jaylen Warren', position: 'RB', confidence: 0.7 },
        { player_id: 'p7', name: 'Jalen Hurts', position: 'QB', confidence: 0.5 },
      ],
      reason: 'Did you mean "Jaylen Waddle" (WR)?',
    }),
  )
  apiMock.makePick.mockResolvedValue({})
  const rec = renderPanelOn()
  await hear(rec, 'jaylen')

  // Confirm mode: no countdown, no undo — advancing time commits nothing.
  expect(screen.queryByTestId('voice-undo')).not.toBeInTheDocument()
  await act(async () => {
    vi.advanceTimersByTime(60_000)
  })
  expect(apiMock.makePick).not.toHaveBeenCalled()

  // Alternatives are visible and tappable.
  expect(screen.getByTestId('voice-alt-p6')).toHaveTextContent('Jaylen Warren')
  expect(screen.getByTestId('voice-alt-p7')).toHaveTextContent('Jalen Hurts')

  await act(async () => {
    fireEvent.click(screen.getByTestId('voice-confirm'))
  })
  expect(apiMock.makePick).toHaveBeenCalledTimes(1)
  expect(apiMock.makePick).toHaveBeenCalledWith(7, {
    player_id: 'p5',
    team_index: 3,
    source: 'voice',
  })
  expect(onCommitted).toHaveBeenCalledTimes(1)
  expect(screen.queryByTestId('voice-toast')).not.toBeInTheDocument()
})

test('matched=false shows an info line, no toast, never commits', async () => {
  apiMock.voiceParse.mockResolvedValue(
    parseResponse({
      matched: false,
      needs_confirmation: false,
      best: null,
      reason: 'No confident match — try the full name',
    }),
  )
  const rec = renderPanelOn()
  await hear(rec, 'mumble mumble')

  expect(screen.queryByTestId('voice-toast')).not.toBeInTheDocument()
  expect(screen.getByTestId('voice-notice')).toHaveTextContent('No confident match')

  await act(async () => {
    vi.advanceTimersByTime(60_000)
  })
  expect(apiMock.makePick).not.toHaveBeenCalled()
})

test('already-drafted reason surfaces as a warning line', async () => {
  apiMock.voiceParse.mockResolvedValue(
    parseResponse({
      matched: false,
      needs_confirmation: false,
      best: null,
      reason: '"Bijan Robinson" is already drafted',
    }),
  )
  const rec = renderPanelOn()
  await hear(rec, 'bijan robinson')

  expect(screen.queryByTestId('voice-toast')).not.toBeInTheDocument()
  const notice = screen.getByTestId('voice-notice')
  expect(notice).toHaveTextContent('already drafted')
  expect(notice).toHaveTextContent('Heads up')
})

test('a second utterance replaces the pending toast without committing the first', async () => {
  apiMock.voiceParse.mockResolvedValueOnce(parseResponse())
  const rec = renderPanelOn()
  await hear(rec, 'team 3 takes bijan')
  expect(screen.getByTestId('voice-toast')).toHaveTextContent('Bijan Robinson')

  await act(async () => {
    vi.advanceTimersByTime(2000) // countdown running
  })

  apiMock.voiceParse.mockResolvedValueOnce(
    parseResponse({
      best: { player_id: 'p9', name: 'Josh Allen', position: 'QB', confidence: 0.7 },
      alternatives: [{ player_id: 'p10', name: 'Josh Jacobs', position: 'RB', confidence: 0.6 }],
      reason: 'Did you mean "Josh Allen" (QB)?',
    }),
  )
  await hear(rec, 'no wait josh allen')

  const toast = screen.getByTestId('voice-toast')
  expect(toast).toHaveTextContent('Josh Allen')
  expect(toast).not.toHaveTextContent('Bijan Robinson')

  // The first toast's countdown was cancelled; the second needs a tap.
  await act(async () => {
    vi.advanceTimersByTime(60_000)
  })
  expect(apiMock.makePick).not.toHaveBeenCalled()
  expect(onCommitted).not.toHaveBeenCalled()
})

test('commit failure flips the toast to the server message and commits nothing', async () => {
  apiMock.voiceParse.mockResolvedValue(parseResponse())
  apiMock.makePick.mockRejectedValue(new Error('Bijan Robinson was already picked at 1.03'))
  const rec = renderPanelOn()
  await hear(rec, 'team 3 takes bijan')

  await act(async () => {
    vi.advanceTimersByTime(5000)
  })
  await act(async () => {})

  const toast = screen.getByTestId('voice-toast')
  expect(toast).toHaveTextContent('already picked at 1.03')
  expect(onCommitted).not.toHaveBeenCalled()

  fireEvent.click(screen.getByTestId('voice-dismiss'))
  expect(screen.queryByTestId('voice-toast')).not.toBeInTheDocument()
})

test('spoken-replies toggle persists and a turn flip announces the suggestion', async () => {
  apiMock.recommendations.mockResolvedValue(recsResponse)
  const view = render(<VoicePanel draftId={7} onCommitted={onCommitted} myTurn={false} />)

  const toggle = screen.getByTestId('voice-speak-toggle')
  expect(toggle).toHaveAttribute('aria-pressed', 'false')
  fireEvent.click(toggle)
  expect(screen.getByTestId('voice-speak-toggle')).toHaveAttribute('aria-pressed', 'true')
  expect(window.localStorage.getItem('voice.speak')).toBe('1')

  await act(async () => {
    view.rerender(<VoicePanel draftId={7} onCommitted={onCommitted} myTurn={true} />)
  })
  expect(apiMock.recommendations).toHaveBeenCalledWith(7)
  expect(
    speechMock.speakCalls.some(
      (c) =>
        c.enabled && c.text.includes('You are on the clock') && c.text.includes('Justin Jefferson'),
    ),
  ).toBe(true)
})

test('turn flip stays silent when spoken replies are off', async () => {
  apiMock.recommendations.mockResolvedValue(recsResponse)
  const view = render(<VoicePanel draftId={7} onCommitted={onCommitted} myTurn={false} />)
  await act(async () => {
    view.rerender(<VoicePanel draftId={7} onCommitted={onCommitted} myTurn={true} />)
  })
  expect(apiMock.recommendations).not.toHaveBeenCalled()
  expect(speechMock.speakCalls).toHaveLength(0)
})
