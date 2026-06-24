import fs from 'node:fs'
import path from 'node:path'
import { config } from '../config.js'

// Run-history store for the Tuning tab — a local JSON history of quality reports
// so trends across runs are visible without a DB. Mirrors services/archive.js
// (file-backed, survives restarts, mock-safe). Layout under cache/quality/:
//   index.json     — [{id, lessonId, runToken, finishedAt, mode, langs, score, ...}]  (headline scalars for the trend list)
//   run_<id>.json  — the full RunQualityReport
//   advice-last.json — the last RecommendationSet (like qa/last.json)
const DIR = path.join(config.cacheDir, 'quality')
const INDEX = path.join(DIR, 'index.json')
const ADVICE = path.join(DIR, 'advice-last.json')

function loadIndex() {
  try { const d = JSON.parse(fs.readFileSync(INDEX, 'utf8')); return Array.isArray(d.runs) ? d.runs : [] }
  catch { return [] }
}
function saveIndex(runs) {
  try { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(INDEX, JSON.stringify({ runs }, null, 2)) }
  catch { /* non-fatal */ }
}
function nextId(existing) {
  let n = 1; const ids = new Set(existing.map((x) => x.id))
  while (ids.has(`run_${n}`)) n++
  return `run_${n}`
}

// The cheap list-view row: only headline scalars (the full report stays on disk).
function summaryOf(report, id) {
  const langs = report.langs || []
  const meanScore = langs.length
    ? Math.round(langs.reduce((a, l) => a + (report.perLang[l]?.score || 0), 0) / langs.length) : null
  const cells = report.totals?.cells || 0
  const attTrueRate = cells ? +(report.totals.attentionTrue / cells).toFixed(3) : 0
  let regenCount = 0
  for (const l of langs) regenCount += report.perLang[l]?.regen.count || 0
  const cpsDeltas = report.recommendationsHint?.cpsDeltas || []
  const cpsDeltaMax = cpsDeltas.length ? Math.max(...cpsDeltas.map((d) => Math.abs(d.delta))) : 0
  return {
    id, lessonId: report.lessonId, runToken: report.runToken, finishedAt: report.generatedAt,
    mode: report.mode, langs, score: meanScore, attTrueRate,
    regenRate: cells ? +(regenCount / cells).toFixed(3) : 0, cpsDeltaMax: +cpsDeltaMax.toFixed(2),
  }
}

export const qualityStore = {
  list() { return loadIndex() },
  get(id) {
    try { return JSON.parse(fs.readFileSync(path.join(DIR, `${id}.json`), 'utf8')) }
    catch { return null }
  },
  latest(lessonId) {
    const runs = loadIndex().filter((r) => !lessonId || r.lessonId === lessonId)
    return runs[0] ? this.get(runs[0].id) : null
  },
  // Capture a report. Dedup by runToken+lessonId (a run is captured multiple times
  // — on advise, on COMPLETE poll, on render — but stays ONE history entry).
  capture(report) {
    if (!report) return null
    const runs = loadIndex()
    const dup = runs.findIndex((r) => r.runToken && report.runToken && r.runToken === report.runToken && r.lessonId === report.lessonId)
    let id
    if (dup >= 0) { id = runs[dup].id; runs[dup] = summaryOf(report, id) }
    else { id = nextId(runs); runs.unshift(summaryOf(report, id)) }
    try { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(path.join(DIR, `${id}.json`), JSON.stringify(report)) }
    catch { /* non-fatal */ }
    saveIndex(runs)
    return id
  },
  // A single headline metric over time (oldest → newest) for the trend charts.
  trend(metric, { lessonId } = {}) {
    const runs = loadIndex().filter((r) => !lessonId || r.lessonId === lessonId)
    const points = runs.slice().reverse().map((r) => ({
      id: r.id, lessonId: r.lessonId, finishedAt: r.finishedAt, value: r[metric] ?? null,
    }))
    return { metric, points }
  },
  loadAdvice() { try { return JSON.parse(fs.readFileSync(ADVICE, 'utf8')) } catch { return null } },
  saveAdvice(set) {
    try { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(ADVICE, JSON.stringify(set)) }
    catch { /* non-fatal */ }
  },
}
