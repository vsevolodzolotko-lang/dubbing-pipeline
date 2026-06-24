import type { Ref } from 'react'
import type { FadeSide } from './model/useFadeDrag'

/**
 * Small grip on a block's top corner that drags a fade ramp inward (start corner →
 * fade-in, end corner → fade-out). Anchored by the same edge as the fade it sizes,
 * so it tracks the block edge as the block is retimed, and centred on the fade
 * boundary. Fades in on block hover or selection; the drag/clamp logic lives in
 * `useFadeDrag`.
 */
export function FadeHandle({ side, offsetPx, label, anchorRef, visible, onPointerDown }: {
  side: FadeSide
  /** distance from the anchored edge, in px (= fade length × zoom) */
  offsetPx: number
  label: string
  anchorRef: Ref<HTMLButtonElement>
  visible: boolean
  onPointerDown: (e: React.PointerEvent) => void
}) {
  const edge = side === 'in' ? { left: offsetPx } : { right: offsetPx }
  // Centre the grip on the fade boundary: start handle shifts left by half, end
  // handle right by half (translate is relative to its own box, not the anchor).
  const center = side === 'in' ? '-translate-x-1/2' : 'translate-x-1/2'
  return (
    <button
      ref={anchorRef}
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={onPointerDown}
      style={edge}
      className={`absolute top-0 z-20 ${center} -translate-y-1/2 h-2.5 w-2.5 cursor-ew-resize rounded-full border border-white bg-sky-600 shadow-sm transition-opacity hover:scale-125 dark:border-[#161617] ${
        visible ? 'opacity-100' : 'opacity-0 group-hover/block:opacity-100'
      }`}
    />
  )
}
