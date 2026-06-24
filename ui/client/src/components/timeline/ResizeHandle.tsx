import { HANDLE_HIT_PX, HANDLE_VISUAL_PX } from './lib/constants'
import { formatTime } from './lib/time'
import type { EdgeSide } from './model/types'

/**
 * Thin visible bar + a wide invisible grab target straddling the edge
 * (cursor: ew-resize). Focusable slider for keyboard nudging; fades in on hover
 * or focus. The actual drag/nudge logic lives in the parent block.
 */
export function ResizeHandle({ side, label, valueNow, valueMin, valueMax, onPointerDown, onKeyDown, onFocus }: {
  side: EdgeSide
  label: string
  valueNow: number
  valueMin: number
  valueMax: number
  onPointerDown: (e: React.PointerEvent) => void
  onKeyDown: (e: React.KeyboardEvent) => void
  onFocus: () => void
}) {
  return (
    <button
      type="button"
      role="slider"
      aria-label={label}
      aria-valuemin={Math.round(valueMin * 1000) / 1000}
      aria-valuemax={Math.round(valueMax * 1000) / 1000}
      aria-valuenow={Math.round(valueNow * 1000) / 1000}
      aria-valuetext={formatTime(valueNow)}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      style={{ width: HANDLE_HIT_PX, [side === 'start' ? 'left' : 'right']: -(HANDLE_HIT_PX / 2) }}
      className="group/handle absolute top-0 bottom-0 z-10 flex cursor-ew-resize items-stretch justify-center bg-transparent p-0 focus:outline-none"
    >
      <span
        style={{ width: HANDLE_VISUAL_PX }}
        className="my-0.5 rounded-full bg-blue-500/30 transition-colors group-hover/handle:bg-blue-500/90 group-focus-visible/handle:bg-blue-500 group-focus-visible/handle:ring-2 group-focus-visible/handle:ring-blue-400"
      />
    </button>
  )
}
