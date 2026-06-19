import { useEffect, useRef } from 'react'

/**
 * Drives a per-frame callback from `<video>.currentTime` while playing, plus a
 * single tick on seek/pause. rAF (not the coarse `timeupdate` event) → smooth
 * 60fps playhead. Pass the resolved element (not a ref) so the effect re-attaches
 * when the <video> mounts/unmounts. The callback may be inline (kept in a ref).
 */
export function useVideoClock(video: HTMLVideoElement | null, onTick: (t: number) => void) {
  const cb = useRef(onTick)
  cb.current = onTick

  useEffect(() => {
    if (!video) { cb.current(0); return }
    let raf = 0
    const loop = () => { cb.current(video.currentTime); raf = requestAnimationFrame(loop) }
    const start = () => { cancelAnimationFrame(raf); loop() }
    const stop = () => cancelAnimationFrame(raf)
    const once = () => cb.current(video.currentTime)
    video.addEventListener('play', start)
    video.addEventListener('pause', stop)
    video.addEventListener('ended', stop)
    video.addEventListener('seeked', once)
    // While paused (native-scrub / programmatic seek) the rAF loop is off, so
    // track coarse updates too — only rAF DRIVES playback, this just supplements.
    video.addEventListener('timeupdate', once)
    once()
    return () => {
      cancelAnimationFrame(raf)
      video.removeEventListener('play', start)
      video.removeEventListener('pause', stop)
      video.removeEventListener('ended', stop)
      video.removeEventListener('seeked', once)
      video.removeEventListener('timeupdate', once)
    }
  }, [video])
}
