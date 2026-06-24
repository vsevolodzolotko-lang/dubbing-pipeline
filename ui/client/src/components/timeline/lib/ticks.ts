// Ruler tick math: pick a "nice" labeled interval so major labels land roughly
// every TARGET_LABEL_PX, with minor ticks subdividing.

const NICE = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300]
const TARGET_LABEL_PX = 100

export interface Tick {
  time: number
  major: boolean
}

/** Ticks across [0, durationSec] at the current zoom. Major = labeled. */
export function niceTicks(pxPerSecond: number, durationSec: number): Tick[] {
  if (durationSec <= 0 || pxPerSecond <= 0) return []
  const rawStep = TARGET_LABEL_PX / pxPerSecond
  const major = NICE.find((s) => s >= rawStep) ?? NICE[NICE.length - 1]
  const minor = major / (major / 0.5 >= 2 && major >= 1 ? 5 : major >= 0.5 ? 5 : 2) || major
  const step = Math.min(minor, major)
  const ticks: Tick[] = []
  // iterate in integer multiples of `step` to avoid float drift
  const count = Math.floor(durationSec / step) + 1
  for (let i = 0; i < count; i++) {
    const t = +(i * step).toFixed(4)
    if (t > durationSec) break
    const isMajor = Math.abs(t / major - Math.round(t / major)) < 1e-6
    ticks.push({ time: t, major: isMajor })
  }
  return ticks
}
