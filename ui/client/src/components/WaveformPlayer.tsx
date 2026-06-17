import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'

export interface PlayerHandle {
  toggle: () => void
  playEn: () => void
}

interface Peaks { durationSec: number; detail: number[]; overview: number[] }

interface Props {
  audioUrl: string
  peaksUrl: string
  enUrl?: string | null // self-contained EN clip for this segment (stops on `ended`)
  autoPlay?: boolean
  mainLabel?: string // label for the primary track button (default "дубляж")
}

/**
 * Lightweight player: a streaming <audio> (Range-backed) + a canvas waveform
 * drawn from server-computed peaks (no client-side decode). "Оригінал" plays a
 * server-trimmed EN clip exactly the segment's length — it stops by itself
 * (the `ended` event), and clicking again toggles it off. No seeking or timers.
 */
export const WaveformPlayer = forwardRef<PlayerHandle, Props>(function WaveformPlayer(
  { audioUrl, peaksUrl, enUrl, autoPlay, mainLabel = 'дубляж' }, ref,
) {
  const dubRef = useRef<HTMLAudioElement>(null)
  const enRef = useRef<HTMLAudioElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [peaks, setPeaks] = useState<Peaks | null>(null)
  const [playing, setPlaying] = useState(false)
  const [enPlaying, setEnPlaying] = useState(false)
  const [pos, setPos] = useState(0) // 0..1

  useEffect(() => {
    let alive = true
    setPeaks(null)
    fetch(peaksUrl)
      .then((r) => r.json())
      .then((d) => { if (alive && d && d.detail) setPeaks(d) })
      .catch(() => {})
    return () => { alive = false }
  }, [peaksUrl])

  // draw waveform + progress
  useEffect(() => {
    const cv = canvasRef.current
    if (!cv) return
    const dpr = window.devicePixelRatio || 1
    const w = cv.clientWidth, h = cv.clientHeight
    cv.width = w * dpr; cv.height = h * dpr
    const ctx = cv.getContext('2d')!
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, w, h)
    const data = peaks?.detail ?? []
    const mid = h / 2
    const playedX = pos * w
    for (let x = 0; x < w; x++) {
      const i = Math.floor((x / w) * data.length)
      const amp = (data[i] ?? 0) * (h / 2) * 0.95
      ctx.strokeStyle = x <= playedX ? '#1c2024' : '#c7ccd1'
      ctx.beginPath()
      ctx.moveTo(x + 0.5, mid - amp)
      ctx.lineTo(x + 0.5, mid + amp)
      ctx.stroke()
    }
  }, [peaks, pos])

  // dub track: cursor + play state
  useEffect(() => {
    const a = dubRef.current
    if (!a) return
    let raf = 0
    const tick = () => {
      if (a.duration) setPos(a.currentTime / a.duration)
      raf = requestAnimationFrame(tick)
    }
    const onPlay = () => { setPlaying(true); raf = requestAnimationFrame(tick) }
    const onPause = () => { setPlaying(false); cancelAnimationFrame(raf) }
    const onEnd = () => { setPlaying(false); setPos(0); cancelAnimationFrame(raf) }
    a.addEventListener('play', onPlay)
    a.addEventListener('pause', onPause)
    a.addEventListener('ended', onEnd)
    return () => {
      a.removeEventListener('play', onPlay); a.removeEventListener('pause', onPause); a.removeEventListener('ended', onEnd)
      cancelAnimationFrame(raf)
    }
  }, [audioUrl])

  // EN clip: track play state for the toggle button label
  useEffect(() => {
    const a = enRef.current
    if (!a) return
    const on = () => setEnPlaying(true)
    const off = () => setEnPlaying(false)
    a.addEventListener('play', on)
    a.addEventListener('pause', off)
    a.addEventListener('ended', off)
    return () => {
      a.removeEventListener('play', on); a.removeEventListener('pause', off); a.removeEventListener('ended', off)
    }
  }, [enUrl])

  useEffect(() => {
    if (autoPlay) dubRef.current?.play().catch(() => {})
  }, [audioUrl, autoPlay])

  function toggle() {
    const a = dubRef.current; if (!a) return
    enRef.current?.pause()
    if (a.paused) a.play().catch(() => {}); else a.pause()
  }

  function playEn() {
    const a = enRef.current; if (!a) return
    if (!a.paused) { a.pause(); a.currentTime = 0; return } // toggle off
    dubRef.current?.pause()
    a.currentTime = 0
    a.play().catch(() => {})
  }

  useImperativeHandle(ref, () => ({ toggle, playEn }))

  function seek(e: React.MouseEvent<HTMLCanvasElement>) {
    const a = dubRef.current; if (!a || !a.duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    a.currentTime = ((e.clientX - rect.left) / rect.width) * a.duration
  }

  return (
    <div className="rounded-md border border-gray-200 p-2">
      <canvas ref={canvasRef} onClick={seek} className="h-16 w-full cursor-pointer rounded bg-gray-50" />
      <div className="mt-2 flex items-center gap-2">
        <button onClick={toggle} className="rounded bg-gray-900 px-3 py-1 text-sm text-white hover:bg-gray-700">
          {playing ? '⏸' : '▶'} <span className="ml-1">{mainLabel}</span>
        </button>
        {enUrl && (
          <button onClick={playEn} className="rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-100" title="клавіша E">
            {enPlaying ? '⏸' : '▶'} оригінал
          </button>
        )}
        <span className="ml-auto text-xs text-gray-400">{peaks ? `${peaks.durationSec.toFixed(1)}с` : '…'}</span>
      </div>
      <audio ref={dubRef} src={audioUrl} preload="none" />
      {enUrl && <audio ref={enRef} src={enUrl} preload="none" />}
    </div>
  )
})
