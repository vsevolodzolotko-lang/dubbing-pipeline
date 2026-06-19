import { useCallback } from 'react'

/**
 * Reference video (reference-only — never edited). objectURL or a dashed
 * placeholder. Reports the element (callback ref) so the clock/playhead can read
 * it, and the clip duration once metadata loads.
 */
export function VideoReference({ videoUrl, onVideoEl, onDuration }: {
  videoUrl: string | null
  onVideoEl: (el: HTMLVideoElement | null) => void
  onDuration: (d: number) => void
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
      <div className="mb-2 rounded-md border border-dashed border-gray-300 p-4 text-center text-xs text-gray-400 dark:border-[#3a3a3d]">
        відео-референс не додано — додай його при дропі уроку
      </div>
    )
  }
  return <video ref={setRef} src={videoUrl} controls muted playsInline className="mb-2 max-h-56 w-full rounded bg-black" />
}
