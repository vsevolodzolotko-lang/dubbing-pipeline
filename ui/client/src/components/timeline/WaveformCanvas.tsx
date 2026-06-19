import { colorsFor } from './lib/colors'
import { useCanvas2D } from './model/useCanvas2D'
import { useIsDark } from './model/useIsDark'
import type { Peaks } from './model/types'

/**
 * Faint waveform. The canvas spans the full timeline width, but the waveform is
 * drawn only across its OWN duration (peaks.durationSec × pxPerSecond) — so when
 * the timeline is longer than the audio (e.g. a longer video reference) the wave
 * isn't stretched. Repaints only on zoom / peaks / theme change.
 */
export function WaveformCanvas({ peaks, contentWidth, pxPerSecond }: {
  peaks: Peaks | null
  contentWidth: number
  pxPerSecond: number
}) {
  const dark = useIsDark()
  const ref = useCanvas2D((ctx, w, h) => {
    const data = peaks?.detail ?? []
    if (!data.length) return
    const drawW = peaks && peaks.durationSec > 0 ? Math.min(w, peaks.durationSec * pxPerSecond) : w
    const mid = h / 2
    ctx.strokeStyle = colorsFor(dark).waveform
    for (let x = 0; x < drawW; x++) {
      const amp = (data[Math.floor((x / drawW) * data.length)] ?? 0) * (h / 2) * 0.92
      ctx.beginPath()
      ctx.moveTo(x + 0.5, mid - amp)
      ctx.lineTo(x + 0.5, mid + amp)
      ctx.stroke()
    }
  }, [peaks, contentWidth, pxPerSecond, dark])

  return <canvas ref={ref} aria-hidden style={{ width: contentWidth }} className="pointer-events-none absolute inset-0 h-full" />
}
