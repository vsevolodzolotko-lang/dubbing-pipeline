import { useEffect, useRef } from 'react'

/**
 * DPR-aware canvas. Sizes the backing store to devicePixelRatio (crisp on HiDPI
 * and after a monitor move), clears, and calls `draw` in CSS pixels. Repaints on
 * `deps` change, on container resize (ResizeObserver), and on DPR change. The
 * latest `draw` closure is always used via a ref, so it need not be memoised.
 */
export function useCanvas2D(
  draw: (ctx: CanvasRenderingContext2D, cssW: number, cssH: number) => void,
  deps: unknown[],
) {
  const ref = useRef<HTMLCanvasElement>(null)
  const drawRef = useRef(draw)
  drawRef.current = draw

  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    let raf = 0
    const MAX_DIM = 16384 // backing-store ceiling (Safari is the tightest); avoid a blank canvas at extreme zoom
    const paint = () => {
      const cssW = cv.clientWidth
      const cssH = cv.clientHeight
      // Cap effective DPR so the backing store never exceeds the browser limit
      // (full-width canvas, no virtualization — degrades to slight blur, not blank).
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DIM / Math.max(1, cssW), MAX_DIM / Math.max(1, cssH))
      cv.width = Math.max(1, Math.round(cssW * dpr))
      cv.height = Math.max(1, Math.round(cssH * dpr))
      const ctx = cv.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, cssW, cssH)
      drawRef.current(ctx, cssW, cssH)
    }
    const schedule = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(paint) }
    paint()

    const ro = new ResizeObserver(schedule)
    ro.observe(cv)
    const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`)
    mq.addEventListener?.('change', schedule)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      mq.removeEventListener?.('change', schedule)
    }
  }, deps) // eslint-disable-line react-hooks/exhaustive-deps

  return ref
}
