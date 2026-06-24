// Text-quality metrics service for the Tuning tab. Pure + synchronous over the
// in-memory snapshot model (segments + localizations + config + voices) — no
// Google, no LLM, same posture as services/derive.js / qaCheck.js. Generalizes
// scripts/analyze_cps.js (observed CPS) into a full per-language + per-segment_type
// RunQualityReport that both the diagnostics UI and the LLM advisor consume.

import { EDITABLE_CONFIG_KEYS } from '../constants.js'
import { computeBaseSpeed, aggregateCps, observedCps, cpsConfidence, recommendCps } from './cps.js'

const NUM = (v) => (v === '' || v == null || isNaN(Number(v)) ? null : Number(v))
const r2 = (n) => +n.toFixed(2)
const r3 = (n) => +n.toFixed(3)

// Coarse classification of an operator regen note → where the auto output most
// needed a human fix. Keyword-based (UA + EN); order matters (first match wins).
const REGEN_BUCKETS = [
  { key: 'shortened', re: /(скороч|коротш|обріз|уріза|shorten|trim|cut)/i },
  { key: 'pacing', re: /(темп|пауз|швидк|ритм|повільн|pace|pause|speed|timing|rhythm)/i },
  { key: 'rewrite', re: /(перепис|перефраз|переробл|rewrit|rephrase|reword|reorder)/i },
]
function classifyRegen(comment) {
  const c = String(comment || '')
  if (!c.trim()) return 'unspecified'
  for (const b of REGEN_BUCKETS) if (b.re.test(c)) return b.key
  return 'other'
}

// Phase-2 outcomes that count as a failure / regression (vs. accepted/no_change).
const PHASE2_FAILS = new Set(['overshoot', 'concept_dropped', 'negative_tail', 'error', 'tts_empty', 'llm_dropped', 'llm_refusal'])

/** Build the full report. `qaReport` = parsed ui/cache/qa/last.json (optional);
 *  folded in only when its lessonId matches this run (or either is unknown). */
