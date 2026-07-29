// Inline voice settings row: spoken replies on/off, persisted to localStorage.

const STORAGE_KEY = 'voice.speak'

export function loadSpeakEnabled(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function saveSpeakEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0')
  } catch {
    /* private mode — setting just won't persist */
  }
}

export interface VoiceSettingsProps {
  speakEnabled: boolean
  onSpeakChange: (enabled: boolean) => void
}

export default function VoiceSettings({ speakEnabled, onSpeakChange }: VoiceSettingsProps) {
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        data-testid="voice-speak-toggle"
        aria-pressed={speakEnabled}
        className="btn-secondary"
        onClick={() => onSpeakChange(!speakEnabled)}
      >
        <span aria-hidden="true">{speakEnabled ? '🔊' : '🔇'}</span>
        Spoken replies: {speakEnabled ? 'ON' : 'OFF'}
      </button>
    </div>
  )
}
