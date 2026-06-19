// Built-in LLM quality check via Gemini (replaces the manual "export CSV → paste
// into an LLM" recipe from operator_manual.md §2). Calls Gemini exactly like the
// pipeline's editor node: OpenAI-compatible endpoint, gemini-3.5-flash, Bearer
// gemini_api_key (read server-side from the config tab — never sent to the
// browser). One call per language over the WHOLE lesson, so cross-segment
// consistency (formality / gender) is actually visible to the model.

import { config } from '../config.js'
import { getAiPrompt } from './mockStore.js'
import { FORMAL, CPS_DEFAULTS, informalize, shortenToBudget } from './qaCheck.js'

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'
const MODEL = 'gemini-3.5-flash'
const NUM = (v) => (v === '' || v == null || isNaN(Number(v)) ? null : Number(v))

const LANG_NAMES = {
  de: 'німецька', es: 'іспанська', fr: 'французька', it: 'італійська',
  pl: 'польська', pt: 'португальська', tr: 'турецька',
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function runAnalysis({ snapshot, langs, onProgress, model }) {
  const m = snapshot.get()
  const useModel = (typeof model === 'string' && model.trim()) ? model.trim() : MODEL

  const allLangs = (langs && langs.length ? langs : m.activeLangs).filter((l) => LANG_NAMES[l])
  const segs = m.segments
  const lessonId = segs[0]?.segment_id?.replace(/_seg_\d+$/, '') ?? null

  const findings = []
  let done = 0

  if (config.mode === 'mock') {
    // Etap M stand-in: deterministic findings (no key, no API call) over EVERY
    // active language — so the analysis is representative and never silently
    // drops a language (e.g. de). Live wiring swaps this for the real LLM below.
    for (const lang of allLangs) {
      const f = mockLangFindings(m, segs, lang)
      findings.push(...f)
      done++
      onProgress?.({ lang, done, total: allLangs.length, found: f.length })
    }
  } else {
    const apiKey = (m.configMap.get('gemini_api_key') || '').toString().trim()
    // Etap P: route non-gemini models (claude-*, gpt-*) to Anthropic/OpenAI here.
    if (!apiKey) throw new Error('gemini_api_key відсутній у config-табі (модель: ' + useModel + ')')
    const CONC = Math.min(4, Number(m.configMap.get('w2_llm_chunk')) || 4)

    await pool(allLangs, CONC, async (lang) => {
      const payload = segs
        .filter((s) => String(s[`${lang}_text`] ?? '').trim())
        .map((s) => ({ segment_id: s.segment_id, en: s.en_text || '', t: s[`${lang}_text`] }))

      let raw = []
      if (payload.length) {
        const body = {
          model: useModel,
          messages: [
            { role: 'system', content: systemPrompt(lang) },
            { role: 'user', content: JSON.stringify(payload) },
          ],
          response_format: { type: 'json_object' },
        }
        const text = await callGemini(apiKey, body)
        raw = parseFindings(text)
      }

      for (const f of raw) {
        const seg = segs.find((s) => s.segment_id === f.segment_id)
        if (!seg) continue
        findings.push({
          lang,
          segmentId: f.segment_id,
          rowKey: rowKeyFor(f.segment_id, lang),
          type: normType(f.type),
          severity: normSeverity(f.severity),
          issue: String(f.issue || '').slice(0, 400),
          suggestion: String(f.suggestion || '').slice(0, 600),
          enText: seg.en_text || '',
          current: seg[`${lang}_text`] || '',
        })
      }
      done++
      onProgress?.({ lang, done, total: allLangs.length, found: raw.length })
    })
  }

  // stable order: by lang, then segment number
  findings.sort((a, b) =>
    a.lang === b.lang ? segNum(a.segmentId) - segNum(b.segmentId) : a.lang.localeCompare(b.lang))

  return {
    generatedAt: new Date().toISOString(),
    lessonId,
    model: useModel,
    langs: allLangs,
    findings,
    total: findings.length,
  }
}

// Deterministic mock findings for ONE language (Etap M): formality + length-fit,
// reusing the same checks as the translation-gate "Перевірити AI". Ensures every
// active language is evaluated — e.g. de's formal "Sie" is flagged, so German
// never silently drops out of the analysis.
function mockLangFindings(m, segs, lang) {
  const out = []
  const cps = NUM(m.configMap.get(`cps_estimate_${lang}`)) || CPS_DEFAULTS[lang] || 14
  for (const seg of segs) {
    const text = String(seg[`${lang}_text`] ?? '').trim()
    if (!text) continue
    const base = {
      lang, segmentId: seg.segment_id, rowKey: rowKeyFor(seg.segment_id, lang),
      enText: seg.en_text || '', current: text,
    }
    if (FORMAL[lang] && FORMAL[lang].test(text)) {
      out.push({
        ...base, type: 'formality', severity: 'medium',
        issue: 'Формальне звертання — у wellness-контенті має бути неформальне «ти».',
        suggestion: informalize(text, lang),
      })
    }
    const enDur = NUM(seg.en_duration_sec) ?? ((NUM(seg.en_end_sec) ?? 0) - (NUM(seg.en_start_sec) ?? 0))
    const budget = Math.max(1, enDur * cps)
    const ratio = text.length / budget
    if (ratio > 1.4) {
      out.push({
        ...base, type: 'naturalness', severity: 'high',
        issue: `Задовгий для слоту (~${Math.round(ratio * 100)}% бюджету ${Math.round(budget)} симв.) — TTS прискорить/обріже.`,
        suggestion: shortenToBudget(text, Math.round(budget)),
      })
    }
  }
  return out
}

function systemPrompt(lang) {
  const name = LANG_NAMES[lang] || lang
  // Operator-editable prompt (mock store now; prompts tab at Etap P). `{{lang}}`
  // is substituted with the language name.
  return getAiPrompt().replace(/\{\{lang\}\}/g, name)
}

async function callGemini(apiKey, body) {
  let lastErr
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(GEMINI_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const t = await res.text().catch(() => '')
        const e = new Error(`Gemini ${res.status}: ${t.slice(0, 200)}`)
        e.status = res.status
        throw e
      }
      const data = await res.json()
      return data.choices?.[0]?.message?.content?.trim() || ''
    } catch (e) {
      lastErr = e
      const retryable = !e.status || e.status === 429 || e.status >= 500
      if (!retryable || attempt === 3) throw e
      await sleep(2000 * 2 ** attempt)
    }
  }
  throw lastErr
}

function parseFindings(raw) {
  try {
    const cleaned = String(raw).replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const match = cleaned.match(/\{[\s\S]*\}/)
    if (match) {
      const o = JSON.parse(match[0])
      if (Array.isArray(o.findings)) return o.findings
    }
  } catch { /* swallow — empty findings */ }
  return []
}

const TYPES = new Set(['formality', 'gender', 'false_friend', 'naturalness'])
const SEVS = new Set(['high', 'medium', 'low'])
const normType = (t) => (TYPES.has(t) ? t : 'naturalness')
const normSeverity = (s) => (SEVS.has(s) ? s : 'medium')

function rowKeyFor(segmentId, lang) {
  const m = String(segmentId).match(/_seg_(\d+)$/)
  return m ? `seg_${m[1]}_${lang}` : `${segmentId}_${lang}`
}
function segNum(segmentId) {
  const m = String(segmentId).match(/_seg_(\d+)$/)
  return m ? Number(m[1]) : 0
}

// Bounded-concurrency map (no external deps).
async function pool(items, concurrency, worker) {
  const queue = [...items]
  const runners = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift()
      await worker(item)
    }
  })
  await Promise.all(runners)
}
