import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RawSegment, SegmentRow } from '../../api/types'
import { cutClip, retimeClip, setClipFades, deleteClip } from '../../api/staged'
import type { Fades } from './model/useFadeDrag'
import { ms } from './lib/time'
import { RAIL_W, RULER_H, TRACK_H } from './lib/constants'
import { TimelineToolbar } from './TimelineToolbar'
import { WindowedRuler } from './WindowedRuler'
import { WaveformCanvas } from './WaveformCanvas'
import { AudioSegmentLane } from './AudioSegmentLane'
import { TrackHeader } from './TrackHeader'
import { Playhead } from './Playhead'
import { LiveRegion, type LiveRegionHandle } from './LiveRegion'
import { useTimelineModel } from './model/useTimelineModel'
import { useTimelineViewport } from './model/useTimelineViewport'
import { usePeaks } from './model/usePeaks'
import { useScrub } from './model/useScrub'
import { useTrackPlayback } from './model/useTrackPlayback'
import type { VP } from './SegmentBlock'

export interface AudioSelection { seg: number; lang: string }

const EN = 'en' // original track id

/**
 * Audio-stage multitrack timeline: a stack of waveform tracks on a shared time
 * scale — ORIGINAL (full EN audio) + one track per localization language
 * (per-segment dub waveforms + retimable status blocks). Left rail: per-track
 * name, volume, Mute/Solo. The reference `video` (rendered by the parent, the
 * playback clock) drives all tracks; Space toggles play. Bidirectional sync with
 * the Workbench matrix via `selected`.
 */
