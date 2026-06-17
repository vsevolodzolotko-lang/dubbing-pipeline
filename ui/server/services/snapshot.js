import { config, writesEnabled } from '../config.js'
import { TABS, DEFAULT_LANGS, CONFIG_KEYS, RUN_STATES } from '../constants.js'
import { computeRunState } from './runState.js'
import { regenTracker } from './regenTracker.js'
import * as mockStore from './mockStore.js'

const ACTIVE_INTERVAL_MS = 5_000
const IDLE_INTERVAL_MS = 30_000
const PROMPTS_EVERY = 10 // poll prompts (large cells) 1 in N ticks

/**
 * The single source of truth for all read endpoints. Polls Sheets + Drive (or
 * fixtures in mock mode), parses header-driven, runs the state machine, and
 * broadcasts SSE on change. HTTP read handlers never call Google directly.
 */
export function makeSnapshotService({ auth, sheets, drive, broadcast, getClientCount }) {
  let model = emptyModel()
  let prev = null
  let tick = 0
  let timer = null
  let lastChangeAt = Date.now()
  let lastContentHash = ''
  let lastRegenSig = ''
  let stopped = false
  // Per-run timing tracker: rate is measured from when WE first observed synthesis
  // (baselineRows), so ETA is correct even if the UI starts mid-run.
  let runTimer = { token: null, synthStartedAt: null, baselineRows: 0 }

  async function fetchTabs() {
    if (config.mode === 'mock') {
      const t = mockStore.tabs()
      const includePrompts = tick % PROMPTS_EVERY === 0
      return { ...t, prompts: includePrompts ? t.prompts : model.raw?.prompts ?? t.prompts }
    }
    const includePrompts = tick % PROMPTS_EVERY === 0 || !model.raw?.prompts
    const ranges = [
      `${TABS.config}!A:B`,
      `${TABS.segments}!A:BZ`,
      `${TABS.localizations}!A:AZ`,
      `${TABS.voices}!A:Z`,
      ...(includePrompts ? [`${TABS.prompts}!A:C`] : []),
    ]
    const vr = await sheets.batchGet(ranges)
    const byRange = Object.fromEntries(vr.map((r) => [tabName(r.range), r.values || []]))
    return {
      config: byRange[TABS.config] || [],
      segments: byRange[TABS.segments] || [],
      localizations: byRange[TABS.localizations] || [],
      voices: byRange[TABS.voices] || [],
      prompts: includePrompts ? byRange[TABS.prompts] || [] : model.raw?.prompts || [],
    }
  }

  async function fetchDrive(configMap) {
    if (config.mode === 'mock') return mockStore.drive()
    const inputId = configMap.get(CONFIG_KEYS.inputFolder)
    const fullId = configMap.get(CONFIG_KEYS.fullFolder)
    const vttId = configMap.get(CONFIG_KEYS.vttFolder)
    const [input, full, vtt] = await Promise.all([
      inputId ? drive.listFolder(inputId).catch(() => []) : Promise.resolve([]),
      fullId ? drive.listFolder(fullId).catch(() => []) : Promise.resolve([]),
      vttId ? drive.listFolder(vttId).catch(() => []) : Promise.resolve([]),
    ])
    return { input, full, vtt }
  }

  async function poll() {
    try {
      if (config.mode === 'mock') mockStore.tick(Date.now())
      const tabs = await fetchTabs()
      const configMap = parseKeyValue(tabs.config)
      const drv = await fetchDrive(configMap)

      const segments = parseTable(tabs.segments)
      const localizations = parseTable(tabs.localizations)
      const voices = parseTable(tabs.voices)
      const prompts = parseTable(tabs.prompts)
      const activeLangs = parseActiveLangs(configMap)

      const contentHash = hashContent({ tabs, drv })
      const now = Date.now()
      if (contentHash !== lastContentHash) {
        lastChangeAt = now
        lastContentHash = contentHash
      }
      const staleMs = now - lastChangeAt

      const state = computeRunState({
        configMap,
        segments: segments.objects,
        localizations: localizations.objects,
        voices: voices.objects,
        driveFull: drv.full,
        driveInput: drv.input,
        activeLangs,
        staleMs,
      })

      // ── run timing (elapsed + ETA) ──
      const runTokenVal = (configMap.get(CONFIG_KEYS.runToken) || '').toString().trim()
      const locCount = localizations.objects.length
      const expectedRows = segments.objects.length * activeLangs.length
      if (runTokenVal !== runTimer.token) {
        runTimer = { token: runTokenVal, synthStartedAt: null, baselineRows: 0 }
      }
      if (state.state === RUN_STATES.SYNTHESIZING && runTimer.synthStartedAt == null && locCount > 0) {
        runTimer.synthStartedAt = now
        runTimer.baselineRows = locCount
      }
      const timing = buildTiming({ runTokenVal, stateName: state.state, locCount, expectedRows, now, runTimer, lastChangeAt })

      const nextModel = {
        ok: true,
        mode: config.mode,
        version: model.version + 1,
        configMap,
        segments: segments.objects,
        localizations: localizations.objects,
        voices: voices.objects,
        prompts: prompts.objects,
        drive: drv,
        activeLangs,
        state,
        timing,
        raw: tabs,
        lastPollAt: new Date(now).toISOString(),
        lastError: null,
      }

      diffAndBroadcast(prev, nextModel)

      // regen in-flight tracking → SSE `regen` (done/stale transitions + progress)
      const regen = regenTracker.evaluate(localizations.objects, now)
      const regenSig = JSON.stringify(regen.status)
      if (regen.event || regenSig !== lastRegenSig) {
        broadcast('regen', { ...regen.status, event: regen.event })
        lastRegenSig = regenSig
      }

      prev = nextModel
      model = nextModel
    } catch (e) {
      model = { ...model, ok: false, lastError: classifyError(e) }
      broadcast('state', { ...statePayload(model), error: model.lastError })
    } finally {
      tick++
      if (!stopped) timer = setTimeout(poll, intervalMs())
    }
  }

  function intervalMs() {
    const clients = getClientCount?.() ?? 0
    const active = model.state && model.state.readOnly
    return active || clients > 0 ? ACTIVE_INTERVAL_MS : IDLE_INTERVAL_MS
  }

  function diffAndBroadcast(before, after) {
    const stateChanged = !before ||
      before.state?.state !== after.state?.state ||
      JSON.stringify(before.state?.progress) !== JSON.stringify(after.state?.progress) ||
      before.state?.needsAttention?.count !== after.state?.needsAttention?.count
    if (stateChanged) broadcast('state', statePayload(after))

    const changed = changedRowKeys(before?.localizations, after.localizations)
    if (changed.length) broadcast('rows_changed', { rowKeys: changed, version: after.version })
  }

  // Force an immediate re-poll (used after a write so the UI reflects it now,
  // not on the next 5s tick). Safe: poll() reschedules its own timer.
  function pokeNow() {
    if (stopped) return
    if (timer) clearTimeout(timer)
    poll()
  }

  return {
    start() {
      stopped = false
      poll()
    },
    stop() {
      stopped = true
      if (timer) clearTimeout(timer)
    },
    get() { return model },
    refresh: pokeNow,
    statePayload: () => statePayload(model),
    auth, sheets, drive,
  }
}

