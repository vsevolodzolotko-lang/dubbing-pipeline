import { useEffect, useRef, useState } from 'react'
import { useCanvas2D } from './model/useCanvas2D'
import { useIsDark } from './model/useIsDark'
import type { Times } from './model/types'
import type { SegmentRow } from '../../api/types'

/**
 * Per-segment dub waveform layer for the audio timeline: fetches each segment's
 * generated audio peaks for the current language (cached by rowKey) and draws
 * them into each slot region on one canvas behind the (translucent) blocks — so
 * you see the actual generated audio shape per segment.
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
      const detail = s.cells[lang]?.rowKey ? cache.current.get(s.cells[lang]!.rowKey!) : null
      if (!detail || !detail.length) continue
      const t = getTimes(s.segmentId)
      const x0 = timeToX(t.start)
      const bw = Math.max(1, timeToX(t.end) - x0)
      for (let x = 0; x < bw; x++) {
        const amp = (detail[Math.floor((x / bw) * detail.length)] ?? 0) * (h / 2) * 0.8
        const px = x0 + x + 0.5
        ctx.beginPath(); ctx.moveTo(px, mid - amp); ctx.lineTo(px, mid + amp); ctx.stroke()
      }
    }
  }, [segments, lang, loaded, contentWidth, dark, version])

  return <canvas ref={ref} aria-hidden style={{ width: contentWidth }} className="pointer-events-none absolute inset-0 z-0 h-full" />
}
