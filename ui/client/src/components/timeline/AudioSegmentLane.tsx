import { useRef } from 'react'
import { AudioSegmentBlock } from './AudioSegmentBlock'
import { DubWaveforms } from './DubWaveforms'
import type { VP } from './SegmentBlock'
import type { TimelineModel } from './model/useTimelineModel'
import type { SegmentRow } from '../../api/types'
import type { Word } from '../../api/staged'

// Translucent status fills (vs the opaque matrix `cellClass`) so the per-segment
// dub waveform behind the block shows through; the border carries the status hue.
const STATUS_TINT: Record<string, string> = {
  TRUE: 'border-red-400/70 bg-red-500/15 text-red-900 dark:text-red-200',
  FALSE: 'border-green-500/60 bg-green-500/10 text-green-900 dark:text-green-200',
  REVIEW: 'border-amber-400/70 bg-amber-500/15 text-amber-900 dark:text-amber-200',
  MISSING: 'border-gray-400/50 bg-gray-500/10 text-gray-500',
  QUEUED: 'border-blue-400/70 bg-blue-500/15 text-blue-900 dark:text-blue-200',
}
const statusTint = (status: string, queued?: boolean) =>
  queued ? STATUS_TINT.QUEUED : STATUS_TINT[status] ?? STATUS_TINT.MISSING

/**
 * Audio-stage blocks for ONE language: each segment placed at its (retimable) EN
 * slot, coloured by the dub's review status, with an overrun marker when the dub
 * is longer than the slot. Selecting a block drives the shared Workbench panel.
 */
export function AudioSegmentLane({
  segments, lang, model, vp, durationSec, selectedSeg, editable,
  inFlight, getWords, evictWords, setDragging, announce, onSelectIndex,
}: {
  segments: SegmentRow[]
  lang: string
  model: TimelineModel
  vp: VP
  durationSec: number
  selectedSeg: number | null
  editable: boolean
  inFlight: Set<string>
  getWords: (id: string) => Promise<Word[]>
  evictWords: (id: string) => void
  setDragging: (b: boolean) => void
  announce: (msg: string) => void
  onSelectIndex: (index: number) => void
}) {
  const readoutRef = useRef<HTMLDivElement>(null)

  return (
    <>
      <DubWaveforms
        segments={segments}
        lang={lang}
        getTimes={model.getTimes}
        version={model.version}
        timeToX={vp.timeToX}
        contentWidth={durationSec * vp.pxPerSecond}
      />
      {segments.map((row, i) => {
        const cell = row.cells[lang]
        const times = model.version[row.segmentId] ?? { start: row.enStart ?? 0, end: row.enEnd ?? 0 }
        const slot = Math.max(0, times.end - times.start)
        const dubDur = cell?.finalDuration ?? cell?.realDuration ?? slot
        const overrunSec = Math.max(0, dubDur - slot)
        const pending = cell?.rowKey ? inFlight.has(cell.rowKey) : false
        const bounds = () => {
          const prev = segments[i - 1]
          const next = segments[i + 1]
          return {
            prevEnd: prev ? model.getTimes(prev.segmentId).end : 0,
            nextStart: next ? model.getTimes(next.segmentId).start : durationSec,
          }
        }
        return (
          <AudioSegmentBlock
            key={row.segmentId}
            seg={{ id: row.segmentId, startSec: times.start, endSec: times.end, text: cell?.textTranslated || row.enText }}
            index={i}
            times={times}
            statusClass={statusTint(cell?.status ?? 'MISSING', cell?.needsRetts)}
            selected={selectedSeg === i}
            editable={editable}
            pending={pending}
            overrunSec={overrunSec}
            normalized={cell?.normalizedLufs != null}
            text={cell?.textTranslated || row.enText}
            vp={vp}
            durationSec={durationSec}
            readoutRef={readoutRef}
            current={() => model.getTimes(row.segmentId)}
            bounds={bounds}
            getWords={getWords}
            commit={(t) => { model.commit(row.segmentId, t); evictWords(row.segmentId) }}
            setDragging={setDragging}
            announce={announce}
            onSelect={() => onSelectIndex(i)}
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
