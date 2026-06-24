import { useRef } from 'react'
import type { RefObject } from 'react'
import { Trash2 } from 'lucide-react'
import { MIN_DURATION } from './lib/constants'
import { formatTime } from './lib/time'
import { ResizeHandle } from './ResizeHandle'
import { FadeHandle } from './FadeHandle'
import { useEdgeEditing } from './model/useEdgeEditing'
import { useFadeDrag, type Fades } from './model/useFadeDrag'
import type { VP } from './SegmentBlock'
import type { TSegment, Times } from './model/types'
import type { Word } from '../../api/staged'

// Clip id → short label: "seg 003 de" + a piece suffix ("·1") for cut pieces.
const shortId = (id: string) =>
  id.replace(/^.*_seg_/, 'seg ').replace(/_([a-z]{2})~c(\d+)$/, ' $1·$2').replace(/~c(\d+)$/, ' ·$1')

interface Props {
  seg: TSegment
  index: number
  times: Times
  /** dub status colour (cellClass) + selection/regen flags */
  statusClass: string
  selected: boolean
  editable: boolean
  pending: boolean
  /** loudness-normalized to a target LUFS → small badge */
  normalized: boolean
  /** per-language dub fade envelope (seconds at the clip start/end) */
  fadeIn: number
  fadeOut: number
  /** "cut" mode: a click slices the segment at the pointer instead of selecting */
  cutMode: boolean
  text: string
  vp: VP
  durationSec: number
  readoutRef: RefObject<HTMLDivElement | null>
  current: () => Times
  bounds: () => { prevEnd: number; nextStart: number }
  getWords: (id: string) => Promise<Word[]>
  commit: (times: Times) => void
  commitFades: (fades: Fades) => void
  setDragging: (b: boolean) => void
  announce: (msg: string) => void
  onSelect: (id: string) => void
  onCut: (clientX: number) => void
  onDelete: () => void
}

/**
 * Audio-stage clip block: one independent audio piece, coloured by the dub's
 * review status. Body-drag moves it, edge-drag trims it, the top-corner grips drag
 * a fade-in/out envelope, the trash button (or Delete) removes it; in "cut" mode a
 * click slices it at the pointer. (Shared edge-edit logic with the transcript
 * timeline.)
 */
