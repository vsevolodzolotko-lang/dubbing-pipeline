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
  enPeaksUrl?: string | null // when set → dual view: EN waveform stacked above the dub
  autoPlay?: boolean
  mainLabel?: string // label for the primary track button (default "дубляж")
}

function colors() {
  const dark = document.documentElement.classList.contains('dark')
  return {
    played: dark ? '#e5e7eb' : '#1c2024',
    unplayed: dark ? '#3f4651' : '#c7ccd1',
    slot: dark ? '#f59e0b' : '#d97706',
  }
}

// Draw a waveform into `cv`. The wave occupies `widthFrac` of the canvas width
// (so two waves can share one time scale). `played` (0..1) colors progress.
// `slotFrac` (0..1 of full width) draws the original-slot boundary line.
function drawWave(cv: HTMLCanvasElement | null, peaks: Peaks | null, widthFrac: number, played: number, slotFrac: number | null) {
  if (!cv) return
  const dpr = window.devicePixelRatio || 1
  const w = cv.clientWidth, h = cv.clientHeight
  cv.width = w * dpr; cv.height = h * dpr
  const ctx = cv.getContext('2d')!
  ctx.scale(dpr, dpr)
  ctx.clearRect(0, 0, w, h)
  const c = colors()
  const data = peaks?.detail ?? []
  const mid = h / 2
  const drawW = Math.max(1, widthFrac * w)
  const playedX = played * drawW
  for (let x = 0; x < drawW; x++) {
    const i = Math.floor((x / drawW) * data.length)
    const amp = (data[i] ?? 0) * (h / 2) * 0.95
    ctx.strokeStyle = x <= playedX ? c.played : c.unplayed
    ctx.beginPath()
    ctx.moveTo(x + 0.5, mid - amp)
    ctx.lineTo(x + 0.5, mid + amp)
    ctx.stroke()
  }
  if (slotFrac != null && slotFrac > 0 && slotFrac < 1) {
    ctx.strokeStyle = c.slot
    ctx.setLineDash([3, 3])
    ctx.beginPath(); ctx.moveTo(slotFrac * w, 0); ctx.lineTo(slotFrac * w, h); ctx.stroke()
    ctx.setLineDash([])
  }
}

/**
 * Waveform player. Single mode: one dub waveform + play + "оригінал" clip button.
 * Dual mode (enPeaksUrl set): EN waveform stacked above the dub waveform on a
 * shared time scale, with the original-slot boundary marked — so you can see how
 * the localized audio sits relative to the original (lead silence, overshoot/borrow).
 */
