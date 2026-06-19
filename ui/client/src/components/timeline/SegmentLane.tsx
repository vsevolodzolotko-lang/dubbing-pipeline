import { useRef } from 'react'
import { SegmentBlock, type VP } from './SegmentBlock'
import { WordTicks } from './WordTicks'
import type { TimelineModel } from './model/useTimelineModel'
import type { Word } from '../../api/staged'

/**
 * The blocks layer: one SegmentBlock per segment, a shared floating time readout
 * for the active drag, and the word-tick affordance for the selected segment.
 * Neighbour bounds are read live from the model so clamping tracks edits.
 */
export function SegmentLane({
  model, vp, durationSec, selected, editable, getWords, evictWords, setDragging, announce, onSelect, activeWords,
}: {
  model: TimelineModel
  vp: VP
  durationSec: number
  selected: string | null
  editable: boolean
  getWords: (id: string) => Promise<Word[]>
  evictWords: (id: string) => void
  setDragging: (b: boolean) => void
  announce: (msg: string) => void
  onSelect: (id: string) => void
  activeWords: Word[]
}) {
  const readoutRef = useRef<HTMLDivElement>(null)
  const { tsegs } = model

  return (
    <>
      {editable && selected && <WordTicks words={activeWords} timeToX={vp.timeToX} />}
      {tsegs.map((seg, i) => {
        const times = model.version[seg.id] ?? { start: seg.startSec, end: seg.endSec }
        const bounds = () => {
          const prev = tsegs[i - 1]
          const next = tsegs[i + 1]
          return {
            prevEnd: prev ? model.getTimes(prev.id).end : 0,
            nextStart: next ? model.getTimes(next.id).start : durationSec,
          }
        }
        return (
          <SegmentBlock
            key={seg.id}
            seg={seg}
            index={i}
            times={times}
            selected={seg.id === selected}
            editable={editable}
            pending={model.isPending(seg.id)}
            vp={vp}
            durationSec={durationSec}
            readoutRef={readoutRef}
            current={() => model.getTimes(seg.id)}
            bounds={bounds}
            getWords={getWords}
            commit={(t) => { model.commit(seg.id, t); evictWords(seg.id) }}
            setDragging={setDragging}
            announce={announce}
            onSelect={onSelect}
          />
        )
      })}
      <div
        ref={readoutRef}
        aria-hidden
        style={{ opacity: 0, transform: 'translateX(0px)' }}
        className="pointer-events-none absolute -top-5 left-0 z-30 rounded bg-gray-900 px-1 py-0.5 font-mono text-[10px] text-white transition-opacity dark:bg-gray-100 dark:text-gray-900"
      />
    </>
  )
}
