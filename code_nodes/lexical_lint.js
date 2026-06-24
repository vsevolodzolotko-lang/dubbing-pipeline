// W2 Lexical Lint — full-pass non-word / truncation / typo proofreader on the strong model.
// Runs LAST in W2 (after Formality Lint), BEFORE Update Sheet, so it proofreads the final
// post-adapt, post-formality text. Catches the broken-token class that slips past Verify
// (defers typos to Editor) and Gemini Editor (weak model occasionally misses them) — e.g.
// PL "Nauka zwi to fizyką kwantową" ("zwi" is a non-word; should be "nazywa"/"zwie"). No
// deterministic high-precision detector exists for plausible-looking non-words without a
// per-language dictionary, so this is an LLM pass (Sonnet 4.6) over ALL cells with a STRICT,
// minimal-edit prompt: fix only genuinely broken tokens, leave valid text byte-for-byte.
//
// Drop-in shaped like Verify Translations / Gemini Editor: batches segments (8 at a time),
// applies a correction only when the model returns a different, non-empty string that passes
// a length-similarity guard (rejects runaway whole-sentence rewrites). On LLM failure returns
// empty corrections → all items pass through unchanged. Externalizable prompt
// ('lexical_lint_system' in the prompts sheet) with a built-in default → deploys via code,
// no required sheet edit. Toggle: config w2_lexical_lint=false to skip the pass entirely.
const QA_BATCH_SIZE = 8;
const ALL_LANGS = ['de', 'es', 'fr', 'pl', 'pt', 'it', 'tr'];
const MODEL = 'claude-sonnet-4-6';
// A real lexical fix barely changes length. Reject any "correction" that changes length by
// more than max(12 chars, 25% of original) — that signals a rephrase/rewrite, not a fix.
const MAX_LEN_DELTA_ABS = 12;
const MAX_LEN_DELTA_RATIO = 0.25;

const configMap = {};
$('Read Config').all().forEach(i => { if (i.json.key) configMap[i.json.key] = i.json.value; });
const apiKey = configMap.anthropic_api_key || '';
if (!apiKey) throw new Error('anthropic_api_key missing from config sheet');

const items = $input.all();

// Toggle: default ON; set config w2_lexical_lint=false to bypass (pure passthrough).
if (String(configMap.w2_lexical_lint ?? 'true').toLowerCase() === 'false') {
  console.log('Lexical Lint: DISABLED via config (w2_lexical_lint=false) — passthrough');
  return items;
}

// active_langs gate — narrow the proofread pass to active langs only. Inactive lang
// fields are not present in input items (extract_translations already filtered them).
const activeRaw = (configMap.active_langs || '').trim();
const LANGS = activeRaw
  ? activeRaw.split(',').map(s => s.trim().toLowerCase()).filter(l => ALL_LANGS.includes(l))
  : ALL_LANGS.slice();
if (LANGS.length === 0) throw new Error('active_langs filter produced empty lang list — check config');

// Externalized-prompts loader. Reads the "prompts" Google Sheets tab via Read Prompts.
// Optional here — falls back to the built-in default below if the key is absent.
const promptMap = {};
$('Read Prompts').all().forEach(i => { if (i.json.key) promptMap[i.json.key] = i.json.value; });
const LINT_SYSTEM = (promptMap.lexical_lint_system && promptMap.lexical_lint_system.trim())
  ? promptMap.lexical_lint_system
  : `You are a lexical proofreader for meditation/wellness audio translations. Your ONLY job is to fix genuinely broken tokens. You do NOT improve style, rephrase, retranslate, or change register.
INPUT: a JSON object mapping segment_id -> { en, <lang>: text }. "en" is the English source, for context ONLY — never edit it and never output it. Each <lang> value is a translation to proofread IN THAT LANGUAGE.
For each <lang> cell, scan for and fix ONLY:
- NON-WORDS: tokens that are not real words in that language (e.g. PL "zwi" instead of "zwie"/"nazywa").
- TRUNCATIONS: words cut short, missing endings or inflection (e.g. "fizyk" where "fizyką" is meant).
- BROKEN MORPHOLOGY / AGREEMENT: clearly wrong inflection, doubled or dropped letters, mangled diacritics.
- OBVIOUS TYPOS: transposed / missing / extra letters that produce a non-word.
- ENCODING ARTIFACTS: mojibake or stray characters (Ã, Â, â€, the replacement character) — restore the intended character.
STRICT RULES:
- Change as FEW characters as possible. Fix only the broken token; leave everything else BYTE-FOR-BYTE identical.
- Do NOT rephrase, reorder, add or remove words; do NOT change punctuation or "..." / "—" markers; do NOT swap valid synonyms; do NOT alter formality or gender.
- A real, correctly spelled word is NEVER a target — even if you would phrase it differently. When unsure whether a token is broken, LEAVE IT UNCHANGED.
- Proper and brand names (Spireo, Kundalini, Hugh, chi, prana) are correct — never "fix" them.
- Each cell stays in its own language; never translate across languages.
OUTPUT: ONLY a JSON object mapping segment_id -> { <lang>: corrected_text }, the SAME segment_ids and langs as input. If a cell has no broken token, return it UNCHANGED (verbatim). No preamble, no markdown, no commentary, no \`\`\`json fences. Start with { and end with }.`;

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function callClaude(body) {
  const MAX_TRIES = 4;
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    try {
      const resp = await this.helpers.httpRequest({
        method: 'POST',
        url: 'https://api.anthropic.com/v1/messages',
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body, json: true,
      });
      return resp.content?.[0]?.text?.trim() || '';
    } catch (e) {
      if (attempt === MAX_TRIES - 1) { console.error('Lexical Lint Claude failed after retries:', e.message); return ''; }
      await sleep(2000 * Math.pow(2, attempt));
    }
  }
  return '';
}
function parseLLMJson(raw) {
  try {
    const cleaned = (raw || '').replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
  } catch (e) { console.error('Lexical Lint parse error:', e.message); }
  return {};
}
function asStr(v) {
  if (typeof v === 'string') return v.trim();
  if (v == null) return '';
  if (typeof v === 'object' && !Array.isArray(v)) {
    const inner = v.text ?? v.corrected ?? v.fixed ?? v.value;
    if (typeof inner === 'string') return inner.trim();
    const s = Object.values(v).filter(x => typeof x === 'string' && x.trim());
    if (s.length === 1) return s[0].trim();
  }
  return '';
}

