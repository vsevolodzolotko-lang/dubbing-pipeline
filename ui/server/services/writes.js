import { TABS, WRITABLE_LOCALIZATION_COLS, VOICE_WRITABLE_COLS } from '../constants.js'
import { config } from '../config.js'
import * as mockStore from './mockStore.js'

// Serialized write queue: one in-flight write chain per process, so concurrent
// actions can't interleave reads/writes against the same sheet.
let chain = Promise.resolve()
export function withWriteLock(fn) {
  const run = chain.then(fn, fn)
  chain = run.then(() => {}, () => {})
  return run
}

export function colLetter(index) {
  let s = ''
  let i = index + 1
  while (i > 0) {
    const m = (i - 1) % 26
    s = String.fromCharCode(65 + m) + s
    i = Math.floor((i - 1) / 26)
  }
  return s
}

/**
 * Write cells to the localizations tab, located by FRESH header + row_key reads
 * (never by cached row index — n8n appendOrUpdate may have shifted things, and
 * the parser skips blank rows). Only allowlisted columns; only in-place cell
 * updates (never insert/delete/sort). targets: [{rowKey, col, value}].
 */
export async function writeLocalizationCells(sheets, targets) {
  for (const t of targets) {
    if (!WRITABLE_LOCALIZATION_COLS.has(t.col)) throw new Error(`колонка не дозволена для запису: ${t.col}`)
  }
  if (config.mode === 'mock') return mockStore.writeLocalizationCells(targets)

  // 1. header → column indexes (resolved at runtime, no hardcoded letters)
  const headerRows = await sheets.getValues(`${TABS.localizations}!1:1`)
  const header = (headerRows[0] || []).map((h) => String(h ?? '').trim())
  const colIndex = Object.fromEntries(header.map((h, i) => [h, i]))
  const rowKeyCol = colIndex.row_key
  if (rowKeyCol == null) throw new Error('колонку row_key не знайдено в localizations')

  // 2. row_key column → sheet row numbers
  const rkLetter = colLetter(rowKeyCol)
  const rkRows = await sheets.getValues(`${TABS.localizations}!${rkLetter}2:${rkLetter}`)
  const rowNumByKey = new Map()
  rkRows.forEach((r, i) => { const k = r?.[0]; if (k !== '' && k != null) rowNumByKey.set(String(k), i + 2) })

  // 3. build in-place cell updates
  const data = []
  const missing = []
  for (const t of targets) {
    const ci = colIndex[t.col]
    const rowNum = rowNumByKey.get(t.rowKey)
    if (ci == null) { missing.push(`col:${t.col}`); continue }
    if (!rowNum) { missing.push(`row:${t.rowKey}`); continue }
    data.push({ range: `${TABS.localizations}!${colLetter(ci)}${rowNum}`, values: [[t.value]] })
  }
  if (!data.length) throw new Error(`жоден рядок не зматчився (${missing.join(', ')})`)

  await sheets.batchUpdate(data)
  return { written: data.length, missing }
}

/**
 * Update an existing config key's value (key/value tab — order-independent, so
 * matched by key, never by index). Update-only: a missing key is an error, not
 * an insert. Compare-and-set: refuses if the current value drifted from
 * `expected` (someone edited the sheet meanwhile).
 */
export async function writeConfigCell(sheets, key, value, expected) {
  if (config.mode === 'mock') return mockStore.writeConfigCell(key, value)
  const rows = await sheets.getValues(`${TABS.config}!A:B`)
  let rowNum = -1
  let current = ''
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i]?.[0] ?? '').trim() === key) { rowNum = i + 1; current = rows[i]?.[1] ?? ''; break }
  }
  if (rowNum < 0) throw new Error(`ключа "${key}" немає в config — додай рядок вручну в таблиці`)
  if (expected != null && String(current) !== String(expected)) {
    const e = new Error('значення в таблиці вже інше — онови сторінку перед збереженням')
    e.code = 'CONFLICT'
    throw e
  }
  await sheets.updateValues(`${TABS.config}!B${rowNum}`, [[value]])
  return { key, value }
}

/** Update voice fields for one lang (matched by the `lang` column). */
export async function writeVoiceCells(sheets, lang, updates) {
  if (config.mode === 'mock') return mockStore.writeVoiceCells(lang, updates)
  const headerRows = await sheets.getValues(`${TABS.voices}!1:1`)
  const header = (headerRows[0] || []).map((h) => String(h ?? '').trim())
  const colIndex = Object.fromEntries(header.map((h, i) => [h, i]))
  const langCol = colIndex.lang
  if (langCol == null) throw new Error('колонку lang не знайдено в voices')

  const langLetter = colLetter(langCol)
  const langRows = await sheets.getValues(`${TABS.voices}!${langLetter}2:${langLetter}`)
  let rowNum = -1
  langRows.forEach((r, i) => { if (String(r?.[0] ?? '').trim() === lang) rowNum = i + 2 })
  if (rowNum < 0) throw new Error(`мови "${lang}" немає в voices`)

  const data = []
  for (const [col, value] of Object.entries(updates)) {
    if (!VOICE_WRITABLE_COLS.has(col)) continue
    const ci = colIndex[col]
    if (ci == null) continue
    data.push({ range: `${TABS.voices}!${colLetter(ci)}${rowNum}`, values: [[value]] })
  }
  if (!data.length) throw new Error('немає валідних полів для запису')
  await sheets.batchUpdate(data)
  return { lang, written: data.length }
}

