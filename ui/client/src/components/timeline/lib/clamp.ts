import { MIN_DURATION, MIN_GAP } from './constants'
import { clamp } from './geometry'
import type { EdgeSide, Times } from '../model/types'

/**
 * Move one edge to `t`, then clamp: left ≥ prev.end + gap, right ≤ next.start −
 * gap, both within [0, duration], and keep ≥ MIN_DURATION. Applied after snap.
 */
export function clampEdge(
  cur: Times, side: EdgeSide, t: number,
  prevEnd: number, nextStart: number, durationSec: number,
): Times {
  if (side === 'start') {
    const lo = Math.max(0, prevEnd + MIN_GAP)
    const hi = cur.end - MIN_DURATION
    return { start: clamp(t, lo, Math.max(lo, hi)), end: cur.end }
  }
  const lo = cur.start + MIN_DURATION
  const hi = Math.min(durationSec, nextStart - MIN_GAP)
  return { start: cur.start, end: clamp(t, Math.min(lo, hi), Math.max(lo, hi)) }
}

/**
 * Slide the whole segment by `deltaT`, preserving its duration and clamping so it
 * stays within [prev.end + gap, next.start − gap] ∩ [0, duration].
 */
export function clampMove(
  cur: Times, deltaT: number, prevEnd: number, nextStart: number, durationSec: number,
): Times {
  const dur = cur.end - cur.start
  const lo = Math.max(0, prevEnd + MIN_GAP)
  const hi = Math.min(durationSec, nextStart - MIN_GAP) - dur
  const start = clamp(cur.start + deltaT, lo, Math.max(lo, hi))
  return { start, end: start + dur }
}
