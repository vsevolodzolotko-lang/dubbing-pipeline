import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RawSegment } from '../../api/types'
import type { Word } from '../../api/staged'
import { TimelineToolbar } from './TimelineToolbar'
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
export function SegmentTimeline({ segments, editable, selected, onSelect, onRetimed, focusSeg, onViewSeg, video, videoDuration }: {
  segments: RawSegment[]
  editable: boolean
  selected: string | null
  onSelect: (id: string) => void
  onRetimed: () => void
  // Bidirectional sync with the segment list (same as the audio gate): scroll the
  // timeline into view for `focusSeg`, and report the segment at the left edge.
  focusSeg?: number | null
  onViewSeg?: (segIndex: number) => void
  // The reference video (rendered by the parent in the side panel) is the playback clock.
  video: HTMLVideoElement | null
  videoDuration: number
}) {
  const model = useTimelineModel(segments, onRetimed)
  const { peaks, peaksDurationSec } = usePeaks('/api/peaks/en')
  const words = useWords()

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

  // ── sync with the segment list (focusSeg in, onViewSeg out) ──
  const vpRef = useRef(viewport)
  vpRef.current = viewport
  // matrix → timeline: scroll the focused segment into view (no-op when it fits)
  useEffect(() => {
    if (focusSeg == null) return
    const start = Number(segments[focusSeg]?.en_start_sec)
    const sc = vpRef.current.scrollerRef.current
    if (!sc || !isFinite(start)) return
    const target = Math.max(0, vpRef.current.timeToX(start) - sc.clientWidth * 0.3)
    if (Math.abs(target - sc.scrollLeft) > 2) sc.scrollLeft = target
  }, [focusSeg, segments])

  // Selecting a segment (a card in the list below) → seek the playhead to its start
  // and frame it on the timeline (the list reframes via the normal onViewSeg echo).
  useEffect(() => {
    if (!selected) return
    const seg = segments.find((s) => s.segment_id === selected)
    if (!seg) return
    const start = model.version[selected]?.start ?? Number(seg.en_start_sec)
    if (!isFinite(start)) return
    if (video) { try { video.currentTime = Math.min(start, video.duration || start) } catch { /* seek may throw before metadata */ } }
    const sc = vpRef.current.scrollerRef.current
    if (sc) {
      const x = vpRef.current.timeToX(start)
      if (x < sc.scrollLeft || x > sc.scrollLeft + sc.clientWidth) sc.scrollLeft = Math.max(0, x - sc.clientWidth * 0.3)
    }
  }, [selected, video]) // eslint-disable-line react-hooks/exhaustive-deps
  // timeline → matrix: report the segment at the left edge as the timeline scrolls
  const viewRafRef = useRef(0)
  useEffect(() => {
    const sc = vpRef.current.scrollerRef.current
    if (!sc || !onViewSeg) return
    const onScroll = () => {
      if (viewRafRef.current) return
      viewRafRef.current = requestAnimationFrame(() => {
        viewRafRef.current = 0
        const t = vpRef.current.xToTime(sc.scrollLeft + 8)
        let idx = 0
        for (let i = 0; i < segments.length; i++) { if (Number(segments[i].en_start_sec) <= t) idx = i; else break }
        onViewSeg(idx)
      })
    }
    sc.addEventListener('scroll', onScroll, { passive: true })
    return () => sc.removeEventListener('scroll', onScroll)
  }, [onViewSeg, segments])

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

  // Spacebar toggles the reference video (the playback clock) — same as the audio gate.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== ' ' && e.code !== 'Space') return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (!video) return
      e.preventDefault()
      if (video.paused) video.play().catch(() => {}); else video.pause()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [video])

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
        video={video}
        durationSec={durationSec}
        onZoomIn={() => viewport.zoomIn()}
        onZoomOut={() => viewport.zoomOut()}
        onFit={viewport.fit}
        onUndo={model.undo}
        onRedo={model.redo}
        onClearError={model.clearError}
      />
      <TimeTrack
        scrollerRef={viewport.scrollerRef}
        contentWidth={viewport.contentWidth}
        durationSec={durationSec}
        pxPerSecond={viewport.pxPerSecond}
        peaks={peaks}
        video={video}
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
      {words.snapDisabled && <div className="mt-1 text-[11px] text-gray-400">snap-to-word is unavailable in this mode</div>}
      <LiveRegion ref={liveRef} />
    </div>
  )
}
