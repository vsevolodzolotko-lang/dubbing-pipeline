import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RawSegment, SegmentRow } from '../../api/types'
import { RAIL_W, RULER_H, TRACK_H } from './lib/constants'
import { TimelineToolbar } from './TimelineToolbar'
import { RulerCanvas } from './RulerCanvas'
import { WaveformCanvas } from './WaveformCanvas'
import { AudioSegmentLane } from './AudioSegmentLane'
import { TrackHeader } from './TrackHeader'
import { Playhead } from './Playhead'
import { LiveRegion, type LiveRegionHandle } from './LiveRegion'
import { useTimelineModel } from './model/useTimelineModel'
import { useTimelineViewport } from './model/useTimelineViewport'
import { usePeaks } from './model/usePeaks'
import { useWords } from './model/useWords'
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
export function AudioTimeline({ segments, langs, selected, editable, inFlight, video, videoDuration, onSelectCell, onRetimed }: {
  segments: SegmentRow[]
  langs: string[]
  selected: AudioSelection | null
  editable: boolean
  inFlight: Set<string>
  video: HTMLVideoElement | null
  videoDuration: number
  onSelectCell: (seg: number, lang: string) => void
  onRetimed: () => void
}) {
  const rawSegs = useMemo<RawSegment[]>(() => segments.map((s) => ({
    segment_id: s.segmentId,
    en_text: s.enText,
    en_start_sec: s.enStart ?? 0,
    en_end_sec: s.enEnd ?? 0,
    en_duration_sec: s.enDuration ?? 0,
    segment_type: s.segmentType ?? '',
    movement_keywords: s.movementKeywords ?? '',
  })), [segments])

  const model = useTimelineModel(rawSegs, onRetimed)
  const { peaks, peaksDurationSec } = usePeaks('/api/peaks/en')
  const words = useWords()

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

  // Audio elements: full EN (continuous) + one per language (per-segment scheduler).
  const enAudio = useRef<HTMLAudioElement>(null)
  const dubAudios = useRef<Map<string, HTMLAudioElement>>(new Map())
  const dubs = langs.map((l) => ({ lang: l, audible: audibleOf(l), volume: volOf(l) }))
  useTrackPlayback({
    video, enAudio, enAudible: audibleOf(EN), enVolume: volOf(EN),
    dubAudios, dubs, segments, getTimes: model.getTimes,
  })

  // Selection (matrix or block) → seek the video here + scroll into view.
  useEffect(() => {
    if (!selected || !video) return
    const row = segments[selected.seg]
    if (!row || row.enStart == null) return
    try { video.currentTime = Math.min(row.enStart, video.duration || row.enStart) } catch { /* */ }
    const sc = viewport.scrollerRef.current
    if (sc) {
      const x = viewport.timeToX(row.enStart)
      if (x < sc.scrollLeft || x > sc.scrollLeft + sc.clientWidth) sc.scrollLeft = Math.max(0, x - sc.clientWidth * 0.3)
    }
  }, [selected?.seg, selected?.lang, video]) // eslint-disable-line react-hooks/exhaustive-deps

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

  useEffect(() => { if (model.error) announce(model.error) }, [model.error, announce])

  // Spacebar toggles timeline playback (the video is the clock that drives all tracks).
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

  const cw = viewport.contentWidth

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

      {/* left rail (fixed) + scrollable multitrack */}
      <div className="flex">
        <div style={{ width: RAIL_W }} className="shrink-0 select-none rounded-l-md border border-r-0 border-gray-200 dark:border-[#29292c]">
          <div style={{ height: RULER_H }} className="border-b border-gray-200 dark:border-[#29292c]" />
          <TrackHeader
            name="Оригінал" sub="EN" height={TRACK_H} audible={audibleOf(EN)} volume={volOf(EN)}
            muted={Boolean(mute[EN])} solo={Boolean(solo[EN])}
            onMute={() => toggleMute(EN)} onSolo={() => toggleSolo(EN)} onVolume={(v) => setVolOf(EN, v)}
          />
          {langs.map((l) => (
            <TrackHeader
              key={l}
              name={l.toUpperCase()} sub="дубляж" height={TRACK_H} audible={audibleOf(l)} volume={volOf(l)}
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
              <RulerCanvas pxPerSecond={viewport.pxPerSecond} durationSec={durationSec} contentWidth={cw} />
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
                  selectedSeg={selected && selected.lang === l ? selected.seg : null}
                  editable={editable} inFlight={inFlight}
                  getWords={words.get} evictWords={words.evict} setDragging={model.setDragging}
                  announce={announce} onSelectIndex={(i) => onSelectCell(i, l)}
                />
              </div>
            ))}

            <Playhead video={video} pxPerSecond={viewport.pxPerSecond} scrollerRef={viewport.scrollerRef} />
          </div>
        </div>
      </div>

      <div className="mt-1 text-[11px] text-gray-400">
        Пробіл — грати/пауза · чуєш усі доріжки разом (M/S/гучність зліва) · тягни тіло сегмента — посунути, край — ретайм · амбер = дубляж довший за слот
      </div>
      <LiveRegion ref={liveRef} />
      <audio ref={enAudio} src="/api/audio/en" preload="auto" />
      {langs.map((l) => (
        <audio key={l} ref={(el) => { if (el) dubAudios.current.set(l, el); else dubAudios.current.delete(l) }} preload="auto" />
      ))}
    </div>
  )
}
