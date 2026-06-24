import { useCallback } from 'react'
import { clamp } from '../lib/geometry'

/**
 * Pointer-capture scrub: pointerdown seeks the reference video to the clicked
 * time, dragging keeps seeking. Used on the ruler and the empty lane background.
 * No-op when there is no video.
 */
export function useScrub(
  video: HTMLVideoElement | null,
  clientXToContentX: (clientX: number) => number,
  xToTime: (x: number) => number,
  durationSec: number,
) {
  return useCallback((e: React.PointerEvent) => {
    if (!video) return
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const seek = (clientX: number) => {
      const t = clamp(xToTime(clientXToContentX(clientX)), 0, durationSec)
      try { video.currentTime = Math.min(t, video.duration || t) } catch { /* */ }
    }
    seek(e.clientX)
    const onMove = (ev: PointerEvent) => seek(ev.clientX)
    const end = () => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', end)
      el.removeEventListener('pointercancel', end)
      el.removeEventListener('lostpointercapture', end)
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', end, { once: true })
    el.addEventListener('pointercancel', end, { once: true })
    el.addEventListener('lostpointercapture', end, { once: true })
  }, [video, clientXToContentX, xToTime, durationSec])
}
