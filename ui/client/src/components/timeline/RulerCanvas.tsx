import { colorsFor } from './lib/colors'
import { niceTicks } from './lib/ticks'
import { formatTick } from './lib/time'
import { useCanvas2D } from './model/useCanvas2D'
import { useIsDark } from './model/useIsDark'

/**
 * Time ruler: nice-interval major (labeled) + minor ticks. Spans the full
 * content width; repaints only on zoom/duration/theme change.
 */
export function RulerCanvas({ pxPerSecond, durationSec, contentWidth }: {
  pxPerSecond: number
  durationSec: number
  contentWidth: number
}) {
  const dark = useIsDark()
  const ref = useCanvas2D((ctx, _w, h) => {
    const c = colorsFor(dark)
    ctx.font = "10px 'JetBrains Mono', ui-monospace, monospace"
    ctx.textBaseline = 'top'
    for (const t of niceTicks(pxPerSecond, durationSec)) {
      const x = t.time * pxPerSecond
      ctx.strokeStyle = t.major ? c.ruler : c.rulerMinor
      ctx.beginPath()
      ctx.moveTo(x + 0.5, t.major ? h - 9 : h - 4)
      ctx.lineTo(x + 0.5, h)
      ctx.stroke()
      if (t.major) {
        ctx.fillStyle = c.rulerLabel
        ctx.fillText(formatTick(t.time, pxPerSecond), x + 3, 2)
      }
    }
  }, [pxPerSecond, durationSec, contentWidth, dark])

  return <canvas ref={ref} aria-hidden style={{ width: contentWidth }} className="block h-full" />
}
