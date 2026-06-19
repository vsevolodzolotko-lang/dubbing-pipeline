// Canvas palette, theme-aware. Mirrors the neutral tokens used across the app
// (see WaveformPlayer + index.css). One accent hue (blue) is reserved for
// selection/active; everything else stays near-monochrome.

export interface TimelineColors {
  waveform: string
  ruler: string
  rulerLabel: string
  rulerMinor: string
  wordTick: string
}

export function colorsFor(dark: boolean): TimelineColors {
  return dark
    ? { waveform: '#3f4651', ruler: '#52525b', rulerLabel: '#9ca3af', rulerMinor: '#2a2a2e', wordTick: '#60a5fa' }
    : { waveform: '#c7ccd1', ruler: '#9ca3af', rulerLabel: '#6b7280', rulerMinor: '#e5e7eb', wordTick: '#3b82f6' }
}
