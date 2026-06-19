import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RawSegment } from '../../api/types'
import type { Word } from '../../api/staged'
import { useRunMedia } from '../../api/runMedia'
import { TimelineToolbar } from './TimelineToolbar'
import { VideoReference } from './VideoReference'
import { TimeTrack } from './TimeTrack'
import { SegmentLane } from './SegmentLane'
import { LiveRegion, type LiveRegionHandle } from './LiveRegion'
import { useTimelineModel } from './model/useTimelineModel'
import { useTimelineViewport } from './model/useTimelineViewport'
import { usePeaks } from './model/usePeaks'
import { useWords } from './model/useWords'
import type { VP } from './SegmentBlock'

const EMPTY_WORDS: Word[] = [] // stable ref so the active-words effect never loops

/**
 * Segment timeline editor (transcript stage). Reference video over a zoomable,
 * scrollable time track of draggable segment blocks on a shared time scale. Drag
 * a block's edge to retime its EN slot (snap-to-word, clamp to neighbours);
 * scrub/click to seek the video; keyboard-nudge a focused edge; undo/redo.
 *
 * Self-contained: keeps the original 5-prop interface and fetches peaks/video/
 * duration internally. Persistence is server-side (retimeSegment → onRetimed).
 */
export function SegmentTimeline({ segments, editable, selected, onSelect, onRetimed }: {
  segments: RawSegment[]
  editable: boolean
  selected: string | null
  onSelect: (id: string) => void
  onRetimed: () => void
}) {
  const { videoUrl } = useRunMedia()
  const model = useTimelineModel(segments, onRetimed)
  const { peaks, peaksDurationSec } = usePeaks('/api/peaks/en')
  const words = useWords()

  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null)
  const [videoDuration, setVideoDuration] = useState(0)

  // Duration precedence: real EN audio → max segment end → video metadata → guard.
  const maxSegEnd = useMemo(
    () => model.tsegs.reduce((m, s) => Math.max(m, model.version[s.id]?.end ?? s.endSec), 0),
    [model.tsegs, model.version],
  )
  // Timeline spans the longest of: EN audio, last segment, the video reference.
  const durationSec = Math.max(peaksDurationSec, maxSegEnd, videoDuration, 1)

  const viewport = useTimelineViewport(durationSec)
  const vp: VP = {
    pxPerSecond: viewport.pxPerSecond,
    timeToX: viewport.timeToX,
    xToTime: viewport.xToTime,
    clientXToContentX: viewport.clientXToContentX,
  }

  const liveRef = useRef<LiveRegionHandle>(null)
  const announce = useCallback((msg: string) => liveRef.current?.announce(msg), [])

  // Trackpad pinch-zoom (and Ctrl/Cmd+wheel): macOS fires a wheel event with
  // ctrlKey during a pinch. Non-passive so we can preventDefault the page zoom;
  // anchored at the cursor. Two-finger horizontal swipe scrolls natively
  // (overflow-x:auto + overscroll-x-contain).
  const zoomByRef = useRef(viewport.zoomBy)
  zoomByRef.current = viewport.zoomBy
  useEffect(() => {
    const el = viewport.scrollerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const factor = Math.min(2, Math.max(0.5, Math.exp(-e.deltaY * 0.01)))
      zoomByRef.current(factor, e.clientX)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [viewport.scrollerRef])

  const onVideoEl = useCallback((el: HTMLVideoElement | null) => setVideoEl(el), [])
  const onDuration = useCallback((d: number) => setVideoDuration(d), [])

  // Word-tick affordance for the selected segment (refetched after a commit).
  const [activeWords, setActiveWords] = useState<Word[]>(EMPTY_WORDS)
  useEffect(() => {
    let alive = true
    if (editable && selected) words.get(selected).then((w) => { if (alive) setActiveWords(w) })
    else setActiveWords(EMPTY_WORDS)
    return () => { alive = false }
  }, [editable, selected, words, model.version])

  // Undo / redo shortcuts.
  useEffect(() => {
    if (!editable) return
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey
      if (meta && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); e.shiftKey ? model.redo() : model.undo() }
      else if (meta && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); model.redo() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editable, model])

  // Announce commit errors to assistive tech.
  useEffect(() => { if (model.error) announce(model.error) }, [model.error, announce])

  return (
    <div className="rounded-lg border border-gray-200 p-3 dark:border-[#29292c]">
      <TimelineToolbar
        editable={editable}
        error={model.error}
        canUndo={model.canUndo}
        canRedo={model.canRedo}
        canZoomIn={viewport.canZoomIn}
        canZoomOut={viewport.canZoomOut}
        video={videoEl}
        durationSec={durationSec}
        onZoomIn={() => viewport.zoomIn()}
        onZoomOut={() => viewport.zoomOut()}
        onFit={viewport.fit}
        onUndo={model.undo}
        onRedo={model.redo}
        onClearError={model.clearError}
      />
      <VideoReference videoUrl={videoUrl} onVideoEl={onVideoEl} onDuration={onDuration} />
      <TimeTrack
        scrollerRef={viewport.scrollerRef}
        contentWidth={viewport.contentWidth}
        durationSec={durationSec}
        pxPerSecond={viewport.pxPerSecond}
        peaks={peaks}
        video={videoEl}
        clientXToContentX={viewport.clientXToContentX}
        xToTime={viewport.xToTime}
        lane={
          <SegmentLane
            model={model} vp={vp} durationSec={durationSec} selected={selected}
            editable={editable} getWords={words.get} evictWords={words.evict}
            setDragging={model.setDragging} announce={announce} onSelect={onSelect} activeWords={activeWords}
          />
        }
      />
      {words.snapDisabled && <div className="mt-1 text-[11px] text-gray-400">снап до слів недоступний у цьому режимі</div>}
      <LiveRegion ref={liveRef} />
    </div>
  )
}
