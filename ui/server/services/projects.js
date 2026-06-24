import fs from 'node:fs'
import path from 'node:path'
import { config } from '../config.js'
import { RUN_STATES } from '../constants.js'

// Project registry — a local JSON index of every uploaded lesson, each its own
// "sheet-per-project" (live: its own Spreadsheet + Drive folder tree; mock: its
// own seeded dataset). Mirrors archive.js: plain JSON in config.cacheDir, no DB.
// The JSON is only an index/navigation layer — the content lives in the project's
// own sheet (live) or mock dataset. `spreadsheetId`/`folders` are MOCK placeholders
// here; in live they become real Drive/Sheets IDs (the record shape is unchanged).
const FILE = path.join(config.cacheDir, 'projects.json')

// Schema version of a project record / its underlying sheet. Bump when the shape
// evolves; pair additive changes with code-side defaults so old records read clean
// (see load() defaulting below). Lazy migrations run on open() in live (Фаза 6).
export const CURRENT_SCHEMA_VERSION = 1

const STATUS = {
  NEW: 'new',
  IN_PROGRESS: 'in_progress',
  REVIEW: 'review',
  DONE: 'done',
  STOPPED: 'stopped',
}

// Map the derived run-state → a coarse, durable project status (kept deliberately
// small so it survives the live cutover unchanged).
function mapStateToStatus(state) {
  switch (state) {
    case RUN_STATES.COMPLETE: return STATUS.DONE
    case RUN_STATES.STOPPED: return STATUS.STOPPED
    case RUN_STATES.TRANSCRIPT_REVIEW:
    case RUN_STATES.TRANSLATION_REVIEW:
    case RUN_STATES.AUDIO_REVIEW:
    case RUN_STATES.RENDER_REVIEW:
      return STATUS.REVIEW
    case RUN_STATES.IDLE:
    case RUN_STATES.UNKNOWN:
    case undefined:
    case null:
      return STATUS.NEW
    default:
      return STATUS.IN_PROGRESS // STARTING/STT/TRANSLATING/SYNTHESIZING/RENDERING/REGENERATING/…
  }
}

function emptySummary() {
  return { segCount: 0, langCount: 0, langs: [], needsAttention: { count: 0, total: 0, pct: 0 } }
}

// Defaults applied on read so records written by an older schema parse cleanly
// (the "code-side defaults" discipline — additive changes need no migration).
function normalize(p) {
  p.schemaVersion ??= 0
  p.status ??= STATUS.NEW
  p.summary ??= emptySummary()
  p.folders ??= { input: '', segmentOutput: '', full: '', vtt: '' }
  return p
}

function load() {
  try {
    const d = JSON.parse(fs.readFileSync(FILE, 'utf8'))
    return {
      activeId: typeof d.activeId === 'string' ? d.activeId : null,
      projects: Array.isArray(d.projects) ? d.projects.map(normalize) : [],
    }
  } catch { return { activeId: null, projects: [] } }
}

function save(store) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true })
  fs.writeFileSync(FILE, JSON.stringify(store, null, 2))
  return store
}

function nextId(existing) {
  let n = 1
  const ids = new Set(existing.map((x) => x.id))
  while (ids.has(`proj_${n}`)) n++
  return `proj_${n}`
}

// MOCK placeholder IDs — the only fields that become real in live (Фаза 6:
// drive.createFolder tree + sheets.copyTemplate). Record shape is identical.
function mockIds(id) {
  return {
    spreadsheetId: `mock_sheet_${id}`,
    folders: {
      input: `mock_input_${id}`,
      segmentOutput: `mock_segout_${id}`,
      full: `mock_full_${id}`,
      vtt: `mock_vtt_${id}`,
    },
  }
}

export function makeProjectsService() {
  function list() {
    return load().projects
  }

  function get(id) {
    return load().projects.find((p) => p.id === id) || null
  }

  function getActive() {
    const store = load()
    return store.projects.find((p) => p.id === store.activeId) || null
  }

  // Create a new project record and make it active. Returns the full record.
  // `status`/`summary` are optional initial overrides used by bootstrap to seed
  // the demo projects' list preview before any snapshot poll exists; normal
  // creates leave them at the NEW/empty defaults (refined later by updateSummary).
  function create({ name, sourceFileName = '', templateId = null, langs = [], status, summary } = {}) {
    const store = load()
    const id = nextId(store.projects)
    const now = new Date().toISOString()
    const ids = mockIds(id)
    const safeLangs = Array.isArray(langs) ? langs.filter(Boolean) : []
    const rec = normalize({
      id,
      name: String(name || id),
      sourceFileName: String(sourceFileName || ''),
      templateId: templateId || null,
      spreadsheetId: ids.spreadsheetId,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      folders: ids.folders,
      status: status || STATUS.NEW,
      createdAt: now,
      updatedAt: now,
      summary: summary || { ...emptySummary(), langCount: safeLangs.length, langs: safeLangs },
    })
    store.projects.unshift(rec)
    store.activeId = id
    save(store)
    return rec
  }

  function setActive(id) {
    const store = load()
    const p = store.projects.find((x) => x.id === id)
    if (!p) return { ok: false, error: `проєкт ${id} не знайдено` }
    store.activeId = id
    p.updatedAt = new Date().toISOString()
    save(store)
    return { ok: true, id }
  }

  // Refresh a project's derived summary + status from a snapshot model.
  function updateSummary(id, model) {
    const store = load()
    const p = store.projects.find((x) => x.id === id)
    if (!p) return null
    const langs = model?.activeLangs || []
    p.summary = {
      segCount: (model?.segments || []).length,
      langCount: langs.length,
      langs,
      needsAttention: model?.state?.needsAttention || emptySummary().needsAttention,
    }
    p.status = mapStateToStatus(model?.state?.state)
    p.updatedAt = new Date().toISOString()
    save(store)
    return p
  }

  return { list, get, getActive, create, setActive, updateSummary, nextId, STATUS, CURRENT_SCHEMA_VERSION }
}
