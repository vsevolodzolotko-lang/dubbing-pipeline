// Pure time <-> pixel conversions. Content coordinates (0 = clip start),
// independent of scroll — the canvas/lane span the full content width inside an
// overflow-x:auto container, so the browser handles scrolling.

export const timeToPx = (t: number, pxPerSecond: number): number => t * pxPerSecond
export const pxToTime = (x: number, pxPerSecond: number): number => x / pxPerSecond

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))