export function AudioSegmentBlock({
  seg, index, times, statusClass, selected, editable, pending, normalized,
  fadeIn, fadeOut, cutMode, text,
  vp, durationSec, readoutRef, current, bounds, getWords, commit, commitFades, setDragging, announce, onSelect, onCut, onDelete,
}: Props) {
  const { blockRef, startEdge, onHandleKey, startMove } = useEdgeEditing({
    segId: seg.id, editable, vp, durationSec, readoutRef, current, bounds, getWords, commit, setDragging, announce,
    onGrab: () => onSelect(seg.id),
  })

  const x = vp.timeToX(times.start)
  const w = Math.max(2, vp.timeToX(times.end) - x)
  const small = w < 56
  const { prevEnd, nextStart } = bounds()
  const fadeInPx = Math.min(w, Math.max(0, fadeIn) * vp.pxPerSecond)
  const fadeOutPx = Math.min(w, Math.max(0, fadeOut) * vp.pxPerSecond)

  // Live-preview refs for fade drag (DOM-mutated per frame, like the edge drag).
  const fadeInTriRef = useRef<HTMLDivElement>(null)
  const fadeOutTriRef = useRef<HTMLDivElement>(null)
  const fadeInGripRef = useRef<HTMLButtonElement>(null)
  const fadeOutGripRef = useRef<HTMLButtonElement>(null)
  const { startFadeIn, startFadeOut } = useFadeDrag({
    editable,
    pxPerSecond: vp.pxPerSecond,
    slotSec: () => Math.max(0, current().end - current().start),
    current: () => ({ fadeIn, fadeOut }),
    applyPreview: (f) => {
      const pps = vp.pxPerSecond
      if (fadeInTriRef.current) fadeInTriRef.current.style.width = `${f.fadeIn * pps}px`
      if (fadeInGripRef.current) fadeInGripRef.current.style.left = `${f.fadeIn * pps}px`
      if (fadeOutTriRef.current) fadeOutTriRef.current.style.width = `${f.fadeOut * pps}px`
      if (fadeOutGripRef.current) fadeOutGripRef.current.style.right = `${f.fadeOut * pps}px`
      announce(`${shortId(seg.id)}: фейд-ін ${f.fadeIn.toFixed(2)}s, фейд-аут ${f.fadeOut.toFixed(2)}s`)
    },
    commit: commitFades,
  })

  const fadeLabel = fadeIn > 0 || fadeOut > 0 ? `, фейд ${fadeIn.toFixed(2)}/${fadeOut.toFixed(2)}s` : ''
  const label = `Кліп ${index + 1}: "${text.slice(0, 60)}", ${formatTime(times.start)}–${formatTime(times.end)}${fadeLabel}`

  return (
    <div
      ref={blockRef}
      role="group"
      aria-label={label}
      aria-current={selected || undefined}
      title={cutMode ? 'Клік — розрізати тут' : label}
      onPointerDown={editable && !cutMode ? startMove : undefined}
      onClick={(e) => { e.stopPropagation(); if (cutMode) onCut(e.clientX); else onSelect(seg.id) }}
      style={{ transform: `translateX(${x}px)`, width: w }}
      className={`group/block absolute top-1.5 bottom-1.5 left-0 flex select-none items-center overflow-visible rounded-md border text-[10px] transition-[filter] ${
        cutMode ? 'cursor-crosshair ' : editable ? 'cursor-grab active:cursor-grabbing ' : ''
      }${pending ? 'opacity-60 ' : ''}${statusClass} ${selected ? 'z-10 ring-2 ring-gray-900 dark:ring-gray-100' : 'hover:brightness-95 dark:hover:brightness-110'}`}
    >
      {/* fade envelope overlay (clipped to the block; behind the label/handles) */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-md">
        <div
          ref={fadeInTriRef}
          style={{ width: fadeInPx, clipPath: 'polygon(0 0, 100% 0, 0 100%)' }}
          className="absolute inset-y-0 left-0 bg-gradient-to-r from-sky-500/40 to-sky-500/0"
        />
        <div
          ref={fadeOutTriRef}
          style={{ width: fadeOutPx, clipPath: 'polygon(100% 0, 100% 100%, 0 0)' }}
          className="absolute inset-y-0 right-0 bg-gradient-to-l from-sky-500/40 to-sky-500/0"
        />
      </div>

      {normalized && <span aria-hidden title="−23 LUFS" className="pointer-events-none absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-emerald-500" />}

      {editable && !cutMode && selected && (
        <button
          type="button"
          aria-label={`Видалити кліп ${shortId(seg.id)}`}
          title="Видалити кліп (Delete)"
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute -top-2 left-1/2 z-30 -translate-x-1/2 grid h-4 w-4 place-items-center rounded-full border border-white bg-rose-600 text-white shadow-sm hover:bg-rose-500 dark:border-[#161617]"
        >
          <Trash2 className="h-2.5 w-2.5" strokeWidth={2} />
        </button>
      )}

      {editable && !cutMode && (
        <>
          <ResizeHandle
            side="start" label={`Start ${shortId(seg.id)}`}
            valueNow={times.start} valueMin={prevEnd} valueMax={times.end - MIN_DURATION}
            onPointerDown={(e) => startEdge('start', e)} onKeyDown={onHandleKey('start')} onFocus={() => onSelect(seg.id)}
          />
          <FadeHandle
            side="in" offsetPx={fadeInPx} anchorRef={fadeInGripRef} visible={selected}
            label={`Фейд-ін ${shortId(seg.id)} (${fadeIn.toFixed(2)}s)`} onPointerDown={startFadeIn}
          />
          <FadeHandle
            side="out" offsetPx={fadeOutPx} anchorRef={fadeOutGripRef} visible={selected}
            label={`Фейд-аут ${shortId(seg.id)} (${fadeOut.toFixed(2)}s)`} onPointerDown={startFadeOut}
          />
        </>
      )}

      <span className={`truncate px-2 font-mono ${small && !selected ? 'opacity-0 group-hover/block:opacity-100' : ''}`}>
        {shortId(seg.id)}
      </span>

      {editable && !cutMode && (
        <ResizeHandle
          side="end" label={`End ${shortId(seg.id)}`}
          valueNow={times.end} valueMin={times.start + MIN_DURATION} valueMax={nextStart}
          onPointerDown={(e) => startEdge('end', e)} onKeyDown={onHandleKey('end')} onFocus={() => onSelect(seg.id)}
        />
      )}
    </div>
  )
}
