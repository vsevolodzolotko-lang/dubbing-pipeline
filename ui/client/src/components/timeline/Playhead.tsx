import { useRef } from 'react'
import type { RefObject } from 'react'
import { useVideoClock } from './model/useVideoClock'

/**
 * Playhead on its own overlay layer: moved via translateX every animation frame
 * from `<video>.currentTime` — never repaints the waveform/ruler canvases. During
 * playback it nudges the scroll so the playhead stays on screen (instant jump, so
 * it is inherently reduced-motion friendly).
 */
export function Playhead({ video, pxPerSecond, scrollerRef }: {
  video: HTMLVideoElement | null
  pxPerSecond: number
  scrollerRef: RefObject<HTMLDivElement | null>
}) {
  const ref = useRef<HTMLDivElement>(null)
  useVideoClock(video, (t) => {
    const el = ref.current
    if (!el) return
    const x = t * pxPerSecond
    el.style.transform = `translateX(${x}px)`
    const sc = scrollerRef.current
    if (sc && video && !video.paused) {
      const left = x - sc.scrollLeft
      if (left > sc.clientWidth * 0.8 || left < 0) sc.scrollLeft = Math.max(0, x - sc.clientWidth * 0.5)
    }
  })
  return (
    <div ref={ref} aria-hidden style={{ transform: 'translateX(0px)' }}
      className="pointer-events-none absolute top-0 bottom-0 left-0 z-20 w-0.5 bg-amber-500" />
  )
}
