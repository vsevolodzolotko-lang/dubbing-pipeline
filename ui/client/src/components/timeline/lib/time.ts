// Time helpers. The model stores seconds (float) and rounds to ms (3 decimals)
// on commit; pixels are never stored.

/** Coerce a Sheets-sourced `string | number` time field to a number. */
export const num = (v: string | number | null | undefined): number => Number(v) || 0

/** Round seconds to milliseconds (3 decimals) — used on every committed time. */
export const ms = (s: number): number => Math.round(s * 1000) / 1000

/** Compact readout for the cursor/time display, e.g. "12.34с". */
export function formatTime(t: number): string {
  return `${t.toFixed(2)}с`
}

/** Ruler label: whole seconds when zoomed out, hundredths when zoomed in. */
export function formatTick(t: number, pxPerSecond: number): string {
  if (pxPerSecond >= 120) return `${t.toFixed(2)}`
  if (pxPerSecond >= 40) return `${t.toFixed(1)}`
  return `${Math.round(t)}`
}
