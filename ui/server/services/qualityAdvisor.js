// LLM advisor for the Tuning tab. Takes a RunQualityReport + the current config /
// voices / prompt texts and returns structured, evidence-backed recommendations:
// config changes, voice-param changes, and prompt edits. Mirrors qaGemini.runAnalysis
// (mock branch = deterministic, no network; live branch = Anthropic). The advisor's
// own system prompt is an operator-editable prompts-tab key (tuning_advisor_system)
// with a built-in fallback, so it is itself tunable.

import { config } from '../config.js'
import { EDITABLE_CONFIG_KEYS, EDITABLE_CONFIG_BOUNDS } from '../constants.js'
import { callClaude, parseLLMJson } from './anthropic.js'
import { FORMAL, informalize } from './qaCheck.js'

const DEFAULT_MODEL = 'claude-opus-4-8'
const NUM = (v) => (v === '' || v == null || isNaN(Number(v)) ? null : Number(v))

// Prompt keys the advisor may reason about / propose edits to (also the context
// we feed it). Anything outside this set is dropped server-side.
const ADVISABLE_PROMPTS = [
  'translate_system', 'qa_verify_system', 'editor_system', 'adapt_shorten_system',
  'w3_expand_batch_system', 'concept_gate_system', 'formality_fix_system',
  'false_friend_fix_system', 'tone_of_voice',
]
const VOICE_FIELDS = new Set(['speed', 'stability', 'similarity_boost', 'style'])
const CONF = new Set(['high', 'medium', 'low'])

const ADVISOR_SYSTEM_KEY = 'tuning_advisor_system'

// Fallback used when the prompts tab has no tuning_advisor_system row (mirrors how
// the phase2 node has built-in defaults for concept_gate_system, etc.).
const BUILTIN_SYSTEM = `You are a calibration analyst for an automated video-dubbing pipeline. It translates an English script into 7 languages (de, es, fr, it, pl, pt, tr) and synthesizes speech (ElevenLabs) that must fit each original slot's duration.

You are given, for ONE run: aggregated quality metrics per language and per segment type, the current editable config values with their allowed bounds, the current voice parameters, and the current text of the relevant LLM prompts. Recommend concrete, evidence-backed changes that improve text quality and slot-fit on the NEXT run.

Levers and what the metrics mean:
- cps_estimate_{lang}: expected characters-per-second for that voice. If observed CPS >> configured, the predictor under-estimates length, so translations stay too long and get force-sped-up — raise the estimate toward observed. If observed << configured, lower it. Anchor on recommendationsHint.cpsDeltas; do NOT contradict the measured delta, only refine rationale/confidence.
- High speedUpRate / final_speed at the ceiling: text too long for the slot — raise cps_estimate, or raise max_borrow_per_segment_sec, or make the translation prompt more concise.
- High adaptation.saturationRate: W2 keeps hitting the shortening cap — translate_system / adapt_shorten_system are verbose; tighten them or raise max_adaptation_attempts.
- phase2 concept_dropped: expansion drops meaning — soften w3_expand_batch_system or relax concept_gate_system. overshoot: expansion too aggressive.
- QA findings (formality / gender / false_friend / naturalness): map to translate_system, editor_system, formality_fix_system, false_friend_fix_system.
- Voice speed/stability: only when pacing/naturalness regen reasons or the speed distribution point at the voice itself.

Rules:
- Only propose config keys present in editableConfigKeys. Every proposed value MUST be within the given bounds.
- Every recommendation MUST cite evidence (metric, value, sampleSize). If sampleSize < 10, set confidence to "low".
- Prefer a few high-value changes over many speculative ones. Skip anything whose evidence is weak.
- For prompt edits, give a full rewrite (mode "rewrite") or a precise find/replace patch (mode "patch", patch:{find,replace}) against the supplied current text.

Return ONLY JSON, no prose, no code fences, matching:
{"summary":"<one sentence>","configRecommendations":[{"key":"","scope":"global|lang","lang":"","current":"","proposed":"","confidence":"high|medium|low","rationale":"","evidence":[{"metric":"","value":"","sampleSize":0}],"expectedEffect":""}],"voiceRecommendations":[{"lang":"","field":"speed|stability|similarity_boost|style","current":"","proposed":"","confidence":"","rationale":"","evidence":[{"metric":"","value":""}]}],"promptRecommendations":[{"promptKey":"","failurePattern":"","evidence":[{"metric":"","value":""}],"proposedEdit":{"mode":"rewrite|patch","rewrite":"","patch":{"find":"","replace":""}},"confidence":"","rationale":""}]}`

