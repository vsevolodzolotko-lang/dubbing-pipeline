// Shared CPS (characters-per-second) math, extracted from scripts/analyze_cps.js
// so the operator-facing Tuning report and the offline CLI compute observed CPS
// identically.
//
// KEEP IN SYNC with scripts/analyze_cps.js — that file is CommonJS with its own
// CSV I/O; this is the ESM core used by ui/server (qualityReport.js). If you change
// the base-speed / confidence / rounding rules here, mirror them there.
//
// A "sample" is one localization cell: { lang, segment_type, chars, dur, speed }.
// Only cells synthesised at the voice's BASE speed are natural-pace measurements —
// W3 speed-up retries and Phase 2 slow-down-to-fill produce final_speed != base and
// would bias observed CPS, so they're excluded.

export const SPEED_EQ_TOL = 0.005
export function speedsEqual(a, b) { return Math.abs(a - b) < SPEED_EQ_TOL }

// LOW (<10 samples) / MED (10-19) / HIGH (>=20). Don't trust LOW deltas.
export function cpsConfidence(n) { return n >= 20 ? 'HIGH' : n >= 10 ? 'MED' : 'LOW' }

// Round observed to the nearest 0.5 (config sheets use half-step CPS values).
export function recommendCps(observed) { return Math.round(observed * 2) / 2 }

// Most-common rounded final_speed per lang (fallback when voices has no speed).
function computeMode(samples, lang) {
  const counts = new Map()
  for (const s of samples) {
    if (s.lang !== lang) continue
    const k = Math.round(s.speed * 1000) / 1000 // 3-decimal bucket
    counts.set(k, (counts.get(k) || 0) + 1)
  }
  let best = null, bestN = 0
  for (const [k, n] of counts) if (n > bestN) { best = k; bestN = n }
  return best
}

/** Base voice speed per lang. PRIMARY: voices `speed` (authoritative — what W3
 *  requests by default). FALLBACK: mode of observed final_speed. Returns
 *  { base: {lang:number}, source: {lang:'voices'|'mode'} }. */
export function computeBaseSpeed({ samples, voicesByLang = {} }) {
  const base = {}, source = {}
  for (const lang of [...new Set(samples.map((s) => s.lang))]) {
    const v = voicesByLang[lang]
    if (v != null && v > 0) { base[lang] = v; source[lang] = 'voices' }
    else { const m = computeMode(samples, lang); if (m != null) { base[lang] = m; source[lang] = 'mode' } }
  }
  return { base, source }
}

/** Aggregate observed CPS per lang and per (lang, segment_type), at base speed only.
 *  Returns { byLang: {lang:{n,chars,sec}}, byLangType: {`lang|type`:{lang,type,n,chars,sec}} }. */
export function aggregateCps(samples, baseByLang) {
  const byLang = {}, byLangType = {}
  for (const s of samples) {
    const base = baseByLang[s.lang]
    if (base == null || !speedsEqual(s.speed, base)) continue
    if (!byLang[s.lang]) byLang[s.lang] = { lang: s.lang, n: 0, chars: 0, sec: 0 }
    byLang[s.lang].n++; byLang[s.lang].chars += s.chars; byLang[s.lang].sec += s.dur
    if (s.segment_type) {
      const key = `${s.lang}|${s.segment_type}`
      if (!byLangType[key]) byLangType[key] = { lang: s.lang, type: s.segment_type, n: 0, chars: 0, sec: 0 }
      byLangType[key].n++; byLangType[key].chars += s.chars; byLangType[key].sec += s.dur
    }
  }
  return { byLang, byLangType }
}

export function observedCps(agg) { return agg && agg.sec > 0 ? agg.chars / agg.sec : null }
