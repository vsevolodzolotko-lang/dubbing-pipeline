import { useCallback, useRef } from 'react'
import type { MutableRefObject, RefObject } from 'react'
import { SNAP_PX } from '../lib/constants'
import { clampEdge } from '../lib/clamp'
import { snapToWords } from '../lib/snap'
import { formatTime } from '../lib/time'
import type { EdgeSide, Times } from './types'
import type { Word } from '../../../api/staged'

export interface DragOpts {
  segId: string
  blockRef: RefObject<HTMLDivElement | null>
  readoutRef: RefObject<HTMLDivElement | null>
  /** Live-preview bridge so a mid-drag re-render re-applies the preview (not the
   *  committed `times` prop) before paint — see SegmentBlock's layout effect. */
  gesturingRef: MutableRefObject<boolean>
  previewRef: MutableRefObject<Times | null>
  /** Current committed times for this segment. */
  current: () => Times
  /** Neighbour bounds (prev.end / next.start) for clamping. */
  bounds: () => { prevEnd: number; nextStart: number }
  durationSec: number
  pxPerSecond: number
  timeToX: (t: number) => number
  xToTime: (x: number) => number
  clientXToContentX: (clientX: number) => number
  getWords: (id: string) => Promise<Word[]>
  onCommit: (times: Times) => void
  setDragging: (b: boolean) => void
}

/**
 * Pointer-capture edge drag for one block. Live preview is written DIRECTLY to
 * the block element (transform/width) and the floating readout — no React state
 * per frame, so the block list never re-renders during a drag. rAF-throttled;
 * Alt disables snap; commit fires once on pointerup. Always cleaned up on
 * up/cancel/lostpointercapture.
 */
export function useSegmentDrag(opts: DragOpts) {
  const ref = useRef(opts)
  ref.current = opts

  return useCallback((side: EdgeSide, e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const handle = e.currentTarget as HTMLElement
    handle.setPointerCapture(e.pointerId)
    ref.current.setDragging(true)
    ref.current.gesturingRef.current = true

    let latest = ref.current.current()
    ref.current.previewRef.current = latest
    let words: Word[] = []
    ref.current.getWords(ref.current.segId).then((w) => { words = w })
    let raf = 0

    const apply = (ev: PointerEvent) => {
      const o = ref.current
      let t = o.xToTime(o.clientXToContentX(ev.clientX))
      if (!ev.altKey) t = snapToWords(t, words, SNAP_PX, o.pxPerSecond).time
      const { prevEnd, nextStart } = o.bounds()
      latest = clampEdge(o.current(), side, t, prevEnd, nextStart, o.durationSec)
      o.previewRef.current = latest
      const el = o.blockRef.current
      if (el) {
        const x = o.timeToX(latest.start)
        el.style.transform = `translateX(${x}px)`
        el.style.width = `${Math.max(2, o.timeToX(latest.end) - x)}px`
      }
      const r = o.readoutRef.current
      if (r) {
        const edgeT = side === 'start' ? latest.start : latest.end
        r.textContent = formatTime(edgeT)
        r.style.transform = `translateX(${o.timeToX(edgeT)}px)`
        r.style.opacity = '1'
      }
    }
    const onMove = (ev: PointerEvent) => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => apply(ev)) }
    const end = () => {
      cancelAnimationFrame(raf)
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', end)
      handle.removeEventListener('pointercancel', end)
      handle.removeEventListener('lostpointercapture', end)
      const r = ref.current.readoutRef.current
      if (r) r.style.opacity = '0'
      ref.current.gesturingRef.current = false
      ref.current.previewRef.current = null
      ref.current.onCommit(latest)
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', end, { once: true })
    handle.addEventListener('pointercancel', end, { once: true })
    handle.addEventListener('lostpointercapture', end, { once: true })
  }, [])
}
