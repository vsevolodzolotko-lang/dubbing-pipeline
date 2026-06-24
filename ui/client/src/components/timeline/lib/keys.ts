import type { SegmentRow } from '../../../api/types'

// Stable per-(segment × language) key for the audio-gate timeline model: the
// localization rowKey when present, else a synthetic fallback. Used as the model
// id so each language's dub slot is retimed independently of the shared EN slot.
export const cellKey = (s: SegmentRow, lang: string) =>
  s.cells[lang]?.rowKey ?? `${s.segmentId}__${lang}`
