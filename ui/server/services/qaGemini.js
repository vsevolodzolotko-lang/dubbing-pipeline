// Built-in LLM quality check via Gemini (replaces the manual "export CSV → paste
// into an LLM" recipe from operator_manual.md §2). Calls Gemini exactly like the
// pipeline's editor node: OpenAI-compatible endpoint, gemini-3.5-flash, Bearer
// gemini_api_key (read server-side from the config tab — never sent to the
// browser). One call per language over the WHOLE lesson, so cross-segment
// consistency (formality / gender) is actually visible to the model.

import { getAiPrompt } from './mockStore.js'

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'
const MODEL = 'gemini-3.5-flash'

const LANG_NAMES = {
  de: 'німецька', es: 'іспанська', fr: 'французька', it: 'італійська',
  pl: 'польська', pt: 'португальська', tr: 'турецька',
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function runAnalysis({ snapshot, langs, onProgress }) {
  const m = snapshot.get()
  const apiKey = (m.configMap.get('gemini_api_key') || '').toString().trim()
  if (!apiKey) throw new Error('gemini_api_key відсутній у config-табі')

  const allLangs = (langs && langs.length ? langs : m.activeLangs).filter((l) => LANG_NAMES[l])
  const segs = m.segments
  const lessonId = segs[0]?.segment_id?.replace(/_seg_\d+$/, '') ?? null

  const findings = []
  let done = 0
  const CONC = Math.min(4, Number(m.configMap.get('w2_llm_chunk')) || 4)

  await pool(allLangs, CONC, async (lang) => {
    const payload = segs
      .filter((s) => String(s[`${lang}_text`] ?? '').trim())
      .map((s) => ({ segment_id: s.segment_id, en: s.en_text || '', t: s[`${lang}_text`] }))

    let raw = []
    if (payload.length) {
      const body = {
        model: MODEL,
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

  // stable order: by lang, then segment number
  findings.sort((a, b) =>
    a.lang === b.lang ? segNum(a.segmentId) - segNum(b.segmentId) : a.lang.localeCompare(b.lang))

  return {
    generatedAt: new Date().toISOString(),
    lessonId,
    langs: allLangs,
    findings,
    total: findings.length,
  }
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
