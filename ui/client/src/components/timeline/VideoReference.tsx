import { useCallback } from 'react'

/**
 * Reference video (reference-only — never edited). objectURL or a dashed
 * placeholder. Reports the element (callback ref) so the clock/playhead can read
 * it, and the clip duration once metadata loads.
 */
export function VideoReference({ videoUrl, onVideoEl, onDuration, fill }: {
  videoUrl: string | null
  onVideoEl: (el: HTMLVideoElement | null) => void
  onDuration: (d: number) => void
  // fill: size to the parent box (object-contain) — landscape fills the width,
  // portrait is capped by height and stays narrow, and it never overflows/scrolls.
  fill?: boolean
}) {
  const setRef = useCallback((el: HTMLVideoElement | null) => {
    onVideoEl(el)
    if (el) {
      const set = () => onDuration(el.duration || 0)
      if (el.readyState >= 1) set()
      else el.addEventListener('loadedmetadata', set, { once: true })
    }
  }, [onVideoEl, onDuration])

  if (!videoUrl) {
    return (
      <div className={`rounded-md border border-dashed border-gray-300 p-4 text-center text-xs text-gray-400 dark:border-[#3a3a3d] ${fill ? 'flex h-full items-center justify-center' : 'mb-2'}`}>
        No reference video added — add it when dropping the lesson
      </div>
    )
  }
  if (fill) {
    return (
      // top-aligned so the (usually landscape) clip sits right under the header
      // instead of floating centered in a tall column; object-contain still caps
      // portrait clips by height so they never overflow.
      <div className="flex h-full w-full items-start justify-center">
        <video ref={setRef} src={videoUrl} controls muted playsInline
          className="max-h-full max-w-full rounded bg-black object-contain" />
      </div>
    )
  }
  return <video ref={setRef} src={videoUrl} controls muted playsInline className="mb-2 max-h-56 w-full rounded bg-black" />
}
