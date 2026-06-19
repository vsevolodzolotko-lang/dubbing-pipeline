import type { RefObject } from 'react'
import { MIN_DURATION } from './lib/constants'
import { formatTime } from './lib/time'
import { ResizeHandle } from './ResizeHandle'
import { useEdgeEditing } from './model/useEdgeEditing'
import type { VP } from './SegmentBlock'
import type { TSegment, Times } from './model/types'
import type { Word } from '../../api/staged'

const shortId = (id: string) => id.replace(/^.*_seg_/, 'seg ')

interface Props {
  seg: TSegment
  index: number
  times: Times
  /** dub status colour (cellClass) + selection/regen flags */
  statusClass: string
  selected: boolean
  editable: boolean
  pending: boolean
  /** seconds the dub exceeds its slot (draws a marker past the right edge) */
  overrunSec: number
  /** loudness-normalized to a target LUFS → small badge */
  normalized: boolean
  text: string
  vp: VP
  durationSec: number
  readoutRef: RefObject<HTMLDivElement | null>
  current: () => Times
  bounds: () => { prevEnd: number; nextStart: number }
  getWords: (id: string) => Promise<Word[]>
  commit: (times: Times) => void
  setDragging: (b: boolean) => void
  announce: (msg: string) => void
  onSelect: (id: string) => void
}

/**
 * Audio-stage block: positioned at the EN slot, coloured by the dub's review
 * status, with an overrun marker when the generated dub is longer than its slot.
 * Edge-drag retimes the slot (shared with the transcript timeline).
 */
export function AudioSegmentBlock({
  seg, index, times, statusClass, selected, editable, pending, overrunSec, normalized, text,
  vp, durationSec, readoutRef, current, bounds, getWords, commit, setDragging, announce, onSelect,
}: Props) {
  const { blockRef, startEdge, onHandleKey, startMove } = useEdgeEditing({
    segId: seg.id, editable, vp, durationSec, readoutRef, current, bounds, getWords, commit, setDragging, announce,
    onGrab: () => onSelect(seg.id),
  })

  const x = vp.timeToX(times.start)
  const w = Math.max(2, vp.timeToX(times.end) - x)
  const overrunPx = overrunSec > 0 ? Math.min(overrunSec * vp.pxPerSecond, 240) : 0
  const small = w < 56
  const { prevEnd, nextStart } = bounds()
  const label = `Сегмент ${index + 1}: «${text.slice(0, 60)}», слот ${formatTime(times.start)}–${formatTime(times.end)}${overrunSec > 0 ? `, дубляж довший на ${overrunSec.toFixed(2)}с` : ''}`

  return (
    <div
      ref={blockRef}
      role="group"
      aria-label={label}
      aria-current={selected || undefined}
      title={label}
      onPointerDown={editable ? startMove : undefined}
      onClick={(e) => { e.stopPropagation(); onSelect(seg.id) }}
      style={{ transform: `translateX(${x}px)`, width: w }}
      className={`group/block absolute top-1.5 bottom-1.5 left-0 flex select-none items-center overflow-visible rounded-md border text-[10px] transition-[filter] ${
        editable ? 'cursor-grab active:cursor-grabbing ' : ''
      }${pending ? 'opacity-60 ' : ''}${statusClass} ${selected ? 'z-10 ring-2 ring-gray-900 dark:ring-gray-100' : 'hover:brightness-95 dark:hover:brightness-110'}`}
    >
      {overrunPx > 0 && (
        <span
          aria-hidden
          style={{ width: overrunPx }}
          className="pointer-events-none absolute top-0 bottom-0 left-full rounded-r-md bg-amber-500/70 dark:bg-amber-400/70"
        />
      )}
      {normalized && <span aria-hidden title="−23 LUFS" className="pointer-events-none absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-emerald-500" />}
      {editable && (
        <ResizeHandle
          side="start" label={`Початок ${shortId(seg.id)}`}
          valueNow={times.start} valueMin={prevEnd} valueMax={times.end - MIN_DURATION}
          onPointerDown={(e) => startEdge('start', e)} onKeyDown={onHandleKey('start')} onFocus={() => onSelect(seg.id)}
        />
      )}
      <span className={`truncate px-2 font-mono ${small && !selected ? 'opacity-0 group-hover/block:opacity-100' : ''}`}>
        {shortId(seg.id)}
      </span>
      {editable && (
        <ResizeHandle
          side="end" label={`Кінець ${shortId(seg.id)}`}
          valueNow={times.end} valueMin={times.start + MIN_DURATION} valueMax={nextStart}
          onPointerDown={(e) => startEdge('end', e)} onKeyDown={onHandleKey('end')} onFocus={() => onSelect(seg.id)}
        />
      )}
    </div>
  )
}