// ─── parsing ───────────────────────────────────────────────────────────────

function parseKeyValue(rows) {
  const map = new Map()
  for (const r of rows.slice(1)) {
    if (!r || r[0] == null || r[0] === '') continue
    map.set(String(r[0]).trim(), r[1] ?? '')
  }
  return map
}

/** Header-driven: row 0 is the header, every data row becomes {header: value}. */
function parseTable(rows) {
  if (!rows || rows.length === 0) return { header: [], index: new Map(), objects: [] }
  const header = rows[0].map((h) => String(h ?? '').trim())
  const index = new Map(header.map((h, i) => [h, i]))
  const objects = []
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]
    if (!r || r.every((c) => c === '' || c == null)) continue
    const o = {}
    for (let c = 0; c < header.length; c++) if (header[c]) o[header[c]] = r[c] ?? ''
    objects.push(o)
  }
  return { header, index, objects }
}

function parseActiveLangs(configMap) {
  const raw = String(configMap.get(CONFIG_KEYS.activeLangs) || '').trim()
  if (!raw) return DEFAULT_LANGS
  return raw.split(',').map((s) => s.trim()).filter(Boolean)
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function emptyModel() {
  return {
    ok: false, mode: config.mode, version: 0, configMap: new Map(),
    segments: [], localizations: [], voices: [], prompts: [],
    drive: { input: [], full: [], vtt: [] }, activeLangs: DEFAULT_LANGS,
    state: { state: 'UNKNOWN', readOnly: false, progress: {}, needsAttention: { count: 0, total: 0, pct: 0 } },
    timing: null,
    raw: null, lastPollAt: null, lastError: null,
  }
}

function statePayload(m) {
  return {
    ...m.state,
    timing: m.timing || null,
    mode: m.mode,
    version: m.version,
    lastPollAt: m.lastPollAt,
    enableWrites: writesEnabled,
  }
}

/** Elapsed since run_token + ETA from observed synthesis rate. */
function buildTiming({ runTokenVal, stateName, locCount, expectedRows, now, runTimer, lastChangeAt }) {
  const startMs = parseTokenMs(runTokenVal)
  const runStartedAt = startMs ? new Date(startMs).toISOString() : null

  let elapsedSec = null
  if (startMs) {
    const frozen = stateName === RUN_STATES.COMPLETE || stateName === RUN_STATES.STOPPED
    const endRef = frozen ? lastChangeAt : now
    elapsedSec = Math.max(0, Math.round((endRef - startMs) / 1000))
  }

  let etaSec = null
  let etaAt = null
  let rowsPerMin = null
  if (stateName === RUN_STATES.SYNTHESIZING && runTimer.synthStartedAt && expectedRows > locCount) {
    const producedSince = locCount - runTimer.baselineRows
    const obsSec = (now - runTimer.synthStartedAt) / 1000
    if (producedSince >= 3 && obsSec >= 20) {
      const ratePerSec = producedSince / obsSec
      rowsPerMin = +(ratePerSec * 60).toFixed(1)
      etaSec = Math.round((expectedRows - locCount) / ratePerSec)
      etaAt = new Date(now + etaSec * 1000).toISOString()
    }
  }

  return { runStartedAt, elapsedSec, etaSec, etaAt, rowsPerMin, rowsDone: locCount, rowsTotal: expectedRows }
}

function parseTokenMs(v) {
  if (!v) return null
  let ms = Date.parse(v)
  if (isNaN(ms)) ms = Date.parse(String(v).replace(' ', 'T'))
  return isNaN(ms) ? null : ms
}

function changedRowKeys(before, after) {
  if (!before) return []
  const b = new Map(before.map((r) => [r.row_key, hashRow(r)]))
  const out = []
  for (const r of after) {
    if (b.get(r.row_key) !== hashRow(r)) out.push(r.row_key)
  }
  return out
}

function hashRow(r) {
  return `${r.text_translated}|${r.needs_attention}|${r.needs_retts}|${r.last_regen_at}|${r.final_speed}|${r.real_duration_sec}`
}

function hashContent({ tabs, drv }) {
  return [
    tabs.config?.length, tabs.segments?.length, tabs.localizations?.length,
    drv.full?.map((f) => f.md5Checksum).join(','),
    drv.input?.map((f) => f.md5Checksum).join(','),
    // localizations content matters, not just count:
    JSON.stringify((tabs.localizations || []).map((r) => [r])).length,
  ].join(':')
}

function tabName(range) {
  return String(range || '').split('!')[0].replace(/^'|'$/g, '')
}

function classifyError(e) {
  const status = e.status
  if (status === 401) return { code: 'auth', message: 'Авторизація відхилена (ключ недійсний або зсув годинника)' }
  if (status === 403) return { code: 'forbidden', message: 'Таблиця/тека не розшарена на service account' }
  if (status === 404) return { code: 'notfound', message: 'Не знайдено таблицю або теку (перевір ID)' }
  if (status === 429) return { code: 'quota', message: 'Перевищено квоту Google API — авто-backoff' }
  return { code: 'unknown', message: e.message || 'Невідома помилка' }
}