// ─── staged pipeline (Etap M: mock store; Etap P: live segments/webhooks) ────

const LIVE_TODO = 'доступно лише на Етапі P (live-пайплайн ще не під’єднано)'

/** Write segments cells (en_text or {lang}_text), matched by segment_id. The
 *  caller passes the gate-scoped allowlist so transcript ≠ translation edits. */
export async function writeSegmentCells(sheets, targets, allowedCols) {
  for (const t of targets) {
    if (!allowedCols.has(t.col)) throw new Error(`колонка не дозволена для запису: ${t.col}`)
  }
  if (config.mode === 'mock') return mockStore.writeSegmentCells(targets)
  throw new Error(`запис у segments ${LIVE_TODO}`)
}

/** Merge a segment with the next one (transcript stage only). */
export async function mergeSegments(sheets, segmentId) {
  if (config.mode === 'mock') return mockStore.mergeSegments(segmentId)
  throw new Error(`merge сегментів ${LIVE_TODO}`)
}

/** Retime a segment's EN slot — drag timeline edges (transcript stage only). */
export async function retimeSegment(sheets, segmentId, enStart, enEnd) {
  if (config.mode === 'mock') return mockStore.retimeSegment(segmentId, enStart, enEnd)
  throw new Error(`ретайм сегмента ${LIVE_TODO}`)
}

/** Retime ONE language's dub slot independently (audio stage). EN slot untouched;
 *  the render stage rebuilds that language's VTT/full file from the new slot. */
export async function retimeLocalization(sheets, rowKey, enStart, enEnd) {
  if (config.mode === 'mock') return mockStore.retimeLocalization(rowKey, enStart, enEnd)
  throw new Error(`пер-мовний ретайм ${LIVE_TODO}`)
}

/** Loudness-normalize dub segments to a target LUFS (audio stage). */
export async function normalizeSegments(sheets, rowKeys, targetLufs) {
  if (config.mode === 'mock') return mockStore.normalizeSegments(rowKeys, targetLufs)
  throw new Error(`нормалізація гучності ${LIVE_TODO}`)
}

/** Set ONE language's dub fade in/out envelope (audio stage). EN slot untouched;
 *  the render stage bakes the envelope into that language's full file. */
export async function setLocalizationFades(sheets, rowKey, fadeIn, fadeOut) {
  if (config.mode === 'mock') return mockStore.setLocalizationFades(rowKey, fadeIn, fadeOut)
  throw new Error(`фейди дубляжу ${LIVE_TODO}`)
}

// ── audio-timeline clips (per-language, independent pieces; audio stage) ──────
/** Cut one dub clip into two pieces at a timeline time (this lang only). */
export async function cutClip(sheets, clipId, atSec) {
  if (config.mode === 'mock') return mockStore.cutClip(clipId, atSec)
  throw new Error(`розріз аудіо-кліпу ${LIVE_TODO}`)
}
/** Move/trim one dub clip on the timeline. */
export async function retimeClip(sheets, clipId, start, end) {
  if (config.mode === 'mock') return mockStore.retimeClip(clipId, start, end)
  throw new Error(`переміщення кліпу ${LIVE_TODO}`)
}
/** Fade in/out envelope on one dub clip. */
export async function setClipFades(sheets, clipId, fadeIn, fadeOut) {
  if (config.mode === 'mock') return mockStore.setClipFades(clipId, fadeIn, fadeOut)
  throw new Error(`фейди кліпу ${LIVE_TODO}`)
}
/** Delete one dub clip (its audio piece). */
export async function deleteClip(sheets, clipId) {
  if (config.mode === 'mock') return mockStore.deleteClip(clipId)
  throw new Error(`видалення кліпу ${LIVE_TODO}`)
}

/** Split a segment at a word boundary (transcript stage only). */
export async function splitSegment(sheets, segmentId, wordIndex) {
  if (config.mode === 'mock') return mockStore.splitSegment(segmentId, wordIndex)
  throw new Error(`split сегментів ${LIVE_TODO}`)
}

/** Approve a review gate → advance the pipeline (Etap P fires the webhook). */
export async function approveStage(sheets, stage, now) {
  if (config.mode === 'mock') return mockStore.approve(stage, now)
  throw new Error(`підтвердження етапу через webhook ${LIVE_TODO}`)
}

/** Start a staged run from the UI drop-in (with selected target languages). */
export async function startStagedRun(sheets, now, lessonId, langs) {
  if (config.mode === 'mock') return mockStore.startStagedRun(now, lessonId, langs)
  throw new Error(`staged-старт ${LIVE_TODO}`)
}

/** Apply a past run's settings snapshot to live config/voices/prompt. */
export async function applyArchiveSettings(sheets, snapshot) {
  if (config.mode === 'mock') return mockStore.applySettings(snapshot)
  throw new Error(`застосування налаштувань з архіву ${LIVE_TODO}`)
}

/** Start the separate assemble-file step (with the chosen save destination). */
export async function startRender(sheets, now, destination) {
  if (config.mode === 'mock') return mockStore.startRender(now, destination)
  throw new Error(`склейка повного файлу ${LIVE_TODO}`)
}
