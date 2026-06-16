// Pure-JS waveform peaks from a canonical PCM WAV buffer. No ffmpeg. Defensive
// chunk-walk to find `data` so a hand-replaced file (e.g. ElevenLabs UI with an
// extra LIST chunk) still works; non-PCM/non-16-bit → peaks skipped, playback
// still fine in the browser.

const OVERVIEW_BUCKETS = 2000
const DETAIL_PER_SEC = 50
const DETAIL_MAX_BUCKETS = 40_000

export function findDataChunk(buf) {
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF') {
    return { ok: false }
  }
  let off = 12
  let fmt = null
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4)
    const size = buf.readUInt32LE(off + 4)
    if (id === 'fmt ' && off + 24 <= buf.length) {
      fmt = {
        audioFormat: buf.readUInt16LE(off + 8),
        channels: buf.readUInt16LE(off + 10),
        sampleRate: buf.readUInt32LE(off + 12),
        bitsPerSample: buf.readUInt16LE(off + 22),
      }
    } else if (id === 'data') {
      const dataOffset = off + 8
      return { ok: true, fmt, dataOffset, dataSize: Math.min(size, buf.length - dataOffset) }
    }
    off += 8 + size + (size % 2) // chunks are word-aligned
  }
  return { ok: false, fmt }
}

export function computePeaks(buf) {
  const { ok, fmt, dataOffset, dataSize } = findDataChunk(buf)
  if (!ok) return null
  const sampleRate = fmt?.sampleRate || 44100
  const channels = fmt?.channels || 1
  const bits = fmt?.bitsPerSample || 16
  if ((fmt && fmt.audioFormat !== 1) || bits !== 16) return null // only PCM16 for now

  const frameBytes = (bits / 8) * channels
  const totalFrames = Math.floor(dataSize / frameBytes)
  const durationSec = totalFrames / sampleRate
  if (totalFrames === 0) return null

  const detailBuckets = Math.min(DETAIL_MAX_BUCKETS, Math.max(1, Math.ceil(durationSec * DETAIL_PER_SEC)))
  return {
    sampleRate,
    durationSec: +durationSec.toFixed(3),
    overview: bucketize(buf, dataOffset, totalFrames, channels, OVERVIEW_BUCKETS),
    detail: bucketize(buf, dataOffset, totalFrames, channels, detailBuckets),
  }
}

// Max absolute amplitude per bucket, normalized 0..1, channel 0 only.
function bucketize(buf, dataOffset, totalFrames, channels, buckets) {
  const out = new Array(buckets).fill(0)
  const framesPerBucket = totalFrames / buckets
  for (let b = 0; b < buckets; b++) {
    const startFrame = Math.floor(b * framesPerBucket)
    const endFrame = Math.min(totalFrames, Math.floor((b + 1) * framesPerBucket))
    let peak = 0
    for (let f = startFrame; f < endFrame; f++) {
      const sampleOffset = dataOffset + f * channels * 2
      if (sampleOffset + 1 >= buf.length) break
      const v = Math.abs(buf.readInt16LE(sampleOffset))
      if (v > peak) peak = v
    }
    out[b] = +(peak / 32768).toFixed(3)
  }
  return out
}
