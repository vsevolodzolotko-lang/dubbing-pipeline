import type { ReactNode, RefObject } from 'react'
import { LANE_H, RULER_H } from './lib/constants'
import { WindowedRuler } from './WindowedRuler'
import { WaveformCanvas } from './WaveformCanvas'
import { Playhead } from './Playhead'
import { useScrub } from './model/useScrub'
import type { Peaks } from './model/types'

/**
 * Track chrome shared by the transcript and audio timelines: a horizontally-
 * scrollable container with the ruler, full-width waveform, playhead overlay, and
 * a slot for the blocks `lane`. Clicking the empty background or the ruler scrubs
 * the reference video; two-finger horizontal swipe scrolls (overscroll contained).
 */
export function TimeTrack({
  scrollerRef, contentWidth, durationSec, pxPerSecond, peaks, video,
  clientXToContentX, xToTime, lane,
}: {
  scrollerRef: RefObject<HTMLDivElement>
  contentWidth: number
  durationSec: number
  pxPerSecond: number
  peaks: Peaks | null
  video: HTMLVideoElement | null
  clientXToContentX: (clientX: number) => number
  xToTime: (x: number) => number
  lane: ReactNode
}) {
  const scrub = useScrub(video, clientXToContentX, xToTime, durationSec)

  return (
    <div
      ref={scrollerRef}
      className="relative overflow-x-auto overflow-y-hidden overscroll-x-contain rounded-md border border-gray-200 bg-gray-50 dark:border-[#29292c] dark:bg-[#161617]"
    >
      <div className="relative" style={{ width: contentWidth }}>
        <div style={{ height: RULER_H }} onPointerDown={scrub}
          className="cursor-pointer border-b border-gray-200 dark:border-[#29292c]">
          <WindowedRuler scrollerRef={scrollerRef} pxPerSecond={pxPerSecond} durationSec={durationSec} />
        </div>
        <div className="relative" style={{ height: LANE_H }}>
          <WaveformCanvas peaks={peaks} contentWidth={contentWidth} pxPerSecond={pxPerSecond} />
          <div className="absolute inset-0 cursor-pointer" onPointerDown={scrub} />
          {lane}
        </div>
        <Playhead video={video} pxPerSecond={pxPerSecond} scrollerRef={scrollerRef} />
      </div>
    </div>
  )
}
