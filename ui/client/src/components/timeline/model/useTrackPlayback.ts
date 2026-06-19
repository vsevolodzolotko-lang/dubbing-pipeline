import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import type { SegmentRow } from '../../../api/types'
import type { Times } from './types'

const DRIFT = 0.25 // s — re-seek an audio element only when it drifts past this

interface DubTrack { lang: string; audible: boolean; volume: number }

interface Opts {
  video: HTMLVideoElement | null
  enAudio: RefObject<HTMLAudioElement | null>
  enAudible: boolean
  enVolume: number
  dubAudios: RefObject<Map<string, HTMLAudioElement>>
  dubs: DubTrack[]
  segments: SegmentRow[]
  getTimes: (id: string) => Times
}

/**
 * Continuous multitrack playback synced to the reference video (the clock, kept
 * muted — picture only). The ORIGINAL track plays the full EN audio; each
 * LANGUAGE track is a per-segment scheduler over its dub clips. Every track plays
 * (even when inaudible) to stay in sync; audibility (mute/solo) maps to
 * element.muted and the volume slider to element.volume, applied every frame so
 * changes are live. Sync is best-effort (re-seek past DRIFT); small gaps at
 * segment boundaries are expected.
 */
export function useTrackPlayback(opts: Opts) {
  const ref = useRef(opts)
  ref.current = opts

  useEffect(() => {
    const video = opts.video
    if (!video) return
    let raf = 0
    const dubState = new Map<string, { curRk: string | null; pendingGo: (() => void) | null }>()
    const stateOf = (lang: string) => {
      let s = dubState.get(lang)
      if (!s) { s = { curRk: null, pendingGo: null }; dubState.set(lang, s) }
      return s
    }

    const findSeg = (t: number) => {
      const { segments, getTimes } = ref.current
      for (const s of segments) {
        const tm = getTimes(s.segmentId)
        if (t >= tm.start && t < tm.end) return s
      }
      return null
    }
    const syncEn = (allowPlay: boolean) => {
      const a = ref.current.enAudio.current
      if (!a) return
      a.muted = !ref.current.enAudible
      a.volume = ref.current.enVolume
      if (Math.abs(a.currentTime - video.currentTime) > DRIFT) { try { a.currentTime = video.currentTime } catch { /* */ } }
      if (allowPlay && a.paused) a.play().catch(() => {})
    }
    const syncDub = (track: DubTrack, allowPlay: boolean) => {
      const a = ref.current.dubAudios.current?.get(track.lang)
      if (!a) return
      a.muted = !track.audible
      a.volume = track.volume
      const t = video.currentTime
      const seg = findSeg(t)
      const rk = seg?.cells[track.lang]?.rowKey ?? null
      const s = stateOf(track.lang)
      if (rk !== s.curRk) {
        s.curRk = rk
        if (s.pendingGo) { a.removeEventListener('loadedmetadata', s.pendingGo); s.pendingGo = null }
        if (rk && seg) {
          a.src = `/api/audio/segment/${rk}`
          const off = Math.max(0, t - ref.current.getTimes(seg.segmentId).start)
          const go = () => { s.pendingGo = null; try { a.currentTime = off } catch { /* */ }; if (allowPlay && !video.paused) a.play().catch(() => {}) }
          if (a.readyState >= 1) go()
          else { s.pendingGo = go; a.addEventListener('loadedmetadata', go, { once: true }) }
        } else {
          a.pause()
        }
      } else if (rk && seg) {
        const off = Math.max(0, t - ref.current.getTimes(seg.segmentId).start)
        if (Math.abs(a.currentTime - off) > DRIFT) { try { a.currentTime = off } catch { /* */ } }
        if (allowPlay && a.paused) a.play().catch(() => {})
      }
    }
    const syncAll = (allowPlay: boolean) => { syncEn(allowPlay); for (const d of ref.current.dubs) syncDub(d, allowPlay) }
    const pauseAll = () => {
      ref.current.enAudio.current?.pause()
      const m = ref.current.dubAudios.current
      if (m) for (const a of m.values()) a.pause()
    }

    const loop = () => { syncAll(true); raf = requestAnimationFrame(loop) }
    const onPlay = () => { cancelAnimationFrame(raf); loop() }
    const onPause = () => { cancelAnimationFrame(raf); pauseAll() }
    const onEnded = () => { cancelAnimationFrame(raf); pauseAll(); dubState.clear() }
    const onSeeked = () => syncAll(!video.paused)

    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    video.addEventListener('ended', onEnded)
    video.addEventListener('seeked', onSeeked)
    return () => {
      cancelAnimationFrame(raf)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('ended', onEnded)
      video.removeEventListener('seeked', onSeeked)
      const m = ref.current.dubAudios.current
      if (m) for (const [lang, a] of m.entries()) {
        const pg = dubState.get(lang)?.pendingGo
        if (pg) a.removeEventListener('loadedmetadata', pg)
      }
      pauseAll()
    }
  }, [opts.video])
}
