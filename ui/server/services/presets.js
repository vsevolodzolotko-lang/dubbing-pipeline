import fs from 'node:fs'
import path from 'node:path'
import { config } from '../config.js'

// Local voice-preset library — a convenience store of liked voice settings.
// Lives in a JSON file (not the Sheet, no Google). Holds reusable single voices
// and named sets (lang → voice+settings). No secrets — only voice_id + numbers.
const FILE = path.join(config.cacheDir, 'voice-presets.json')
const VOICE_FIELDS = ['voice_id', 'voice_name', 'model', 'stability', 'similarity_boost', 'style', 'speed']

function load() {
  try {
    const d = JSON.parse(fs.readFileSync(FILE, 'utf8'))
    return { voices: Array.isArray(d.voices) ? d.voices : [], sets: Array.isArray(d.sets) ? d.sets : [] }
  } catch { return { voices: [], sets: [] } }
}

function save(store) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true })
  fs.writeFileSync(FILE, JSON.stringify(store, null, 2))
  return store
}

// Counter-based id (Date.now/random are fine in normal runtime, but a counter
// keyed off existing ids avoids collisions on rapid adds without timestamps).
function nextId(prefix, existing) {
  let n = 1
  const ids = new Set(existing.map((x) => x.id))
  while (ids.has(`${prefix}_${n}`)) n++
  return `${prefix}_${n}`
}

function pickVoiceFields(src) {
  const o = {}
  for (const k of VOICE_FIELDS) if (src[k] != null) o[k] = String(src[k])
  return o
}

export const presets = {
  all() { return load() },

  addVoice({ name, ...fields }) {
    const store = load()
    const item = { id: nextId('v', store.voices), name: String(name || 'Без назви'), ...pickVoiceFields(fields), createdAt: stamp() }
    store.voices.unshift(item)
    save(store)
    return store
  },

  addSet({ name, voices }) {
    const store = load()
    const cleaned = (Array.isArray(voices) ? voices : [])
      .filter((v) => v && v.lang)
      .map((v) => ({ lang: String(v.lang), ...pickVoiceFields(v) }))
    const item = { id: nextId('s', store.sets), name: String(name || 'Без назви'), voices: cleaned, createdAt: stamp() }
    store.sets.unshift(item)
    save(store)
    return store
  },

  removeVoice(id) { const s = load(); s.voices = s.voices.filter((x) => x.id !== id); return save(s) },
  removeSet(id) { const s = load(); s.sets = s.sets.filter((x) => x.id !== id); return save(s) },
}

// Best-effort timestamp; falls back to '' if Date is unavailable.
function stamp() {
  try { return new Date().toISOString() } catch { return '' }
}
