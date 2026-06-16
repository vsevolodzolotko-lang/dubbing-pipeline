import fsp from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { config } from '../config.js'
import { mockWav, wrapWav } from '../services/mockAudio.js'
import { findDataChunk } from '../services/peaks.js'
import { ensureAudioFile, ensurePeaks } from '../services/audioCache.js'

const num = (v) => (v === '' || v == null || isNaN(Number(v)) ? null : Number(v))
const isMock = () => config.mode === 'mock'

// Short-lived md5 cache for per-segment live files (02_output isn't polled).
const segMetaCache = new Map() // fileId → { md5, ts }

export function registerAudioRoutes(fastify, { snapshot, drive }) {
  // ── audio (Range-capable) ──────────────────────────────────────────────
  fastify.get('/api/audio/segment/:rowKey', async (req, reply) => {
    const r = resolveSegment(snapshot, req.params.rowKey)
    if (!r) return reply.code(404).send({ error: 'segment not found' })
    return serveAudio(req, reply, drive, r)
  })

  fastify.get('/api/audio/full/:lang', async (req, reply) => {
    const r = resolveFull(snapshot, req.params.lang)
    if (!r) return reply.code(404).send({ error: 'full audio not found' })
    return serveAudio(req, reply, drive, r)
  })

  fastify.get('/api/audio/en', async (req, reply) => {
    const r = resolveEn(snapshot)
    if (!r) return reply.code(404).send({ error: 'EN source not found' })
    return serveAudio(req, reply, drive, r)
  })

  // EN region for one segment: a self-contained clip exactly the segment's
  // length, so the player stops on `ended` — no seeking, no stop timer.
  fastify.get('/api/audio/en/segment/:rowKey', async (req, reply) => {
    const r = resolveEnRegion(snapshot, req.params.rowKey)
    if (!r) return reply.code(404).send({ error: 'EN region not found' })
    return serveEnRegion(req, reply, drive, r)
  })

  // ── peaks (JSON) ────────────────────────────────────────────────────────
  fastify.get('/api/peaks/segment/:rowKey', async (req, reply) => {
    const r = resolveSegment(snapshot, req.params.rowKey)
    if (!r) return reply.code(404).send({ error: 'segment not found' })
    return servePeaks(reply, drive, r)
  })
  fastify.get('/api/peaks/full/:lang', async (req, reply) => {
    const r = resolveFull(snapshot, req.params.lang)
    if (!r) return reply.code(404).send({ error: 'full audio not found' })
    return servePeaks(reply, drive, r)
  })
  fastify.get('/api/peaks/en', async (req, reply) => {
    const r = resolveEn(snapshot)
    if (!r) return reply.code(404).send({ error: 'EN source not found' })
    return servePeaks(reply, drive, r)
  })
}

// ── resolution from the snapshot ───────────────────────────────────────────

function resolveSegment(snapshot, rowKey) {
  const m = snapshot.get()
  const loc = m.localizations.find((x) => x.row_key === rowKey)
  if (!loc || !loc.audio_drive_file_id) return null
  const seg = m.segments.find((s) => s.segment_id === loc.segment_id)
  const duration = num(loc.final_duration_sec) || num(loc.real_duration_sec) || num(seg?.en_duration_sec) || 4
  return { kind: 'segment', fileId: loc.audio_drive_file_id, duration, mp3: false }
}

function resolveFull(snapshot, lang) {
  const m = snapshot.get()
  const f = m.drive.full.find((x) => x.name && x.name.endsWith(`_full_${lang}.wav`))
  if (!f) return null
  return { kind: 'full', fileId: f.id, md5: f.md5Checksum, duration: totalDuration(m), mp3: false }
}

function resolveEn(snapshot) {
  const m = snapshot.get()
  const f = m.drive.input?.[0]
  if (!f) return null
  return { kind: 'en', fileId: f.id, md5: f.md5Checksum, duration: totalDuration(m), mp3: /\.mp3$/i.test(f.name || '') }
}

function resolveEnRegion(snapshot, rowKey) {
  const m = snapshot.get()
  const loc = m.localizations.find((x) => x.row_key === rowKey)
  if (!loc) return null
  const seg = m.segments.find((s) => s.segment_id === loc.segment_id)
  if (!seg) return null
  const start = num(seg.en_start_sec) ?? 0
  const dur = num(seg.en_duration_sec) ?? 3
  const src = m.drive.input?.[0]
  return { rowKey, start, dur, fileId: src?.id, md5: src?.md5Checksum, mp3: /\.mp3$/i.test(src?.name || '') }
}

function totalDuration(m) {
  let max = 0
  for (const s of m.segments) {
    const e = num(s.en_end_sec)
    if (e && e > max) max = e
    const a = num(s.audio_duration_sec)
    if (a && a > max) max = a
  }
  return max || 30
}

// ── serving ─────────────────────────────────────────────────────────────────