export async function runAdvisor({ snapshot, report, model }) {
  const m = snapshot.get()
  const useModel = (typeof model === 'string' && model.trim()) ? model.trim() : DEFAULT_MODEL

  let set
  if (config.mode === 'mock') {
    set = mockRecommendations(report, m)
  } else {
    const apiKey = (m.configMap.get('anthropic_api_key') || '').toString().trim()
    if (!apiKey || /THIS_SHOULD_BE_MASKED/.test(apiKey)) throw new Error('anthropic_api_key відсутній у config-табі')
    const system = resolveSystem(m)
    const user = buildUserTurn(report, m)
    const parsed = parseLLMJson(await callClaude({ apiKey, model: useModel, system, user }))
    set = normalizeSet(parsed)
  }

  set.schema = 1
  set.generatedAt = new Date().toISOString()
  set.model = config.mode === 'mock' ? 'mock' : useModel
  set.lessonId = report.lessonId
  set.runToken = report.runToken
  return validateSet(set, m)
}

// ── live helpers ─────────────────────────────────────────────────────────────

function resolveSystem(model) {
  const row = (model.prompts || []).find((p) => p.key === ADVISOR_SYSTEM_KEY)
  const v = String(row?.value || '').trim()
  return v || BUILTIN_SYSTEM
}

function buildUserTurn(report, model) {
  const prompts = {}
  for (const key of ADVISABLE_PROMPTS) {
    const row = (model.prompts || []).find((p) => p.key === key)
    if (row && row.value) prompts[key] = String(row.value)
  }
  const voices = (model.voices || []).map((v) => ({
    lang: v.lang, voice_name: v.voice_name, speed: v.speed, stability: v.stability,
    similarity_boost: v.similarity_boost, style: v.style, notes: v.notes,
  }))
  const configBounds = {}
  for (const k of EDITABLE_CONFIG_KEYS) if (EDITABLE_CONFIG_BOUNDS[k]) configBounds[k] = EDITABLE_CONFIG_BOUNDS[k]
  return JSON.stringify({ report, editableConfigKeys: [...EDITABLE_CONFIG_KEYS], configBounds, voices, prompts })
}

// Coerce the raw LLM JSON into our schema shape (string-ify scalar values; ensure
// arrays). Validation/guardrails happen later in validateSet.
function normalizeSet(parsed) {
  const arr = (x) => (Array.isArray(x) ? x : [])
  const s = (v) => (v == null ? '' : String(v))
  return {
    summary: s(parsed.summary),
    configRecommendations: arr(parsed.configRecommendations).map((r) => ({
      key: s(r.key), scope: r.scope === 'global' ? 'global' : 'lang', lang: r.lang ? s(r.lang) : undefined,
      current: s(r.current), proposed: s(r.proposed), confidence: s(r.confidence).toLowerCase(),
      rationale: s(r.rationale), expectedEffect: s(r.expectedEffect), evidence: arr(r.evidence),
    })),
    voiceRecommendations: arr(parsed.voiceRecommendations).map((r) => ({
      lang: s(r.lang), field: s(r.field), current: s(r.current), proposed: s(r.proposed),
      confidence: s(r.confidence).toLowerCase(), rationale: s(r.rationale), evidence: arr(r.evidence),
    })),
    promptRecommendations: arr(parsed.promptRecommendations).map((r) => ({
      promptKey: s(r.promptKey), failurePattern: s(r.failurePattern), confidence: s(r.confidence).toLowerCase(),
      rationale: s(r.rationale), evidence: arr(r.evidence),
      proposedEdit: r.proposedEdit && typeof r.proposedEdit === 'object'
        ? {
            mode: r.proposedEdit.mode === 'patch' ? 'patch' : 'rewrite',
            rewrite: s(r.proposedEdit.rewrite),
            patch: r.proposedEdit.patch ? { find: s(r.proposedEdit.patch.find), replace: s(r.proposedEdit.patch.replace) } : undefined,
          }
        : null,
    })),
  }
}

// ── server-side guardrails (LLM output is untrusted) ─────────────────────────

function evidenceSampleSize(ev) {
  let min = Infinity
  for (const e of ev || []) { const n = NUM(e?.sampleSize); if (n != null) min = Math.min(min, n) }
  return Number.isFinite(min) ? min : null
}
function forceLowIfSmall(rec) {
  const n = evidenceSampleSize(rec.evidence)
  if (n != null && n < 10) rec.confidence = 'low'
  if (!CONF.has(rec.confidence)) rec.confidence = 'low'
  return rec
}

function validateSet(set, model) {
  const promptKeys = new Set((model.prompts || []).map((p) => p.key))
  const allowPrompt = new Set(ADVISABLE_PROMPTS.filter((k) => promptKeys.size === 0 || promptKeys.has(k)))

  set.configRecommendations = (set.configRecommendations || []).filter((r) => {
    if (!r || !EDITABLE_CONFIG_KEYS.has(r.key)) return false
    if (String(r.current) === String(r.proposed)) return false
    const b = EDITABLE_CONFIG_BOUNDS[r.key]
    if (b) { const pv = NUM(r.proposed); if (pv == null || pv < b.min || pv > b.max) return false }
    return true
  }).map(forceLowIfSmall)

  set.voiceRecommendations = (set.voiceRecommendations || []).filter((r) =>
    r && r.lang && VOICE_FIELDS.has(r.field) && NUM(r.proposed) != null && String(r.current) !== String(r.proposed),
  ).map(forceLowIfSmall)

  set.promptRecommendations = (set.promptRecommendations || []).filter((r) =>
    r && allowPrompt.has(r.promptKey) && r.proposedEdit
    && (r.proposedEdit.mode === 'rewrite' ? !!r.proposedEdit.rewrite : !!r.proposedEdit.patch?.find),
  ).map(forceLowIfSmall)

  return set
}

