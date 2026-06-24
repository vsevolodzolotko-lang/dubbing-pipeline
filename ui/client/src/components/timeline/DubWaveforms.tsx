import { useEffect, useRef, useState } from 'react'
import { useCanvas2D } from './model/useCanvas2D'
import { useIsDark } from './model/useIsDark'
import type { Times } from './model/types'
import type { SegmentRow } from '../../api/types'

/**
 * Per-clip dub waveform layer for the audio timeline: fetches each localization's
 * generated audio peaks for the current language (cached by rowKey) and draws each
 * CLIP's source slice (`srcStart…srcEnd` of the peaks) at the clip's position, with
 * the clip's fade envelope baked into the amplitude — so the shape follows
 * cut/moved/trimmed/faded pieces.
 */
export function DubWaveforms({ segments, lang, getTimes, version, timeToX, contentWidth }: {
  segments: SegmentRow[]
  lang: string
  getTimes: (id: string) => Times
  version: unknown // model.version — bumps when committed times change → repaint
  timeToX: (t: number) => number
  contentWidth: number
}) {
  const dark = useIsDark()
  const cache = useRef<Map<string, number[]>>(new Map())
  const [loaded, setLoaded] = useState(0)

  useEffect(() => {
    let alive = true
    const rowKeys = segments
      .map((s) => s.cells[lang]?.rowKey)
      .filter((rk): rk is string => Boolean(rk) && !cache.current.has(rk as string))
    if (!rowKeys.length) return
    Promise.allSettled(rowKeys.map((rk) =>
      fetch(`/api/peaks/segment/${rk}`)
        .then((r) => r.json())
        .then((d) => { if (d && Array.isArray(d.detail)) cache.current.set(rk, d.detail) })
        .catch(() => {}),
    )).then(() => { if (alive) setLoaded((v) => v + 1) })
    return () => { alive = false }
  }, [segments, lang])

  const ref = useCanvas2D((ctx, _w, h) => {
    ctx.strokeStyle = dark ? '#94a3b8' : '#64748b'
    const mid = h / 2
    for (const s of segments) {
      const cell = s.cells[lang]
      const detail = cell?.rowKey ? cache.current.get(cell.rowKey) : null
      if (!detail || !detail.length || !cell?.clips) continue
      for (const clip of cell.clips) {
        const t = getTimes(clip.id)
        const x0 = timeToX(t.start)
        const bw = Math.max(1, timeToX(t.end) - x0)
        // Map the clip's source window onto the source peaks (detail array).
        const sourceDur = Math.max(0.001, clip.sourceDur)
        const i0 = (clip.srcStart / sourceDur) * detail.length
        const i1 = (clip.srcEnd / sourceDur) * detail.length
        // Fade envelope in clip-local px.
        const clipLen = Math.max(0.001, t.end - t.start)
        const fadeInPx = Math.min(bw, (clip.fadeIn / clipLen) * bw)
        const fadeOutPx = Math.min(bw, (clip.fadeOut / clipLen) * bw)
        for (let x = 0; x < bw; x++) {
          const di = Math.floor(i0 + (x / bw) * (i1 - i0))
          let gain = 1
          if (fadeInPx > 0 && x < fadeInPx) gain = x / fadeInPx
          if (fadeOutPx > 0 && x > bw - fadeOutPx) gain = Math.min(gain, (bw - x) / fadeOutPx)
          const amp = (detail[di] ?? 0) * (h / 2) * 0.8 * gain
          const px = x0 + x + 0.5
          ctx.beginPath(); ctx.moveTo(px, mid - amp); ctx.lineTo(px, mid + amp); ctx.stroke()
        }
      }
    }
  }, [segments, lang, loaded, contentWidth, dark, version])

  return <canvas ref={ref} aria-hidden style={{ width: contentWidth }} className="pointer-events-none absolute inset-0 z-0 h-full" />
}
