import { config } from '../config.js'

/**
 * The "Перевірити AI" action for the translation gate: takes a BATCH of segments
 * of ONE language, checks them against the requirements, and returns a JSON
 * verdict per segment — { ok, comment, suggestion } — exactly the shape a real
 * LLM would return. Etap M: deterministic stand-in (length-fit + formality →
 * comment + fixed text). Etap P: one batched LLM call per language using the
 * editable prompt; this function just parses its JSON.
 */

export const CPS_DEFAULTS = { de: 14, es: 15, fr: 13.5, it: 14, pl: 13, pt: 14, tr: 13 }
const num = (v) => (v === '' || v == null || isNaN(Number(v)) ? null : Number(v))

export const FORMAL = {
  de: /\b(Sie|Ihnen|Ihre[mnrs]?)\b/,
  es: /\b(usted|ustedes)\b/i,
  fr: /\b(vous|votre|vos)\b/i,
  it: /\b(Lei|voi)\b/,
  pl: /\b(Pan|Pani|Państwo)\b/,
  pt: /\b(você|o senhor|a senhora)\b/i,
  tr: /\b(siz|siniz)\b/i,
}
const INFORMAL = {
  de: [[/Finden Sie/g, 'Finde'], [/Lassen Sie/g, 'Lass'], [/lassen Sie/g, 'lass'], [/\bIhren\b/g, 'deinen'], [/\bIhrem\b/g, 'deinem'], [/\bIhre\b/g, 'deine'], [/\bIhnen\b/g, 'dir'], [/\bSie\b/g, 'du']],
  fr: [[/\bvotre\b/gi, 'ton'], [/\bvos\b/gi, 'tes'], [/\bvous\b/gi, 'tu']],
  es: [[/\bustedes\b/gi, 'vosotros'], [/\busted\b/gi, 'tú']],
  it: [[/\bLei\b/g, 'tu'], [/\bvoi\b/gi, 'tu']],
  pt: [[/\bo senhor\b/gi, 'tu'], [/\ba senhora\b/gi, 'tu'], [/\bvocê\b/gi, 'tu']],
  pl: [[/\bPaństwo\b/g, 'wy'], [/\bPani\b/g, 'ty'], [/\bPan\b/g, 'ty']],
  tr: [[/\bsiz\b/gi, 'sen']],
}

export function informalize(text, lang) {
  let t = text
  for (const [re, rep] of (INFORMAL[lang] || [])) t = t.replace(re, rep)
  return t
}
export function shortenToBudget(text, budgetChars) {
  if (text.length <= budgetChars) return text
  let out = ''
  for (const w of text.split(/\s+/)) {
    if ((`${out} ${w}`).trim().length > budgetChars) break
    out = (`${out} ${w}`).trim()
  }
  out = out || text.slice(0, Math.max(1, budgetChars))
  return /[.!?…]$/.test(out) ? out : `${out}…`
}

export function checkTranslations({ snapshot, lang, segmentIds }) {
  const m = snapshot.get()
  const ids = new Set(segmentIds && segmentIds.length ? segmentIds : m.segments.map((s) => s.segment_id))
  const cps = num(m.configMap.get(`cps_estimate_${lang}`)) || CPS_DEFAULTS[lang] || 14

  const results = []
  for (const seg of m.segments) {
    if (!ids.has(seg.segment_id)) continue
    const text = String(seg[`${lang}_text`] ?? '').trim()
    if (!text) continue

    const enDur = num(seg.en_duration_sec) ?? ((num(seg.en_end_sec) ?? 0) - (num(seg.en_start_sec) ?? 0))
    const budget = Math.max(1, enDur * cps)
    const ratio = text.length / budget
    const comments = []
    let fixed = text

    if (FORMAL[lang] && FORMAL[lang].test(text)) {
      comments.push('формальне звертання — має бути «ти» (informal)')
      fixed = informalize(fixed, lang)
    }
    if (ratio > 1.4) {
      comments.push(`задовгий для слоту (~${Math.round(ratio * 100)}% бюджету ${Math.round(budget)} симв.) — TTS обріже/прискорить`)
      fixed = shortenToBudget(fixed, Math.round(budget))
    } else if (ratio > 1.15) {
      comments.push(`трохи задовгий (~${Math.round(ratio * 100)}% бюджету)`)
      fixed = shortenToBudget(fixed, Math.round(budget))
    }

    const ok = comments.length === 0
    results.push({
      segment_id: seg.segment_id,
      ok,
      comment: ok ? 'Відповідає вимогам' : comments.join('; '),
      suggestion: ok || fixed === text ? null : fixed,
    })
  }

  return { lang, generatedAt: new Date().toISOString(), mode: config.mode, count: results.length, results }
}
