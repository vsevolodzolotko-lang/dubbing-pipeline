import { useEffect, useLayoutEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { NUDGE_MS, NUDGE_SETTLE_MS, NUDGE_SHIFT_MS, SNAP_PX } from '../lib/constants'
import { clampEdge, clampMove } from '../lib/clamp'
import { snapToWords } from '../lib/snap'
import { formatTime } from '../lib/time'
import { useSegmentDrag } from './useSegmentDrag'
import type { EdgeSide, Times } from './types'
import type { Word } from '../../../api/staged'

const MOVE_THRESHOLD_PX = 3 // px the pointer must travel before a click becomes a move

const shortId = (id: string) => id.replace(/^.*_seg_/, 'seg ')

interface VP {
  pxPerSecond: number
  timeToX: (t: number) => number
  xToTime: (x: number) => number
  clientXToContentX: (clientX: number) => number
}

export interface EdgeEditingOpts {
  segId: string
  editable: boolean
  vp: VP
  durationSec: number
  readoutRef: RefObject<HTMLDivElement | null>
  current: () => Times
  bounds: () => { prevEnd: number; nextStart: number }
  getWords: (id: string) => Promise<Word[]>
  commit: (times: Times) => void
  setDragging: (b: boolean) => void
  announce: (msg: string) => void
  /** Called when a body-drag (move) actually starts — e.g. to select the segment. */
  onGrab?: () => void
}

/**
 * Shared edge-retime behaviour for a timeline block: pointer-capture drag (live
 * preview written to the element, snap-to-word, clamp, one commit on release) +
 * coalesced keyboard nudge + the layout-effect that re-applies the preview before
 * paint so a mid-gesture re-render can't snap the edge back. Used by both the
 * transcript SegmentBlock and the audio AudioSegmentBlock.
 */
export function useEdgeEditing(o: EdgeEditingOpts) {
  const oRef = useRef(o)
  oRef.current = o
  const blockRef = useRef<HTMLDivElement>(null)
  const gesturing = useRef(false)
  const preview = useRef<Times | null>(null)

  const startEdge = useSegmentDrag({
    segId: o.segId, blockRef, readoutRef: o.readoutRef, gesturingRef: gesturing, previewRef: preview,
    current: o.current, bounds: o.bounds, durationSec: o.durationSec,
    pxPerSecond: o.vp.pxPerSecond, timeToX: o.vp.timeToX, xToTime: o.vp.xToTime,
    clientXToContentX: o.vp.clientXToContentX, getWords: o.getWords, onCommit: o.commit, setDragging: o.setDragging,
  })

  const burstStart = useRef<Times | null>(null)
  const lastTimes = useRef<Times | null>(null)
  const timer = useRef<number | null>(null)
  function nudge(side: EdgeSide, deltaSec: number) {
    if (!o.editable) return
    if (!burstStart.current) { burstStart.current = o.current(); o.setDragging(true) }
    const base = lastTimes.current ?? burstStart.current
    const { prevEnd, nextStart } = o.bounds()
    const edgeT = (side === 'start' ? base.start : base.end) + deltaSec
    const next = clampEdge(base, side, edgeT, prevEnd, nextStart, o.durationSec)
    lastTimes.current = next
    gesturing.current = true
    preview.current = next
    const el = blockRef.current
    if (el) { const x = o.vp.timeToX(next.start); el.style.transform = `translateX(${x}px)`; el.style.width = `${Math.max(2, o.vp.timeToX(next.end) - x)}px` }
    o.announce(`${shortId(o.segId)}: ${formatTime(next.start)}–${formatTime(next.end)}`)
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      const final = lastTimes.current
      burstStart.current = null; lastTimes.current = null; timer.current = null
      gesturing.current = false; preview.current = null
      if (final) o.commit(final)
    }, NUDGE_SETTLE_MS)
  }
  const onHandleKey = (side: EdgeSide) => (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const dir = e.key === 'ArrowLeft' ? -1 : 1
    nudge(side, (dir * (e.shiftKey ? NUDGE_SHIFT_MS : NUDGE_MS)) / 1000)
  }

  // Body drag → slide the whole segment (both edges by the same delta). A click
  // (no movement past MOVE_THRESHOLD_PX) is left to the block's onClick (select).
  function startMove(e: React.PointerEvent) {
    if (!oRef.current.editable) return
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const startContentX = oRef.current.vp.clientXToContentX(e.clientX)
    const startTimes = oRef.current.current()
    let words: Word[] = []
    oRef.current.getWords(oRef.current.segId).then((w) => { words = w })
    let moving = false
    let latest = startTimes
    let raf = 0
    const onMove = (ev: PointerEvent) => {
      const o2 = oRef.current
      const dx = o2.vp.clientXToContentX(ev.clientX) - startContentX
      if (!moving) {
        if (Math.abs(dx) < MOVE_THRESHOLD_PX) return
        moving = true
        gesturing.current = true
        o2.setDragging(true)
        o2.onGrab?.()
      }
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const c = oRef.current
        const rawStart = startTimes.start + c.vp.xToTime(dx)
        const snapStart = ev.altKey ? rawStart : snapToWords(rawStart, words, SNAP_PX, c.vp.pxPerSecond).time
        const { prevEnd, nextStart } = c.bounds()
        latest = clampMove(startTimes, snapStart - startTimes.start, prevEnd, nextStart, c.durationSec)
        preview.current = latest
        const px = c.vp.timeToX(latest.start)
        if (blockRef.current) blockRef.current.style.transform = `translateX(${px}px)`
        const r = c.readoutRef.current
        if (r) { r.textContent = `${formatTime(latest.start)}–${formatTime(latest.end)}`; r.style.transform = `translateX(${px}px)`; r.style.opacity = '1' }
      })
    }
    const end = () => {
      cancelAnimationFrame(raf)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', end)
      el.removeEventListener('pointercancel', end)
      el.removeEventListener('lostpointercapture', end)
      const r = oRef.current.readoutRef.current
      if (r) r.style.opacity = '0'
      if (moving) {
        gesturing.current = false
        preview.current = null
        oRef.current.commit(latest)
      }
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', end, { once: true })
    el.addEventListener('pointercancel', end, { once: true })
    el.addEventListener('lostpointercapture', end, { once: true })
  }

  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current) }, [])

  useLayoutEffect(() => {
    if (!gesturing.current || !preview.current) return
    const el = blockRef.current
    if (!el) return
    const px = o.vp.timeToX(preview.current.start)
    el.style.transform = `translateX(${px}px)`
    el.style.width = `${Math.max(2, o.vp.timeToX(preview.current.end) - px)}px`
  })

  return { blockRef, startEdge, onHandleKey, startMove }
}