export function AudioTimeline({ segments, langs, selected, editable, inFlight, video, videoDuration, focusSeg, onViewSeg, onScrollerReady, onSelectCell, onRetimed }: {
  segments: SegmentRow[]
  langs: string[]
  selected: AudioSelection | null
  editable: boolean
  inFlight: Set<string>
  video: HTMLVideoElement | null
  videoDuration: number
  // Segment index to horizontally scroll into view (driven by the matrix's vertical
  // scroll). Unlike `selected`, it never seeks the video — just keeps the timeline
  // framed on the segments you're looking at. No-op when the lesson fits on screen.
  focusSeg?: number | null
  // Reverse sync: report the segment at the left edge as the timeline scrolls,
  // so the parent can scroll the matrix to match.
  onViewSeg?: (segIndex: number) => void
  // Hand the horizontal scroll container up to the parent so it can drive a
  // fraction-based scroll sync against the matrix (matrix bottom ⇔ timeline end).
  onScrollerReady?: (el: HTMLDivElement | null) => void
  onSelectCell: (seg: number, lang: string) => void
  onRetimed: () => void
}) {
  // The audio gate edits per LANGUAGE as independent CLIPS: each localization's dub
  // is one or more clips the operator can cut/move/trim/fade/delete. The timeline
  // model is keyed by CLIP id (one entry per clip), so dragging a clip moves only
  // that piece of that language; the EN slot (segments tab) is never touched. The
  // render stage rebuilds each language's file from these clips.
  const rawSegs = useMemo<RawSegment[]>(() =>
    segments.flatMap((s) => langs.flatMap((l) => (s.cells[l]?.clips ?? []).map((c) => ({
      segment_id: c.id, // model id = clip id
      en_text: s.enText,
      en_start_sec: c.start,
      en_end_sec: c.end,
      en_duration_sec: Math.max(0, c.end - c.start),
      segment_type: s.segmentType ?? '',
      movement_keywords: s.movementKeywords ?? '',
    })))),
    [segments, langs])

  const persistClip = useCallback((clipId: string, s: number, e: number) => retimeClip(clipId, s, e), [])
  const model = useTimelineModel(rawSegs, onRetimed, persistClip)
  const { peaks, peaksDurationSec } = usePeaks('/api/peaks/en')

  const maxSegEnd = useMemo(
    () => model.tsegs.reduce((m, s) => Math.max(m, model.version[s.id]?.end ?? s.endSec), 0),
    [model.tsegs, model.version],
  )
  // Span the longest of: EN audio, last segment, the video reference.
  const durationSec = Math.max(peaksDurationSec, maxSegEnd, videoDuration, 1)

  const viewport = useTimelineViewport(durationSec)
  const vp: VP = {
    pxPerSecond: viewport.pxPerSecond,
    timeToX: viewport.timeToX,
    xToTime: viewport.xToTime,
    clientXToContentX: viewport.clientXToContentX,
  }
  const scrub = useScrub(video, viewport.clientXToContentX, viewport.xToTime, durationSec)

  const liveRef = useRef<LiveRegionHandle>(null)
  const announce = useCallback((msg: string) => liveRef.current?.announce(msg), [])

  // "Cut" mode: a click on a clip slices THAT clip at the pointer position (this
  // language only) into two independent pieces. Cut/fade/delete share one transient
  // error line (alongside the model's retime error). The selected clip is tracked
  // for the delete affordance.
  const [cutMode, setCutMode] = useState(false)
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  useEffect(() => { if (!editable) setCutMode(false) }, [editable])

  // Slice one clip at the clicked x (exact audio position — no word snap). Only the
  // clicked language's clip is affected; refetch reseeds the model with the pieces.
  const doCut = useCallback(async (clipId: string, clientX: number) => {
    setActionError(null)
    const t = viewport.xToTime(viewport.clientXToContentX(clientX))
    try {
      const r = await cutClip(clipId, ms(t))
      if (!r.ok) { setActionError(r.error || 'Не вдалося розрізати кліп'); return }
      setCutMode(false)
      announce('Кліп розрізано')
      onRetimed()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setActionError(msg.includes('409') ? 'Розрізання недоступне на цьому етапі' : 'Помилка розрізання')
    }
  }, [viewport, announce, onRetimed])

  // Persist a per-clip fade-in/out envelope (audio gate).
  const doFade = useCallback(async (clipId: string, f: Fades) => {
    setActionError(null)
    try {
      const r = await setClipFades(clipId, ms(f.fadeIn), ms(f.fadeOut))
      if (!r.ok) { setActionError(r.error || 'Не вдалося застосувати фейд'); return }
      onRetimed()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setActionError(msg.includes('409') ? 'Фейди недоступні на цьому етапі' : 'Помилка фейду')
    }
  }, [onRetimed])

  // Delete one clip (its audio piece).
  const doDelete = useCallback(async (clipId: string) => {
    setActionError(null)
    try {
      const r = await deleteClip(clipId)
      if (!r.ok) { setActionError(r.error || 'Не вдалося видалити кліп'); return }
      setSelectedClipId((cur) => (cur === clipId ? null : cur))
      announce('Кліп видалено')
      onRetimed()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setActionError(msg.includes('409') ? 'Видалення недоступне на цьому етапі' : 'Помилка видалення')
    }
  }, [announce, onRetimed])

  // Per-track volume / mute / solo, keyed by track id ('en' + each lang). Solo wins.
  const [vol, setVol] = useState<Record<string, number>>({})
  const [mute, setMute] = useState<Record<string, boolean>>({})
  const [solo, setSolo] = useState<Record<string, boolean>>({})
  const volOf = (id: string) => vol[id] ?? 1
  const anySolo = Object.values(solo).some(Boolean)
  const audibleOf = (id: string) => (anySolo ? Boolean(solo[id]) : !mute[id])
  const setVolOf = (id: string, v: number) => setVol((m) => ({ ...m, [id]: v }))
  const toggleMute = (id: string) => setMute((m) => ({ ...m, [id]: !m[id] }))
  const toggleSolo = (id: string) => setSolo((s) => ({ ...s, [id]: !s[id] }))

  // Audio elements: full EN (continuous) + one per language (per-clip scheduler).
  const enAudio = useRef<HTMLAudioElement>(null)
  const dubAudios = useRef<Map<string, HTMLAudioElement>>(new Map())
  const dubs = langs.map((l) => ({ lang: l, audible: audibleOf(l), volume: volOf(l) }))
  // Per-language clip positions for playback (committed positions from the server;
  // a clip plays its source audio from `srcStart + (t − clip.start)`).
  const dubClips = useMemo(() => {
    const m: Record<string, { id: string; rowKey: string; start: number; end: number; srcStart: number }[]> = {}
    for (const l of langs) {
      const arr: { id: string; rowKey: string; start: number; end: number; srcStart: number }[] = []
      for (const s of segments) {
        const cell = s.cells[l]
        if (!cell?.rowKey) continue
        for (const c of cell.clips ?? []) arr.push({ id: c.id, rowKey: cell.rowKey, start: c.start, end: c.end, srcStart: c.srcStart })
      }
      arr.sort((a, b) => a.start - b.start)
      m[l] = arr
    }
    return m
  }, [segments, langs])
  useTrackPlayback({
    video, enAudio, enAudible: audibleOf(EN), enVolume: volOf(EN),
    dubAudios, dubs, dubClips,
  })

  // Selection (matrix cell or timeline block) → move the playhead to the segment's
  // start (when a video is present) and scroll the timeline to frame it. The scroll
  // happens regardless of video so matrix selection always reveals the segment here.
  useEffect(() => {
    if (!selected) return
    const row = segments[selected.seg]
    if (!row || row.enStart == null) return
    if (video) { try { video.currentTime = Math.min(row.enStart, video.duration || row.enStart) } catch { /* */ } }
    const sc = viewport.scrollerRef.current
    if (sc) {
      const x = viewport.timeToX(row.enStart)
      if (x < sc.scrollLeft || x > sc.scrollLeft + sc.clientWidth) sc.scrollLeft = Math.max(0, x - sc.clientWidth * 0.3)
    }
  }, [selected?.seg, selected?.lang, video]) // eslint-disable-line react-hooks/exhaustive-deps

  // Matrix scroll → horizontally scroll the timeline to frame that segment (no
  // video seek, no selection change). No-op when the content already fits.
  useEffect(() => {
    if (focusSeg == null) return
    const row = segments[focusSeg]
    if (!row || row.enStart == null) return
    const sc = viewport.scrollerRef.current
    if (!sc) return
    const target = Math.max(0, viewport.timeToX(row.enStart) - sc.clientWidth * 0.3)
    if (Math.abs(target - sc.scrollLeft) > 2) sc.scrollLeft = target
  }, [focusSeg]) // eslint-disable-line react-hooks/exhaustive-deps

  // Trackpad pinch-zoom (wheel + ctrlKey), anchored at the cursor; non-passive.
  const zoomByRef = useRef(viewport.zoomBy)
  zoomByRef.current = viewport.zoomBy
  useEffect(() => {
    const el = viewport.scrollerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      zoomByRef.current(Math.min(2, Math.max(0.5, Math.exp(-e.deltaY * 0.01))), e.clientX)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [viewport.scrollerRef])

  // Report the scroll container to the parent (for the matrix↔timeline fraction sync).
  useEffect(() => {
    onScrollerReady?.(viewport.scrollerRef.current)
    return () => onScrollerReady?.(null)
  }, [onScrollerReady, viewport.scrollerRef])

  useEffect(() => { if (model.error) announce(model.error) }, [model.error, announce])

  // Spacebar toggles timeline playback (the video is the clock that drives all
  // tracks); Escape leaves "cut" mode; Delete/Backspace removes the selected clip.
  const selClipRef = useRef(selectedClipId); selClipRef.current = selectedClipId
  const editableRef = useRef(editable); editableRef.current = editable
  const doDeleteRef = useRef(doDelete); doDeleteRef.current = doDelete
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
      if (e.key === 'Escape') { setCutMode(false); return }
      if ((e.key === 'Delete' || e.key === 'Backspace') && !typing && editableRef.current && selClipRef.current) {
        e.preventDefault()
        doDeleteRef.current(selClipRef.current)
        return
      }
      if (e.key !== ' ' && e.code !== 'Space') return
      if (typing) return
      if (!video) return
      e.preventDefault()
      if (video.paused) video.play().catch(() => {}); else video.pause()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [video])

  const cw = viewport.contentWidth

  // Timeline horizontal scroll → report the segment at the left edge so the parent
  // scrolls the matrix to match. Native listener on the scroller (fires reliably for
  // any scroll), per-frame throttled, reading fresh values via refs.
  const vpRef = useRef(viewport); vpRef.current = viewport
  const segsRef = useRef(segments); segsRef.current = segments
  const onViewSegRef = useRef(onViewSeg); onViewSegRef.current = onViewSeg
  const viewRafRef = useRef(0)
  useEffect(() => {
    const sc = viewport.scrollerRef.current
    if (!sc) return
    const onScroll = () => {
      if (viewRafRef.current) return
      viewRafRef.current = requestAnimationFrame(() => {
        viewRafRef.current = 0
        const fn = onViewSegRef.current
        if (!fn) return
        const segs = segsRef.current
        const t = vpRef.current.xToTime(sc.scrollLeft + 8)
        let idx = 0
        for (let i = 0; i < segs.length; i++) { if ((segs[i].enStart ?? 0) <= t) idx = i; else break }
        fn(idx)
      })
    }
    sc.addEventListener('scroll', onScroll, { passive: true })
    return () => sc.removeEventListener('scroll', onScroll)
  }, [viewport.scrollerRef])

  return (
    <div className="rounded-lg border border-gray-200 p-3 dark:border-[#29292c]">
      <TimelineToolbar
        editable={editable}
        error={model.error || actionError}
        cutMode={cutMode}
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
        onToggleCut={() => setCutMode((v) => !v)}
        onClearError={() => { model.clearError(); setActionError(null) }}
      />

      {/* left rail (fixed) + scrollable multitrack */}
      <div className="flex">
        <div style={{ width: RAIL_W }} className="shrink-0 select-none rounded-l-md border border-r-0 border-gray-200 dark:border-[#29292c]">
          <div style={{ height: RULER_H }} className="border-b border-gray-200 dark:border-[#29292c]" />
          <TrackHeader
            name="Original" sub="EN" height={TRACK_H} audible={audibleOf(EN)} volume={volOf(EN)}
            muted={Boolean(mute[EN])} solo={Boolean(solo[EN])}
            onMute={() => toggleMute(EN)} onSolo={() => toggleSolo(EN)} onVolume={(v) => setVolOf(EN, v)}
          />
          {langs.map((l) => (
            <TrackHeader
              key={l}
              name={l.toUpperCase()} height={TRACK_H} audible={audibleOf(l)} volume={volOf(l)}
              muted={Boolean(mute[l])} solo={Boolean(solo[l])}
              onMute={() => toggleMute(l)} onSolo={() => toggleSolo(l)} onVolume={(v) => setVolOf(l, v)}
            />
          ))}
        </div>

        <div
          ref={viewport.scrollerRef}
          className="relative flex-1 overflow-x-auto overflow-y-hidden overscroll-x-contain rounded-r-md border border-gray-200 bg-gray-50 dark:border-[#29292c] dark:bg-[#161617]"
        >
          <div className="relative" style={{ width: cw }}>
            <div style={{ height: RULER_H }} onPointerDown={scrub} className="cursor-pointer border-b border-gray-200 dark:border-[#29292c]">
              <WindowedRuler scrollerRef={viewport.scrollerRef} pxPerSecond={viewport.pxPerSecond} durationSec={durationSec} />
            </div>

            {/* ORIGINAL track */}
            <div style={{ height: TRACK_H }} className={`relative border-b border-gray-200 dark:border-[#29292c] ${audibleOf(EN) ? '' : 'opacity-40'}`}>
              <WaveformCanvas peaks={peaks} contentWidth={cw} pxPerSecond={viewport.pxPerSecond} />
              <div className="absolute inset-0 cursor-pointer" onPointerDown={scrub} />
            </div>

            {/* one track per language */}
            {langs.map((l) => (
              <div key={l} style={{ height: TRACK_H }} className={`relative border-b border-gray-200 dark:border-[#29292c] ${audibleOf(l) ? '' : 'opacity-40'}`}>
                <div className="absolute inset-0 cursor-pointer" onPointerDown={scrub} />
                <AudioSegmentLane
                  segments={segments} lang={l} model={model} vp={vp} durationSec={durationSec}
                  selectedClipId={selectedClipId}
                  editable={editable} cutMode={cutMode} inFlight={inFlight}
                  setDragging={model.setDragging}
                  announce={announce}
                  onSelectClip={(clipId, i) => { setSelectedClipId(clipId); onSelectCell(i, l) }}
                  onCut={doCut} onFade={doFade} onDelete={doDelete}
                />
              </div>
            ))}

            <Playhead video={video} pxPerSecond={viewport.pxPerSecond} scrollerRef={viewport.scrollerRef} />
          </div>
        </div>
      </div>

      <div className="mt-1 text-[11px] text-gray-400">
        {cutMode
          ? 'Режим розрізання: клік по кліпу ріже саме його (тільки ця мова) у точці кліку · Esc — вийти'
          : 'Space — play/pause · перетягни тіло кліпу = рух, край = trim · ручка у верхньому куті = фейд-ін/аут · обери кліп і Delete = видалити'}
      </div>
      <LiveRegion ref={liveRef} />
      <audio ref={enAudio} src="/api/audio/en" preload="auto" />
      {langs.map((l) => (
        <audio key={l} ref={(el) => { if (el) dubAudios.current.set(l, el); else dubAudios.current.delete(l) }} preload="auto" />
      ))}
    </div>
  )
}