// ── mock branch (Etap M): deterministic, no network ─────────────────────────
// Builds an honest, populated recommendation set from the report's own metrics so
// the tab is demonstrable in mock. CPS deltas carry their real (often LOW) sample
// confidence; prompt/voice recs key off deterministic signals.
function mockRecommendations(report, model) {
  const confMap = { HIGH: 'high', MED: 'medium', LOW: 'low' }
  const configRecommendations = []
  const voiceRecommendations = []
  const promptRecommendations = []

  for (const lang of report.langs) {
    const L = report.perLang[lang]
    if (!L) continue
    const c = L.cps
    if (c.observed != null && c.delta != null && Math.abs(c.delta) > 1.0 && c.recommend != null && c.configured != null) {
      const dir = c.delta > 0 ? 'raise' : 'lower'
      configRecommendations.push({
        key: `cps_estimate_${lang}`, scope: 'lang', lang,
        current: String(c.configured), proposed: String(c.recommend), confidence: confMap[c.confidence] || 'low',
        rationale: `Observed CPS ${c.observed} vs configured ${c.configured} (Δ ${c.delta}). ${dir} the estimate so W2 sizes ${lang.toUpperCase()} translations to the slot.`,
        evidence: [{ metric: 'observed_cps', value: c.observed, sampleSize: c.sampleSize }],
        expectedEffect: 'Fewer force-speed-ups and shorten retries on the next run.',
      })
    }
  }

  // Voice rec: lang with the most pacing-related regen notes → small speed nudge.
  let worstPacing = null
  for (const lang of report.langs) {
    const reasons = report.perLang[lang]?.regen.reasons || {}
    const pacing = reasons.pacing || 0
    if (pacing > 0 && (!worstPacing || pacing > worstPacing.pacing)) worstPacing = { lang, pacing }
  }
  if (worstPacing) {
    const v = (model.voices || []).find((x) => x.lang === worstPacing.lang)
    const cur = NUM(v?.speed)
    if (cur != null) {
      const proposed = +(Math.max(0.5, cur - 0.02)).toFixed(2)
      voiceRecommendations.push({
        lang: worstPacing.lang, field: 'speed', current: String(cur), proposed: String(proposed), confidence: 'low',
        rationale: `${worstPacing.pacing} segment(s) were regenerated for pacing in ${worstPacing.lang.toUpperCase()}. A slightly slower base voice may reduce pacing fixes.`,
        evidence: [{ metric: 'regen_pacing', value: worstPacing.pacing }],
      })
    }
  }

  // Prompt rec: if any language's translations still carry formal address, propose
  // an informal-address rule appended to translate_system (the source-of-truth
  // prompt that exists in the sheet, so Apply works). One illustrative rec.
  const formalLangs = []
  for (const lang of report.langs) {
    if (!FORMAL[lang]) continue
    const seg = (model.segments || []).find((s) => FORMAL[lang].test(String(s[`${lang}_text`] || '')))
    if (seg) formalLangs.push({ lang, segmentId: seg.segment_id, sample: String(seg[`${lang}_text`] || '') })
  }
  if (formalLangs.length) {
    const translateRow = (model.prompts || []).find((p) => p.key === 'translate_system')
    const current = String(translateRow?.value || '')
    const langList = formalLangs.map((f) => f.lang.toUpperCase()).join(', ')
    const rule = `\n\nRULE — Address the listener in the INFORMAL singular in every language (du, tu, tú, ty, sen, ...). Never use formal address (Sie / vous / usted / Lei / Pan / você). E.g. ${formalLangs[0].lang.toUpperCase()}: "${formalLangs[0].sample.slice(0, 80)}" -> "${informalize(formalLangs[0].sample, formalLangs[0].lang).slice(0, 80)}".`
    promptRecommendations.push({
      promptKey: 'translate_system',
      failurePattern: `Formal address detected in ${langList} — wellness copy should be informal "you".`,
      evidence: [{ metric: 'formal_address_langs', value: langList }],
      proposedEdit: current
        ? { mode: 'rewrite', rewrite: current + rule }
        : { mode: 'patch', patch: { find: '', replace: rule.trim() } },
      confidence: 'medium',
      rationale: 'Recurring formal address is a consistent, mechanical defect a single prompt rule prevents at the source.',
    })
  }

  return {
    summary: configRecommendations.length || voiceRecommendations.length || promptRecommendations.length
      ? 'Deterministic mock recommendations from this run’s metrics (live mode calls Claude).'
      : 'No actionable signals in this run’s mock metrics.',
    configRecommendations, voiceRecommendations, promptRecommendations,
  }
}
