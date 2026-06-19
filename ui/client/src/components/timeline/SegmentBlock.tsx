import type { RefObject } from 'react'
import { MIN_DURATION } from './lib/constants'
import { formatTime } from './lib/time'
import { ResizeHandle } from './ResizeHandle'
import { useEdgeEditing } from './model/useEdgeEditing'
import type { TSegment, Times } from './model/types'
import type { Word } from '../../api/staged'

const shortId = (id: string) => id.replace(/^.*_seg_/, 'seg ')

export interface VP {
  pxPerSecond: number
  timeToX: (t: number) => number
  xToTime: (x: number) => number
  clientXToContentX: (clientX: number) => number
}

interface Props {
  seg: TSegment
  index: number
  times: Times
  selected: boolean
  editable: boolean
  pending: boolean
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

export function SegmentBlock({
  seg, index, times, selected, editable, pending, vp, durationSec,
  readoutRef, current, bounds, getWords, commit, setDragging, announce, onSelect,
}: Props) {
  const { blockRef, startEdge, onHandleKey, startMove } = useEdgeEditing({
    segId: seg.id, editable, vp, durationSec, readoutRef, current, bounds, getWords, commit, setDragging, announce,
    onGrab: () => onSelect(seg.id),
  })

  const x = vp.timeToX(times.start)
  const w = Math.max(2, vp.timeToX(times.end) - x)
  const small = w < 56
  const { prevEnd, nextStart } = bounds()
  const label = `Сегмент ${index + 1}: «${seg.text.slice(0, 60)}», ${formatTime(times.start)}–${formatTime(times.end)}`

  return (
    <div
      ref={blockRef}
      role="group"
      aria-label={label}
      aria-current={selected || undefined}
      onPointerDown={editable ? startMove : undefined}
      onClick={(e) => { e.stopPropagation(); onSelect(seg.id) }}
      style={{ transform: `translateX(${x}px)`, width: w }}
      className={`group/block absolute top-1.5 bottom-1.5 left-0 flex select-none items-center overflow-visible rounded-md border text-[10px] transition-colors ${
        editable ? 'cursor-grab active:cursor-grabbing ' : ''
      }${
        pending ? 'opacity-60 ' : ''
      }${
        selected
          ? 'border-blue-500 bg-blue-500/20 text-gray-900 ring-1 ring-blue-500/60 dark:text-gray-100'
          : 'border-gray-300 bg-gray-500/10 text-gray-700 hover:border-gray-400 dark:border-[#3a3a3d] dark:text-gray-300 dark:hover:border-[#52525b]'
      }`}
    >
      {selected && <span className="pointer-events-none absolute inset-x-0 top-0 h-0.5 rounded-t bg-blue-500" />}
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
