import { useEffect, useRef, type RefObject } from 'react'
import { colorsFor } from './lib/colors'
import { niceTicks } from './lib/ticks'
import { formatTick } from './lib/time'
import { useIsDark } from './model/useIsDark'

/**
 * Crisp time ruler. Unlike a full-width canvas (which, on a long lesson zoomed in,
 * exceeds the browser's backing-store limit and degrades to a blurry sub-1×-DPR
 * bitmap), this renders ONLY the visible viewport: a viewport-sized canvas pinned
 * to the scroller's left edge (position: sticky), repainted at full devicePixelRatio
 * on scroll/zoom/resize. Ticks are drawn at `time·pxPerSecond − scrollLeft`.
 * pointer-events:none so the row underneath still scrubs the video.
 */
export function WindowedRuler({ scrollerRef, pxPerSecond, durationSec }: {
  scrollerRef: RefObject<HTMLDivElement | null>
  pxPerSecond: number
  durationSec: number
}) {
  const dark = useIsDark()
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const sc = scrollerRef.current
    const cv = ref.current
    if (!sc || !cv) return
    let raf = 0
    const paint = () => {
      const cssW = sc.clientWidth
      const cssH = cv.clientHeight || cv.parentElement?.clientHeight || 0
      if (!cssW || !cssH) return
      const dpr = window.devicePixelRatio || 1
      cv.width = Math.round(cssW * dpr)
      cv.height = Math.round(cssH * dpr)
      cv.style.width = `${cssW}px`
      const ctx = cv.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, cssW, cssH)
      const c = colorsFor(dark)
      ctx.font = "10px 'JetBrains Mono', ui-monospace, monospace"
      ctx.textBaseline = 'top'
      const scrollLeft = sc.scrollLeft
      for (const t of niceTicks(pxPerSecond, durationSec)) {
        const x = t.time * pxPerSecond - scrollLeft
        if (x < -48 || x > cssW + 48) continue // cull off-screen ticks
        ctx.strokeStyle = t.major ? c.ruler : c.rulerMinor
        ctx.beginPath()
        ctx.moveTo(x + 0.5, t.major ? cssH - 9 : cssH - 4)
        ctx.lineTo(x + 0.5, cssH)
        ctx.stroke()
        if (t.major) {
          ctx.fillStyle = c.rulerLabel
          ctx.fillText(formatTick(t.time, pxPerSecond), x + 3, 2)
        }
      }
    }
    const schedule = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(paint) }
    paint()
    sc.addEventListener('scroll', schedule, { passive: true })
    const ro = new ResizeObserver(schedule)
    ro.observe(sc)
    const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`)
    mq.addEventListener?.('change', schedule)
    return () => {
      cancelAnimationFrame(raf)
      sc.removeEventListener('scroll', schedule)
      ro.disconnect()
      mq.removeEventListener?.('change', schedule)
    }
  }, [scrollerRef, pxPerSecond, durationSec, dark])

  return <canvas ref={ref} aria-hidden className="pointer-events-none block h-full" style={{ position: 'sticky', left: 0 }} />
}
