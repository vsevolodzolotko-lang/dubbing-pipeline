import { useCallback, useRef, useState } from 'react'
import {
  DEFAULT_PX_PER_SEC, MAX_PX_PER_SEC, MIN_PX_PER_SEC, ZOOM_FACTOR,
} from '../lib/constants'
import { clamp } from '../lib/geometry'

/**
 * Viewport model: `pxPerSecond` (zoom) + native scroll. Content width =
 * duration * pxPerSecond inside the `overflow-x:auto` scroller (`scrollerRef`).
 * Scroll position is read straight off the DOM (not state) so scrolling never
 * triggers a React render or a canvas repaint.
 */
export function useTimelineViewport(durationSec: number) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [pxPerSecond, setPps] = useState(DEFAULT_PX_PER_SEC)

  const contentWidth = Math.max(1, durationSec * pxPerSecond)

  const timeToX = useCallback((t: number) => t * pxPerSecond, [pxPerSecond])
  const xToTime = useCallback((x: number) => x / pxPerSecond, [pxPerSecond])

  /** clientX (e.g. a pointer event) → content X, accounting for scroll + offset. */
  const clientXToContentX = useCallback((clientX: number) => {
    const el = scrollerRef.current
    if (!el) return 0
    const rect = el.getBoundingClientRect()
    return clientX - rect.left + el.scrollLeft
  }, [])

  // Set zoom while keeping the time under `anchorClientX` (or the viewport
  // centre) stationary. scrollLeft is applied after layout via rAF.
  const setZoom = useCallback((nextPps: number, anchorClientX?: number) => {
    const el = scrollerRef.current
    const next = clamp(nextPps, MIN_PX_PER_SEC, MAX_PX_PER_SEC)
    if (!el) { setPps(next); return }
    const rect = el.getBoundingClientRect()
    const anchorPx = anchorClientX != null ? anchorClientX - rect.left : el.clientWidth / 2
    const tUnder = (anchorPx + el.scrollLeft) / pxPerSecond
    setPps(next)
    requestAnimationFrame(() => {
      const s = scrollerRef.current
      if (s) s.scrollLeft = tUnder * next - anchorPx
    })
  }, [pxPerSecond])

  const zoomBy = useCallback(
    (factor: number, anchorClientX?: number) => setZoom(pxPerSecond * factor, anchorClientX),
    [pxPerSecond, setZoom],
  )
  const zoomIn = useCallback((anchorClientX?: number) => zoomBy(ZOOM_FACTOR, anchorClientX), [zoomBy])
  const zoomOut = useCallback((anchorClientX?: number) => zoomBy(1 / ZOOM_FACTOR, anchorClientX), [zoomBy])

  /** Fit the whole clip into the visible viewport width. */
  const fit = useCallback(() => {
    const el = scrollerRef.current
    if (!el || durationSec <= 0) return
    const target = clamp((el.clientWidth - 8) / durationSec, MIN_PX_PER_SEC, MAX_PX_PER_SEC)
    setPps(target)
    requestAnimationFrame(() => { if (scrollerRef.current) scrollerRef.current.scrollLeft = 0 })
  }, [durationSec])

  return {
    scrollerRef,
    pxPerSecond,
    contentWidth,
    timeToX,
    xToTime,
    clientXToContentX,
    zoomIn,
    zoomOut,
    zoomBy,
    fit,
    canZoomIn: pxPerSecond < MAX_PX_PER_SEC,
    canZoomOut: pxPerSecond > MIN_PX_PER_SEC,
  }
}

export type Viewport = ReturnType<typeof useTimelineViewport>
