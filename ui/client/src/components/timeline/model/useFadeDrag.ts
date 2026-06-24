import { useRef } from 'react'

export interface Fades { fadeIn: number; fadeOut: number }
export type FadeSide = 'in' | 'out'

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/**
 * Drag a fade handle on an audio block: pointer-capture drag that writes a live
 * preview straight to the DOM (no per-frame React state) and commits the fade
 * seconds on release. Dragging the start handle right grows the fade-in; the end
 * handle left grows the fade-out. The two fades can't overlap — each is clamped so
 * their sum stays within the (per-language) slot length.
 */
export function useFadeDrag(o: {
  editable: boolean
  pxPerSecond: number
  /** current slot length in seconds (caps the fades) */
  slotSec: () => number
  /** current committed fades at gesture start */
  current: () => Fades
  /** paint a preview (block-local DOM mutation) */
  applyPreview: (f: Fades) => void
  /** persist the finished fade */
  commit: (f: Fades) => void
}) {
  const oRef = useRef(o)
  oRef.current = o

  function startSide(side: FadeSide) {
    return (e: React.PointerEvent) => {
      const c = oRef.current
      if (!c.editable) return
      e.preventDefault()
      e.stopPropagation()
      const el = e.currentTarget as HTMLElement
      el.setPointerCapture(e.pointerId)
      const startX = e.clientX
      const base = c.current()
      const slot = c.slotSec()
      let latest = base
      let raf = 0
      const onMove = (ev: PointerEvent) => {
        cancelAnimationFrame(raf)
        raf = requestAnimationFrame(() => {
          const cc = oRef.current
          const dSec = (ev.clientX - startX) / cc.pxPerSecond
          const next: Fades = side === 'in'
            ? { fadeIn: clamp(base.fadeIn + dSec, 0, slot - base.fadeOut), fadeOut: base.fadeOut }
            : { fadeIn: base.fadeIn, fadeOut: clamp(base.fadeOut - dSec, 0, slot - base.fadeIn) }
          latest = next
          cc.applyPreview(next)
        })
      }
      const end = () => {
        cancelAnimationFrame(raf)
        el.removeEventListener('pointermove', onMove)
        el.removeEventListener('pointerup', end)
        el.removeEventListener('pointercancel', end)
        el.removeEventListener('lostpointercapture', end)
        oRef.current.commit(latest)
      }
      el.addEventListener('pointermove', onMove)
      el.addEventListener('pointerup', end, { once: true })
      el.addEventListener('pointercancel', end, { once: true })
      el.addEventListener('lostpointercapture', end, { once: true })
    }
  }

  return { startFadeIn: startSide('in'), startFadeOut: startSide('out') }
}
