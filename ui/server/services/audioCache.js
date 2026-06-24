import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { config } from '../config.js'
import { computePeaks } from './peaks.js'

// Live audio is cached to disk keyed by (fileId, md5) — md5 is mandatory because
// W_Regen overwrites WAVs in place keeping the same fileId, so caching by id
// alone would serve stale audio. Mock audio is generated in memory (mockAudio).

const AUDIO_DIR = path.join(config.cacheDir, 'audio')
const PEAKS_DIR = path.join(config.cacheDir, 'peaks')
const MAX_BYTES = config.audioCacheMaxGb * 1024 * 1024 * 1024

fs.mkdirSync(AUDIO_DIR, { recursive: true })
fs.mkdirSync(PEAKS_DIR, { recursive: true })

const inflight = new Map()
const peaksMem = new Map() // mock peaks

function safeKey(fileId, md5) {
  return `${fileId}_${md5 || 'nomd5'}`.replace(/[^a-zA-Z0-9_.-]/g, '_')
}

/** Ensure a live file is on disk (download once, dedup concurrent). Returns {path,size}. */
export async function ensureAudioFile({ fileId, md5, fetchFull }) {
  const p = path.join(AUDIO_DIR, `${safeKey(fileId, md5)}.wav`)
  if (fs.existsSync(p)) { touch(p); return { path: p, size: fs.statSync(p).size } }
  if (inflight.has(p)) { await inflight.get(p); return { path: p, size: fs.statSync(p).size } }

  const promise = (async () => {
    const buf = await fetchFull()
    const tmp = `${p}.part`
    await fsp.writeFile(tmp, buf)
    await fsp.rename(tmp, p)
    evictIfNeeded()
  })()
  inflight.set(p, promise)
  try { await promise } finally { inflight.delete(p) }
  return { path: p, size: fs.statSync(p).size }
}

/** Peaks JSON, cached (disk for live, memory for mock). getBuffer lazily provides PCM bytes. */
export async function ensurePeaks({ fileId, md5, isMock, getBuffer }) {
  const key = safeKey(fileId, md5)
  if (isMock) {
    if (peaksMem.has(key)) return peaksMem.get(key)
    const peaks = computePeaks(await getBuffer())
    if (peaksMem.size < 64 && peaks) peaksMem.set(key, peaks)
    return peaks
  }
  const p = path.join(PEAKS_DIR, `${key}.json`)
  if (fs.existsSync(p)) {
    try { return JSON.parse(await fsp.readFile(p, 'utf8')) } catch { /* recompute */ }
  }
  const peaks = computePeaks(await getBuffer())
  if (peaks) await fsp.writeFile(p, JSON.stringify(peaks))
  return peaks
}

function touch(p) {
  const now = new Date()
  try { fs.utimesSync(p, now, now) } catch { /* ignore */ }
}

function evictIfNeeded() {
  try {
    const files = fs.readdirSync(AUDIO_DIR)
      .filter((f) => f.endsWith('.wav'))
      .map((f) => {
        const fp = path.join(AUDIO_DIR, f)
        const st = fs.statSync(fp)
        return { fp, size: st.size, mtime: st.mtimeMs }
      })
    let total = files.reduce((a, f) => a + f.size, 0)
    if (total <= MAX_BYTES) return
    files.sort((a, b) => a.mtime - b.mtime) // oldest first
    for (const f of files) {
      if (total <= MAX_BYTES) break
      try { fs.rmSync(f.fp); total -= f.size } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}