export const WaveformPlayer = forwardRef<PlayerHandle, Props>(function WaveformPlayer(
  { audioUrl, peaksUrl, enUrl, enPeaksUrl, autoPlay, mainLabel = 'дубляж' }, ref,
) {
  const dubRef = useRef<HTMLAudioElement>(null)
  const enRef = useRef<HTMLAudioElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const enCanvasRef = useRef<HTMLCanvasElement>(null)
  const [peaks, setPeaks] = useState<Peaks | null>(null)
  const [enPeaks, setEnPeaks] = useState<Peaks | null>(null)
  const [playing, setPlaying] = useState(false)
  const [enPlaying, setEnPlaying] = useState(false)
  const [pos, setPos] = useState(0) // 0..1 within the dub clip
  const dual = Boolean(enPeaksUrl)

  useEffect(() => {
    let alive = true; setPeaks(null)
    fetch(peaksUrl).then((r) => r.json()).then((d) => { if (alive && d && d.detail) setPeaks(d) }).catch(() => {})
    return () => { alive = false }
  }, [peaksUrl])

  useEffect(() => {
    if (!enPeaksUrl) { setEnPeaks(null); return }
    let alive = true; setEnPeaks(null)
    fetch(enPeaksUrl).then((r) => r.json()).then((d) => { if (alive && d && d.detail) setEnPeaks(d) }).catch(() => {})
    return () => { alive = false }
  }, [enPeaksUrl])

  // draw — shared time scale in dual mode (max of EN/dub durations)
  useEffect(() => {
    const maxDur = dual ? Math.max(peaks?.durationSec || 0, enPeaks?.durationSec || 0) || 1 : (peaks?.durationSec || 1)
    const dubFrac = dual ? (peaks?.durationSec || 0) / maxDur : 1
    const slotFrac = dual && enPeaks ? (enPeaks.durationSec / maxDur) : null
    drawWave(canvasRef.current, peaks, dubFrac, pos * dubFrac, slotFrac)
    if (dual) drawWave(enCanvasRef.current, enPeaks, (enPeaks?.durationSec || 0) / maxDur, 0, null)
  }, [peaks, enPeaks, pos, dual])

  useEffect(() => {
    const a = dubRef.current; if (!a) return
    let raf = 0
    const tick = () => { if (a.duration) setPos(a.currentTime / a.duration); raf = requestAnimationFrame(tick) }
    const onPlay = () => { setPlaying(true); raf = requestAnimationFrame(tick) }
    const onPause = () => { setPlaying(false); cancelAnimationFrame(raf) }
    const onEnd = () => { setPlaying(false); setPos(0); cancelAnimationFrame(raf) }
    a.addEventListener('play', onPlay); a.addEventListener('pause', onPause); a.addEventListener('ended', onEnd)
    return () => { a.removeEventListener('play', onPlay); a.removeEventListener('pause', onPause); a.removeEventListener('ended', onEnd); cancelAnimationFrame(raf) }
  }, [audioUrl])

  useEffect(() => {
    const a = enRef.current; if (!a) return
    const on = () => setEnPlaying(true), off = () => setEnPlaying(false)
    a.addEventListener('play', on); a.addEventListener('pause', off); a.addEventListener('ended', off)
    return () => { a.removeEventListener('play', on); a.removeEventListener('pause', off); a.removeEventListener('ended', off) }
  }, [enUrl])

  useEffect(() => { if (autoPlay) dubRef.current?.play().catch(() => {}) }, [audioUrl, autoPlay])

  function toggle() {
    const a = dubRef.current; if (!a) return
    enRef.current?.pause()
    if (a.paused) a.play().catch(() => {}); else a.pause()
  }
  function playEn() {
    const a = enRef.current; if (!a) return
    if (!a.paused) { a.pause(); a.currentTime = 0; return }
    dubRef.current?.pause(); a.currentTime = 0; a.play().catch(() => {})
  }
  useImperativeHandle(ref, () => ({ toggle, playEn }))

  function seek(e: React.MouseEvent<HTMLCanvasElement>) {
    const a = dubRef.current; if (!a || !a.duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    a.currentTime = ((e.clientX - rect.left) / rect.width) * a.duration
  }

  return (
    <div className="rounded-md border border-gray-200 p-2 dark:border-[#473d31]">
      {dual && (
        <div className="mb-1">
          <div className="mb-0.5 flex items-center justify-between text-[11px] text-gray-400">
            <span>оригінал (EN)</span>
            <span>{enPeaks ? `${enPeaks.durationSec.toFixed(1)}с` : '…'}</span>
          </div>
          <canvas ref={enCanvasRef} className="h-10 w-full rounded bg-gray-50 dark:bg-[#262019]" />
        </div>
      )}
      {dual && <div className="mb-0.5 text-[11px] text-gray-400">локалізація{enPeaks && peaks && peaks.durationSec > enPeaks.durationSec ? ' · виходить за слот →' : ''}</div>}
      <canvas ref={canvasRef} onClick={seek} className="h-16 w-full cursor-pointer rounded bg-gray-50 dark:bg-[#262019]" />
      <div className="mt-2 flex items-center gap-2">
        <button onClick={toggle} className="rounded bg-gray-900 px-3 py-1 text-sm text-white hover:bg-gray-700 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white">
          {playing ? '⏸' : '▶'} <span className="ml-1">{mainLabel}</span>
        </button>
        {enUrl && (
          <button onClick={playEn} className="rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-[#262019]" title="клавіша E">
            {enPlaying ? '⏸' : '▶'} оригінал
          </button>
        )}
        {dual && <span className="text-[10px] text-amber-600 dark:text-amber-500">┊ межа слота</span>}
        <span className="ml-auto text-xs text-gray-400">{peaks ? `${peaks.durationSec.toFixed(1)}с` : '…'}</span>
      </div>
      <audio ref={dubRef} src={audioUrl} preload="none" />
      {enUrl && <audio ref={enRef} src={enUrl} preload="none" />}
    </div>
  )
})
