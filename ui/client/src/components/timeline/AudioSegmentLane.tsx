import { useRef } from 'react'
import { AudioSegmentBlock } from './AudioSegmentBlock'
import { DubWaveforms } from './DubWaveforms'
import type { VP } from './SegmentBlock'
import type { TimelineModel } from './model/useTimelineModel'
import type { Fades } from './model/useFadeDrag'
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

// Clips position freely (independent audio pieces) — clamp only to the lesson span,
// and disable word-snap so cuts/trims land on exact audio positions.
const NO_WORDS = (): Promise<Word[]> => Promise.resolve([])

/**
 * Audio-stage blocks for ONE language: each localization's dub is a list of
 * independent CLIPS (cut/move/trim/fade/delete pieces), coloured by the dub's
 * review status. Selecting a clip drives the shared Workbench panel + the delete
 * affordance.
 */
export function AudioSegmentLane({
  segments, lang, model, vp, durationSec, selectedClipId, editable, cutMode,
  inFlight, setDragging, announce, onSelectClip, onCut, onFade, onDelete,
}: {
  segments: SegmentRow[]
  lang: string
  model: TimelineModel
  vp: VP
  durationSec: number
  selectedClipId: string | null
  editable: boolean
  cutMode: boolean
  inFlight: Set<string>
  setDragging: (b: boolean) => void
  announce: (msg: string) => void
  onSelectClip: (clipId: string, segIndex: number) => void
  onCut: (clipId: string, clientX: number) => void
  onFade: (clipId: string, fades: Fades) => void
  onDelete: (clipId: string) => void
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
        if (!cell) return null
        const pending = cell.rowKey ? inFlight.has(cell.rowKey) : false
        return (cell.clips ?? []).map((clip) => {
          const times = model.version[clip.id] ?? { start: clip.start, end: clip.end }
          return (
            <AudioSegmentBlock
              key={clip.id}
              seg={{ id: clip.id, startSec: times.start, endSec: times.end, text: cell.textTranslated || row.enText }}
              index={i}
              times={times}
              statusClass={statusTint(cell.status ?? 'MISSING', cell.needsRetts)}
              selected={selectedClipId === clip.id}
              editable={editable}
              cutMode={cutMode}
              pending={pending}
              normalized={cell.normalizedLufs != null}
              fadeIn={clip.fadeIn}
              fadeOut={clip.fadeOut}
              text={cell.textTranslated || row.enText}
              vp={vp}
              durationSec={durationSec}
              readoutRef={readoutRef}
              current={() => model.getTimes(clip.id)}
              // Clips move freely (overlap allowed) — clamp only to the lesson span.
              bounds={() => ({ prevEnd: 0, nextStart: durationSec })}
              getWords={NO_WORDS}
              commit={(t) => model.commit(clip.id, t)}
              commitFades={(f) => onFade(clip.id, f)}
              setDragging={setDragging}
              announce={announce}
              onSelect={() => onSelectClip(clip.id, i)}
              onCut={(clientX) => onCut(clip.id, clientX)}
              onDelete={() => onDelete(clip.id)}
            />
          )
        })
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