async function serveAudio(req, reply, drive, r) {
  try {
    if (isMock()) {
      return sendRangeFromBuffer(req, reply, mockWav(r.fileId, r.duration))
    }
    const md5 = r.md5 || (await segMd5(drive, r.fileId))
    const { path, size } = await ensureAudioFile({
      fileId: r.fileId, md5, fetchFull: () => fetchFull(drive, r.fileId),
    })
    return sendRangeFromFile(req, reply, path, size)
  } catch (e) {
    req.log?.error?.(e)
    return reply.code(502).send({ error: 'audio fetch failed', detail: e.message })
  }
}

async function serveEnRegion(req, reply, drive, r) {
  try {
    if (isMock()) {
      // distinct seed from the dub so the original sounds different
      return sendRangeFromBuffer(req, reply, mockWav(`en_${r.rowKey}`, r.dur))
    }
    if (!r.fileId) return reply.code(404).send({ error: 'EN source not found' })
    const md5 = r.md5 || (await segMd5(drive, r.fileId))
    const { path } = await ensureAudioFile({ fileId: r.fileId, md5, fetchFull: () => fetchFull(drive, r.fileId) })
    const buf = await fsp.readFile(path)
    // mp3 source can't be trimmed without a decoder — serve full (rare; live-only)
    const clip = r.mp3 ? null : trimWavRegion(buf, r.start, r.dur)
    return sendRangeFromBuffer(req, reply, clip || buf)
  } catch (e) {
    req.log?.error?.(e)
    return reply.code(502).send({ error: 'EN region failed', detail: e.message })
  }
}

function trimWavRegion(buf, start, dur) {
  const d = findDataChunk(buf)
  if (!d.ok) return null
  const sr = d.fmt?.sampleRate || 44100
  const ch = d.fmt?.channels || 1
  const bits = d.fmt?.bitsPerSample || 16
  const frame = ch * (bits / 8)
  const totalFrames = Math.floor(d.dataSize / frame)
  const startFrame = Math.max(0, Math.floor(start * sr))
  const endFrame = Math.min(totalFrames, Math.floor((start + dur) * sr))
  if (endFrame <= startFrame) return null
  const pcm = buf.subarray(d.dataOffset + startFrame * frame, d.dataOffset + endFrame * frame)
  return wrapWav(pcm, sr, ch, bits)
}

async function servePeaks(reply, drive, r) {
  try {
    const md5 = isMock() ? `mock_${r.fileId}` : (r.md5 || (await segMd5(drive, r.fileId)))
    const peaks = await ensurePeaks({
      fileId: r.fileId, md5, isMock: isMock(),
      getBuffer: async () => {
        if (isMock()) return mockWav(r.fileId, r.duration)
        const { path } = await ensureAudioFile({ fileId: r.fileId, md5, fetchFull: () => fetchFull(drive, r.fileId) })
        return fsp.readFile(path)
      },
    })
    if (!peaks) return reply.code(200).send({ unavailable: true, durationSec: r.duration })
    return reply.send(peaks)
  } catch (e) {
    return reply.code(502).send({ error: 'peaks failed', detail: e.message })
  }
}

async function fetchFull(drive, fileId) {
  const res = await drive.streamMedia(fileId)
  const ab = await res.arrayBuffer()
  return Buffer.from(ab)
}

async function segMd5(drive, fileId) {
  const hit = segMetaCache.get(fileId)
  if (hit && Date.now() - hit.ts < 60_000) return hit.md5
  const meta = await drive.getMeta(fileId, 'md5Checksum')
  segMetaCache.set(fileId, { md5: meta.md5Checksum || 'nomd5', ts: Date.now() })
  return meta.md5Checksum || 'nomd5'
}

function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header || '')
  if (!m) return null
  let start = m[1] ? parseInt(m[1], 10) : 0
  let end = m[2] ? parseInt(m[2], 10) : size - 1
  if (isNaN(start) || isNaN(end) || start > end || end >= size) return null
  return { start, end }
}

function sendRangeFromBuffer(req, reply, buf) {
  const size = buf.length
  const range = parseRange(req.headers.range, size)
  reply.header('Accept-Ranges', 'bytes')
  reply.header('Content-Type', 'audio/wav')
  if (!range) {
    reply.header('Content-Length', size)
    return reply.send(buf)
  }
  reply.code(206)
  reply.header('Content-Range', `bytes ${range.start}-${range.end}/${size}`)
  reply.header('Content-Length', range.end - range.start + 1)
  return reply.send(buf.subarray(range.start, range.end + 1))
}

function sendRangeFromFile(req, reply, path, size) {
  const range = parseRange(req.headers.range, size)
  reply.header('Accept-Ranges', 'bytes')
  reply.header('Content-Type', 'audio/wav')
  if (!range) {
    reply.header('Content-Length', size)
    return reply.send(createReadStream(path))
  }
  reply.code(206)
  reply.header('Content-Range', `bytes ${range.start}-${range.end}/${size}`)
  reply.header('Content-Length', range.end - range.start + 1)
  return reply.send(createReadStream(path, { start: range.start, end: range.end }))
}
