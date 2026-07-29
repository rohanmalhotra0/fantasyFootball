// Stub — replaced in Phase 5 by the real voice mode implementation.

export interface VoicePanelProps {
  draftId: number
  /** Called after a voice pick is committed so the room can refetch. */
  onCommitted: () => void
}

export default function VoicePanel(_props: VoicePanelProps) {
  return null
}
