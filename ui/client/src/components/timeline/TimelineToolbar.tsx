import { useState } from 'react'
import { Maximize2, Redo2, Scissors, Undo2, ZoomIn, ZoomOut } from 'lucide-react'
import { formatTime } from './lib/time'
import { useVideoClock } from './model/useVideoClock'

const BTN = 'rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-800 disabled:cursor-default disabled:opacity-40 dark:hover:bg-[#202023] dark:hover:text-gray-200'

/** Current-time / duration readout, driven by its own clock so frequent ticks
 *  re-render only this span — not the whole editor. */
function TimeReadout({ video, durationSec }: { video: HTMLVideoElement | null; durationSec: number }) {
  const [t, setT] = useState(0)
  useVideoClock(video, setT)
  return <span className="font-mono text-xs text-gray-400">{formatTime(t)} / {durationSec.toFixed(2)}s</span>
}

export function TimelineToolbar({
  editable, error, cutMode, canUndo, canRedo, canZoomIn, canZoomOut, video, durationSec,
  onZoomIn, onZoomOut, onFit, onUndo, onRedo, onToggleCut, onClearError,
}: {
  editable: boolean
  error: string | null
  cutMode?: boolean
  canUndo: boolean
  canRedo: boolean
  canZoomIn: boolean
  canZoomOut: boolean
  video: HTMLVideoElement | null
  durationSec: number
  onZoomIn: () => void
  onZoomOut: () => void
  onFit: () => void
  onUndo: () => void
  onRedo: () => void
  onToggleCut?: () => void
  onClearError: () => void
}) {
  return (
    <div className="mb-2 flex items-center gap-1">
      <span className="mr-1 text-xs font-medium text-gray-700 dark:text-gray-300">Timeline</span>
      {!editable && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-500 dark:bg-[#202023]">read-only</span>}

      <div className="ml-2 flex items-center gap-0.5">
        <button type="button" className={BTN} title="Zoom out" onClick={onZoomOut} disabled={!canZoomOut}><ZoomOut className="h-4 w-4" strokeWidth={1.75} /></button>
        <button type="button" className={BTN} title="Zoom in" onClick={onZoomIn} disabled={!canZoomIn}><ZoomIn className="h-4 w-4" strokeWidth={1.75} /></button>
        <button type="button" className={BTN} title="Fit to screen" onClick={onFit}><Maximize2 className="h-4 w-4" strokeWidth={1.75} /></button>
      </div>

      {editable && (
        <div className="flex items-center gap-0.5">
          <button type="button" className={BTN} title="Undo (Cmd/Ctrl+Z)" onClick={onUndo} disabled={!canUndo}><Undo2 className="h-4 w-4" strokeWidth={1.75} /></button>
          <button type="button" className={BTN} title="Redo (Shift+Cmd/Ctrl+Z)" onClick={onRedo} disabled={!canRedo}><Redo2 className="h-4 w-4" strokeWidth={1.75} /></button>
        </div>
      )}

      {editable && onToggleCut && (
        <button
          type="button"
          aria-pressed={cutMode}
          onClick={onToggleCut}
          title={cutMode ? 'Вийти з режиму розрізання (Esc)' : 'Розрізати сегмент (клік по точці)'}
          className={cutMode
            ? 'flex items-center gap-1 rounded bg-sky-600 px-1.5 py-1 text-xs text-white'
            : `${BTN} flex items-center gap-1 px-1.5 text-xs`}
        >
          <Scissors className="h-4 w-4" strokeWidth={1.75} />
          {cutMode && <span>Розрізати</span>}
        </button>
      )}

      {error && (
        <button type="button" onClick={onClearError} title="hide" className="ml-1 truncate text-xs text-red-600 dark:text-red-400">{error}</button>
      )}

      <div className="ml-auto"><TimeReadout video={video} durationSec={durationSec} /></div>
    </div>
  )
}
