import type { Word } from '../../../api/staged'

/**
 * Snap a time to the nearest word boundary within `snapPx` (converted to seconds
 * at the current zoom, so the feel is constant). Returns the (possibly snapped)
 * time and the matched boundary (for the snap affordance), or null if none.
 */
export function snapToWords(
  t: number, words: Word[], snapPx: number, pxPerSecond: number,
): { time: number; boundary: number | null } {
  if (!words.length || pxPerSecond <= 0) return { time: t, boundary: null }
  const thresh = snapPx / pxPerSecond
  let best = t
  let bestD = thresh
  let boundary: number | null = null
  for (const w of words) {
    for (const b of [w.start, w.end]) {
      const d = Math.abs(b - t)
      if (d < bestD) { bestD = d; best = b; boundary = b }
    }
  }
  return { time: best, boundary }
}
