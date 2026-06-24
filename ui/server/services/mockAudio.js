// Deterministic synthetic WAV per fileId so the entire audio UI (player +
// waveform + A/B) works in mock mode with no live Drive files. Speech-like
// amplitude wobble so waveforms look distinct per cell.

const SAMPLE_RATE = 44100
const MAX_DURATION = 40 // cap mock clips
const cache = new Map() // fileId → Buffer (memoized)

function seedFrom(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function mockWav(fileId, durationSec) {
  const key = `${fileId}:${durationSec}`
  if (cache.has(key)) return cache.get(key)

  const dur = Math.max(0.5, Math.min(MAX_DURATION, durationSec || 4))
  const frames = Math.floor(dur * SAMPLE_RATE)
  const data = Buffer.alloc(frames * 2)

  let s = seedFrom(fileId)
  const rng = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296 }
  const baseFreq = 90 + (seedFrom(fileId) % 110) // 90..200 Hz, distinct per file
  const syllableHz = 2.5 + rng() * 2

  for (let i = 0; i < frames; i++) {
    const t = i / SAMPLE_RATE
    const fadeIn = Math.min(1, t * 4)
    const fadeOut = Math.min(1, (dur - t) * 2)
    const env = fadeIn * fadeOut
    const wobble = 0.35 + 0.65 * Math.abs(Math.sin(2 * Math.PI * syllableHz * t))
    const tone = Math.sin(2 * Math.PI * baseFreq * t) * wobble
    const noise = (rng() * 2 - 1) * 0.04
    const v = Math.max(-1, Math.min(1, (tone * 0.5 + noise) * env))
    data.writeInt16LE((v * 30000) | 0, i * 2)
  }

  const wav = wrapWav(data, SAMPLE_RATE, 1, 16)
  if (cache.size < 64) cache.set(key, wav)
  return wav
}

export function wrapWav(pcm, sampleRate, channels, bits) {
  const byteRate = (sampleRate * channels * bits) / 8
  const blockAlign = (channels * bits) / 8
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(bits, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}