export function buildRunQualityReport(model, { qaReport = null } = {}) {
  const segs = model.segments || []
  const locs = model.localizations || []
  const cfg = model.configMap || new Map()
  const langs = ((model.activeLangs && model.activeLangs.length)
    ? model.activeLangs
    : [...new Set(locs.map((l) => l.lang))]).filter(Boolean)

  const lessonId = segs[0]?.segment_id?.replace(/_seg_\d+$/, '') ?? null
  const runToken = String(cfg.get('localization_run_token') || '').trim() || null

  const segTypeById = new Map()
  for (const s of segs) if (s.segment_type) segTypeById.set(s.segment_id, s.segment_type)
  const segmentTypes = [...new Set(segs.map((s) => s.segment_type).filter(Boolean))]

  const voicesByLang = {}
  for (const v of model.voices || []) { const sp = NUM(v.speed); if (v.lang && sp != null) voicesByLang[v.lang] = sp }

  // CPS samples (one per non-empty synthesized cell), then base-speed + aggregate.
  const samples = []
  for (const l of locs) {
    const text = String(l.text_translated || '')
    const dur = NUM(l.real_duration_sec)
    const speed = NUM(l.final_speed)
    if (!l.lang || !text.trim() || dur == null || dur <= 0 || speed == null || speed <= 0) continue
    samples.push({ lang: l.lang, segment_type: segTypeById.get(l.segment_id) || '', chars: text.length, dur, speed })
  }
  const { base: baseByLang, source: baseSrc } = computeBaseSpeed({ samples, voicesByLang })
  const { byLang: cpsByLang, byLangType: cpsByLangType } = aggregateCps(samples, baseByLang)

  const maxAdapt = NUM(cfg.get('max_adaptation_attempts')) || 3
  const maxBorrow = NUM(cfg.get('max_borrow_per_segment_sec'))

  const qaFindings = (qaReport && Array.isArray(qaReport.findings)
    && (!qaReport.lessonId || !lessonId || qaReport.lessonId === lessonId)) ? qaReport.findings : []

  const perLang = {}
  for (const lang of langs) {
    const lLocs = locs.filter((l) => l.lang === lang)
    const cells = lLocs.length
    const base = baseByLang[lang] ?? null

    // ── CPS fit ──
    const agg = cpsByLang[lang]
    const observed = observedCps(agg)
    const configured = NUM(cfg.get(`cps_estimate_${lang}`))
    const sampleSize = agg ? agg.n : 0
    const cps = {
      observed: observed != null ? r2(observed) : null,
      configured,
      recommend: observed != null ? recommendCps(observed) : null,
      delta: (observed != null && configured != null) ? r2(observed - configured) : null,
      confidence: cpsConfidence(sampleSize),
      sampleSize,
      baseSpeed: base,
      baseSpeedSource: baseSrc[lang] || null,
    }

    // ── adaptation pressure (per-segment {lang}_adaptation_attempts) ──
    let adaptSum = 0, adaptMax = 0, adaptSat = 0, adaptN = 0
    for (const s of segs) {
      const a = NUM(s[`${lang}_adaptation_attempts`])
      if (a == null) continue
      adaptN++; adaptSum += a; if (a > adaptMax) adaptMax = a; if (a >= maxAdapt) adaptSat++
    }
    const adaptation = {
      avgAttempts: adaptN ? r2(adaptSum / adaptN) : 0,
      maxAttempts: adaptMax,
      saturationRate: adaptN ? r3(adaptSat / adaptN) : 0,
    }

    // ── speed distribution ──
    const speedHist = {}
    let speedUp = 0, slowDown = 0, speedSum = 0, speedN = 0
    for (const l of lLocs) {
      const sp = NUM(l.final_speed); if (sp == null) continue
      const bucket = sp.toFixed(2)
      speedHist[bucket] = (speedHist[bucket] || 0) + 1
      speedN++; speedSum += sp
      if (base != null) { if (sp > base + 0.005) speedUp++; else if (sp < base - 0.005) slowDown++ }
    }
    const speed = {
      hist: speedHist,
      meanFinalSpeed: speedN ? r3(speedSum / speedN) : null,
      speedUpRate: speedN ? r3(speedUp / speedN) : 0,
      slowDownRate: speedN ? r3(slowDown / speedN) : 0,
    }

    // ── borrow usage ──
    let borrowSum = 0, borrowMax = 0, borrowN = 0, borrowCapHit = 0
    for (const l of lLocs) {
      const b = NUM(l.borrowed_sec); if (b == null) continue
      borrowN++; borrowSum += b; if (b > borrowMax) borrowMax = b
      if (maxBorrow != null && maxBorrow > 0 && b >= maxBorrow - 0.001) borrowCapHit++
    }
    const borrow = {
      meanSec: borrowN ? r3(borrowSum / borrowN) : 0,
      maxSec: r3(borrowMax),
      capHitRate: borrowN ? r3(borrowCapHit / borrowN) : 0,
    }

    // ── phase 2 outcomes ──
    const phase2 = {}
    for (const l of lLocs) { const o = String(l.phase2_outcome || '').trim() || 'none'; phase2[o] = (phase2[o] || 0) + 1 }

    // ── needs_attention ──
    let attTrue = 0, attReview = 0
    for (const l of lLocs) {
      const v = String(l.needs_attention || '').toUpperCase()
      if (v === 'TRUE') attTrue++; else if (v === 'REVIEW') attReview++
    }
    const attention = {
      trueRate: cells ? r3(attTrue / cells) : 0, reviewRate: cells ? r3(attReview / cells) : 0,
      trueCount: attTrue, reviewCount: attReview,
    }

    // ── regen rate + classified reasons ──
    let regenN = 0; const regenReasons = {}
    for (const l of lLocs) {
      if (!String(l.last_regen_at || '').trim() && String(l.needs_retts || '').toUpperCase() !== 'TRUE') continue
      regenN++; const k = classifyRegen(l.regen_comment); regenReasons[k] = (regenReasons[k] || 0) + 1
    }
    const regen = { rate: cells ? r3(regenN / cells) : 0, count: regenN, reasons: regenReasons }

    // ── QA finding rates ──
    const lFind = qaFindings.filter((f) => f.lang === lang)
    const qaByType = {}, qaBySeverity = {}
    for (const f of lFind) { qaByType[f.type] = (qaByType[f.type] || 0) + 1; qaBySeverity[f.severity] = (qaBySeverity[f.severity] || 0) + 1 }
    const qa = { rate: cells ? r3(lFind.length / cells) : 0, count: lFind.length, byType: qaByType, bySeverity: qaBySeverity }

    const L = { lang, cells, cps, adaptation, speed, borrow, phase2, attention, regen, qa }
    L.score = scoreLang(L)
    perLang[lang] = L
  }

  // ── per segment_type (cross-lang) ──
  const perType = {}
  for (const t of segmentTypes) {
    let chars = 0, sec = 0
    for (const agg of Object.values(cpsByLangType)) if (agg.type === t) { chars += agg.chars; sec += agg.sec }
    const tLocs = locs.filter((l) => segTypeById.get(l.segment_id) === t)
    let attTrue = 0, speedUp = 0, speedN = 0
    for (const l of tLocs) {
      if (String(l.needs_attention || '').toUpperCase() === 'TRUE') attTrue++
      const sp = NUM(l.final_speed), base = baseByLang[l.lang]
      if (sp != null && base != null) { speedN++; if (sp > base + 0.005) speedUp++ }
    }
    perType[t] = {
      type: t, cells: tLocs.length,
      observedCps: sec > 0 ? r2(chars / sec) : null,
      attentionTrueRate: tLocs.length ? r3(attTrue / tLocs.length) : 0,
      speedUpRate: speedN ? r3(speedUp / speedN) : 0,
    }
  }

  // ── per (lang, segment_type) CPS drilldown ──
  const perLangType = {}
  for (const [key, agg] of Object.entries(cpsByLangType)) {
    const obs = observedCps(agg)
    const langMean = observedCps(cpsByLang[agg.lang])
    perLangType[key] = {
      lang: agg.lang, type: agg.type, n: agg.n,
      observedCps: obs != null ? r2(obs) : null,
      driftVsLangMean: (obs != null && langMean != null) ? r2(obs - langMean) : null,
    }
  }

  // ── deterministic CPS pre-pass (grounds the LLM; |delta|>1 and not LOW) ──
  const cpsDeltas = []
  for (const lang of langs) {
    const c = perLang[lang]?.cps
    if (!c || c.delta == null || c.confidence === 'LOW') continue
    if (Math.abs(c.delta) > 1.0) {
      cpsDeltas.push({ key: `cps_estimate_${lang}`, lang, current: c.configured, recommend: c.recommend, delta: c.delta, confidence: c.confidence, sampleSize: c.sampleSize })
    }
  }

  // ── editable config slice (present values only) ──
  const config = {}
  for (const k of EDITABLE_CONFIG_KEYS) { const v = cfg.get(k); if (v != null && v !== '') config[k] = String(v) }

  const totalAttTrue = langs.reduce((a, l) => a + (perLang[l]?.attention.trueCount || 0), 0)

  return {
    schema: 1,
    generatedAt: new Date().toISOString(),
    lessonId, runToken, mode: model.mode,
    langs, segmentTypes,
    totals: { segments: segs.length, cells: locs.length, attentionTrue: totalAttTrue, langs: langs.length },
    perLang, perType, perLangType,
    recommendationsHint: { cpsDeltas },
    config,
  }
}

// 0-100 per-language health score: start at 100, subtract weighted penalties for
// the quality risks. Tuned so a clean run (~no attention/regen, CPS on target)
// scores high and a run with hard failures scores low. Presentation heuristic —
// not a contract; the advisor reasons over the raw metrics, not this number.
function scoreLang(L) {
  let s = 100
  s -= (L.attention.trueRate || 0) * 60
  s -= (L.attention.reviewRate || 0) * 15
  s -= (L.regen.rate || 0) * 25
  if (L.cps.delta != null && L.cps.configured) {
    const rel = Math.min(1, Math.abs(L.cps.delta) / L.cps.configured)
    s -= rel * 20 * (L.cps.confidence === 'LOW' ? 0.5 : 1) // discount unreliable deltas
  }
  s -= (L.speed.speedUpRate || 0) * 15
  const p2vals = Object.entries(L.phase2)
  const p2total = p2vals.reduce((a, [, n]) => a + n, 0)
  if (p2total) {
    const fails = p2vals.reduce((a, [k, n]) => a + (PHASE2_FAILS.has(k) ? n : 0), 0)
    s -= (fails / p2total) * 20
  }
  s -= (L.qa.rate || 0) * 10
  return Math.max(0, Math.min(100, Math.round(s)))
}
