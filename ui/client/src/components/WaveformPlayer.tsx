import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Pause, Play } from 'lucide-react'
import { useRunMedia } from '../api/runMedia'

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
  videoStartSec?: number | null // segment's absolute start in the reference video → synced clip
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
  { audioUrl, peaksUrl, enUrl, enPeaksUrl, videoStartSec, autoPlay, mainLabel = 'localization' }, ref,
) {
  const { videoUrl } = useRunMedia()
  const dubRef = useRef<HTMLAudioElement>(null)
  const enRef = useRef<HTMLAudioElement>(null)
  const vidRef = useRef<HTMLVideoElement>(null)
  const vStart = videoStartSec || 0
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const enCanvasRef = useRef<HTMLCanvasElement>(null)
  const [peaks, setPeaks] = useState<Peaks | null>(null)
  const [enPeaks, setEnPeaks] = useState<Peaks | null>(null)
  const [playing, setPlaying] = useState(false)
  const [enPlaying, setEnPlaying] = useState(false)
  const [pos, setPos] = useState(0) // 0..1 within the dub clip
  const [enPos, setEnPos] = useState(0) // 0..1 within the EN clip
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
    const enFrac = (enPeaks?.durationSec || 0) / maxDur
    const slotFrac = dual && enPeaks ? enFrac : null
    drawWave(canvasRef.current, peaks, dubFrac, pos, slotFrac)
    if (dual) drawWave(enCanvasRef.current, enPeaks, enFrac, enPos, null)
  }, [peaks, enPeaks, pos, enPos, dual])

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
    let raf = 0
    const tick = () => { if (a.duration) setEnPos(a.currentTime / a.duration); raf = requestAnimationFrame(tick) }
    // The EN clip == the segment's original audio, so the reference video tracks
    // it: play/pause/seek the EN clip drives the video to the matching frame.
    const onPlay = () => {
      setEnPlaying(true)
      const v = vidRef.current; if (v) { try { v.currentTime = vStart + a.currentTime } catch { /* */ } v.play().catch(() => {}) }
      raf = requestAnimationFrame(tick)
    }
    const onPause = () => { setEnPlaying(false); vidRef.current?.pause(); cancelAnimationFrame(raf) }
    const onEnd = () => { setEnPlaying(false); setEnPos(0); vidRef.current?.pause(); cancelAnimationFrame(raf) }
    a.addEventListener('play', onPlay); a.addEventListener('pause', onPause); a.addEventListener('ended', onEnd)
    return () => { a.removeEventListener('play', onPlay); a.removeEventListener('pause', onPause); a.removeEventListener('ended', onEnd); cancelAnimationFrame(raf) }
  }, [enUrl, videoUrl, vStart])

  // park the reference video on this segment's first frame when it changes
  useEffect(() => {
    const v = vidRef.current; if (!v) return
    const set = () => { try { v.currentTime = vStart } catch { /* */ } }
    if (v.readyState >= 1) set(); else { v.addEventListener('loadedmetadata', set, { once: true }); return () => v.removeEventListener('loadedmetadata', set) }
  }, [videoUrl, vStart])

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

  // Click a waveform → seek to that point and play that track (pausing the other).
  // Both waves share one time scale, so each occupies `frac` of its canvas width;
  // clicks past the clip end are ignored.
  function seekAt(kind: 'dub' | 'en', e: React.MouseEvent<HTMLCanvasElement>) {
    const isEn = kind === 'en'
    const a = isEn ? enRef.current : dubRef.current
    if (!a) return
    const rect = e.currentTarget.getBoundingClientRect()
    const clickFrac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    const maxDur = dual ? Math.max(peaks?.durationSec || 0, enPeaks?.durationSec || 0) || 1 : (peaks?.durationSec || 1)
    const frac = isEn ? (enPeaks?.durationSec || 0) / maxDur : (dual ? (peaks?.durationSec || 0) / maxDur : 1)
    if (frac <= 0 || clickFrac > frac) return // clicked the empty area past this clip
    const within = Math.min(1, clickFrac / frac)
    const dur = a.duration || (isEn ? enPeaks?.durationSec : peaks?.durationSec) || 0
    if (dur) a.currentTime = within * dur
    if (isEn) {
      dubRef.current?.pause(); setEnPos(within)
      const v = vidRef.current; if (v && dur) { try { v.currentTime = vStart + within * dur } catch { /* */ } }
    } else { enRef.current?.pause(); setPos(within) }
    a.play().catch(() => {})
  }

  return (
    <div className="rounded-md border border-gray-200 p-2 dark:border-[#3a3a3d]">
      {dual && videoUrl && (
        <div className="mb-1">
          <div className="mb-0.5 text-[11px] text-gray-400">reference video (plays in sync with the original)</div>
          <video ref={vidRef} src={videoUrl} muted playsInline controls className="max-h-40 w-full rounded bg-black" />
        </div>
      )}
      {dual && (
        <div className="mb-1">
          <div className="mb-0.5 flex items-center justify-between text-[11px] text-gray-400">
            <span>original (EN)</span>
            <span>{enPeaks ? `${enPeaks.durationSec.toFixed(1)}s` : '…'}</span>
          </div>
          <canvas ref={enCanvasRef} onClick={(e) => seekAt('en', e)} className="h-10 w-full cursor-pointer rounded bg-gray-50 dark:bg-[#202023]" />
        </div>
      )}
      {dual && <div className="mb-0.5 text-[11px] text-gray-400">localization{enPeaks && peaks && peaks.durationSec > enPeaks.durationSec ? ' · exceeds slot' : ''}</div>}
      <canvas ref={canvasRef} onClick={(e) => seekAt('dub', e)} className="h-16 w-full cursor-pointer rounded bg-gray-50 dark:bg-[#202023]" />
      <div className="mt-2 flex items-center gap-2">
        <button onClick={toggle} className="rounded bg-gray-900 px-3 py-1 text-sm text-white hover:bg-gray-700 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white">
          {playing ? <Pause className="inline-block h-3.5 w-3.5 align-[-0.2em]" strokeWidth={1.75} /> : <Play className="inline-block h-3.5 w-3.5 align-[-0.2em]" strokeWidth={1.75} />} <span className="ml-1">{mainLabel}</span>
        </button>
        {enUrl && (
          <button onClick={playEn} className="rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-[#202023]" title="E key">
            {enPlaying ? <Pause className="inline-block h-3.5 w-3.5 align-[-0.2em]" strokeWidth={1.75} /> : <Play className="inline-block h-3.5 w-3.5 align-[-0.2em]" strokeWidth={1.75} />} original
          </button>
        )}
        {dual && <span className="text-[10px] text-amber-600 dark:text-amber-500">slot boundary</span>}
        <span className="ml-auto text-xs text-gray-400">{peaks ? `${peaks.durationSec.toFixed(1)}s` : '…'}</span>
      </div>
      <audio ref={dubRef} src={audioUrl} preload="metadata" />
      {enUrl && <audio ref={enRef} src={enUrl} preload="metadata" />}
    </div>
  )
})
