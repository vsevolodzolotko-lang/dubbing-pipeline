import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

const DRIFT = 0.25 // s — re-seek an audio element only when it drifts past this

interface DubTrack { lang: string; audible: boolean; volume: number }
// One audio piece's timeline position + which slice of its source it plays.
interface ClipPos { id: string; rowKey: string; start: number; end: number; srcStart: number }

interface Opts {
  video: HTMLVideoElement | null
  enAudio: RefObject<HTMLAudioElement | null>
  enAudible: boolean
  enVolume: number
  dubAudios: RefObject<Map<string, HTMLAudioElement>>
  dubs: DubTrack[]
  // Per-language clip positions (sorted by start). A clip plays its source audio
  // (`/api/audio/segment/{rowKey}`) from `srcStart + (videoTime − clip.start)`, so
  // playback follows cut/moved/trimmed pieces.
  dubClips: Record<string, ClipPos[]>
}

/**
 * Continuous multitrack playback synced to the reference video (the clock, kept
 * muted — picture only). The ORIGINAL track plays the full EN audio; each LANGUAGE
 * track is a per-clip scheduler — at each frame it finds the clip under the
 * playhead and plays that clip's slice of its source audio. Every track plays (even
 * when inaudible) to stay in sync; audibility maps to element.muted and the volume
 * slider to element.volume, applied every frame. Sync is best-effort (re-seek past
 * DRIFT); small gaps at clip boundaries are expected.
 */
export function useTrackPlayback(opts: Opts) {
  const ref = useRef(opts)
  ref.current = opts

  useEffect(() => {
    const video = opts.video
    if (!video) return
    let raf = 0
    const dubState = new Map<string, { curId: string | null; curRk: string | null; pendingGo: (() => void) | null }>()
    const stateOf = (lang: string) => {
      let s = dubState.get(lang)
      if (!s) { s = { curId: null, curRk: null, pendingGo: null }; dubState.set(lang, s) }
      return s
    }

    const findClip = (lang: string, t: number): ClipPos | null => {
      const arr = ref.current.dubClips[lang] || []
      for (const c of arr) if (t >= c.start && t < c.end) return c
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
      const c = findClip(track.lang, t)
      const s = stateOf(track.lang)
      const id = c?.id ?? null
      if (id !== s.curId) {
        s.curId = id
        if (s.pendingGo) { a.removeEventListener('loadedmetadata', s.pendingGo); s.pendingGo = null }
        if (c) {
          if (s.curRk !== c.rowKey) { a.src = `/api/audio/segment/${c.rowKey}`; s.curRk = c.rowKey }
          const off = Math.max(0, c.srcStart + (t - c.start))
          const go = () => { s.pendingGo = null; try { a.currentTime = off } catch { /* */ }; if (allowPlay && !video.paused) a.play().catch(() => {}) }
          if (a.readyState >= 1) go()
          else { s.pendingGo = go; a.addEventListener('loadedmetadata', go, { once: true }) }
        } else {
          a.pause()
        }
      } else if (c) {
        const off = Math.max(0, c.srcStart + (t - c.start))
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
