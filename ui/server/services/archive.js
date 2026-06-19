import fs from 'node:fs'
import path from 'node:path'
import { config } from '../config.js'
import { CONFIG_ALLOWLIST } from '../constants.js'
import { getAiPrompt } from './mockStore.js'

// Run archive — a local JSON history of completed staged lessons, each carrying
// a full settings SNAPSHOT (the config/voices/prompt/langs that produced it), so
// the operator can see exactly what was used. Lives in a JSON file (no Google),
// survives restarts (unlike the in-memory mock state).
const FILE = path.join(config.cacheDir, 'archive.json')

function load() {
  try {
    const d = JSON.parse(fs.readFileSync(FILE, 'utf8'))
    return { runs: Array.isArray(d.runs) ? d.runs : [] }
  } catch { return { runs: [] } }
}
function save(store) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true })
  fs.writeFileSync(FILE, JSON.stringify(store, null, 2))
  return store
}
function nextId(existing) {
  let n = 1
  const ids = new Set(existing.map((x) => x.id))
  while (ids.has(`run_${n}`)) n++
  return `run_${n}`
}

// Build a snapshot record from the current pipeline snapshot model.
function buildRecord(model, finishedAt, extra = {}) {
  const cfg = {}
  for (const key of CONFIG_ALLOWLIST) {
    const v = model.configMap?.get(key)
    if (v != null && v !== '') cfg[key] = String(v)
  }
  const langs = model.activeLangs || []
  const na = model.state?.needsAttention || { count: 0, total: 0, pct: 0 }
  return {
    lessonId: model.state?.lessonId ?? null,
    finishedAt,
    segCount: (model.segments || []).length,
    langCount: langs.length,
    langs,
    needsAttention: na,
    destination: extra.destination ?? null,
    settings: {
      config: cfg,
      voices: model.voices || [],
      activeLangs: langs,
      aiPrompt: getAiPrompt(),
    },
  }
}

export const archive = {
  // summaries only (no heavy settings blob) for the list view
  list() {
    return load().runs.map(({ settings, ...summary }) => summary)
  },
  get(id) {
    return load().runs.find((r) => r.id === id) || null
  },
  // capture a completed run from the snapshot model
  capture(model, finishedAt, extra = {}) {
    const store = load()
    const item = { id: nextId(store.runs), ...buildRecord(model, finishedAt, extra) }
    store.runs.unshift(item)
    save(store)
    return item
  },
}
