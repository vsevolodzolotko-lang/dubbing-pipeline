import type { RawSegment } from '../../../api/types'
import { ms, num } from '../lib/time'

/** Clean internal model derived from RawSegment — times in seconds (float). */
export interface TSegment {
  id: string
  startSec: number
  endSec: number
  text: string
}

export type EdgeSide = 'start' | 'end'

export interface Times {
  start: number
  end: number
}

/** One coalesced undo/redo entry (a whole drag or a nudge burst). */
export interface HistoryEntry {
  id: string
  prev: Times
  next: Times
}

/** Peaks payload from /api/peaks/en (or the {unavailable} fallback). */
export interface Peaks {
  durationSec: number
  detail: number[]
  overview: number[]
}

/** RawSegment[] → TSegment[]: coerce + ms-round once, on seed. Order preserved. */
export function toTSegments(raw: RawSegment[]): TSegment[] {
  return raw.map((s) => ({
    id: s.segment_id,
    text: s.en_text,
    startSec: ms(num(s.en_start_sec)),
    endSec: ms(num(s.en_end_sec)),
  }))
}

/** Stable signature of segment ids + times — drives re-seed/reconcile decisions. */
export function segmentsSignature(raw: RawSegment[]): string {
  return raw.map((s) => `${s.segment_id}:${num(s.en_start_sec)}:${num(s.en_end_sec)}`).join('|')
}