// Length-similarity guard: a genuine lexical fix barely shifts length. A large delta means
// the model rephrased/rewrote — reject and keep the original (the lint must never silently
// rewrite valid text). Returns true when the correction is safe to apply.
function withinLenGuard(oldText, newText) {
  const delta = Math.abs(newText.length - oldText.length);
  return delta <= Math.max(MAX_LEN_DELTA_ABS, oldText.length * MAX_LEN_DELTA_RATIO);
}

const batches = [];
for (let i = 0; i < items.length; i += QA_BATCH_SIZE) batches.push(items.slice(i, i + QA_BATCH_SIZE));

// Bounded-concurrent batches (mirrors Verify/Editor): CHUNK in parallel, sequential between
// chunks — stays under n8n's 300s task-runner ceiling and within Tier 2 rate limits.
const CHUNK = parseFloat(configMap.w2_llm_chunk) || 6;
const corrections = {};
async function runOneLintBatch(batch) {
  const userMap = {};
  for (const it of batch) {
    const j = it.json;
    const entry = { en: j.en_text || '' };
    for (const lang of LANGS) entry[lang] = j[`${lang}_text`] || '';
    userMap[j.segment_id] = entry;
  }
  const body = {
    model: MODEL,
    max_tokens: 8000,
    system: [{ type: 'text', text: LINT_SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: JSON.stringify(userMap, null, 2) }],
  };
  return parseLLMJson(await callClaude.call(this, body));
}
for (let i = 0; i < batches.length; i += CHUNK) {
  const slice = batches.slice(i, i + CHUNK);
  const partial = await Promise.all(slice.map(b => runOneLintBatch.call(this, b)));
  for (const p of partial) Object.assign(corrections, p);
}

// Apply corrections: replace a cell only when the model returned a non-empty, changed string
// that passes the length guard. Everything else passes through verbatim.
let applied = 0, rejectedByGuard = 0;
const samples = [];
const out = items.map(it => {
  const sid = it.json.segment_id;
  const corr = corrections[sid] || {};
  const o = { ...it.json };
  for (const lang of LANGS) {
    const key = `${lang}_text`;
    const oldText = o[key] || '';
    const newText = asStr(corr[lang]);
    if (!newText || newText === oldText) continue;
    if (!withinLenGuard(oldText, newText)) {
      rejectedByGuard++;
      console.log(`Lexical Lint: rejected ${sid}_${lang} correction (len ${oldText.length}→${newText.length}, looks like a rewrite)`);
      continue;
    }
    if (samples.length < 8) samples.push({ sid, lang, before: oldText, after: newText });
    o[key] = newText;
    applied++;
  }
  return { json: o };
});
console.log(`Lexical Lint: applied ${applied} fix(es)${rejectedByGuard ? `, rejected ${rejectedByGuard} by length guard` : ''} across ${items.length} segment(s)`);
if (samples.length) console.log('Lexical Lint samples:', JSON.stringify(samples));

return out;
