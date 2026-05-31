// W3 Phase 2: Batched late-stage expansion through Verify + Editor with retry pass.
// Reads all localizations rows from Read Localizations Fresh, identifies cells with
// real_duration < en_duration × THRESHOLD (and needs_attention=false), runs a 2-pass
// pipeline:
//   Attempt 1: Expand (Sonnet, w3_expand_batch_system) → Verify (Sonnet QA)
//              → Editor (Gemini Flash) → Re-TTS
//   Attempt 2 (only for cells where attempt 1 was no_change / overshoot / still_short):
//              Expand-retry-harder OR Expand-retry-shorter (per category)
//              → Editor (Verify skipped on retry) → Re-TTS
// For each candidate (accepted OR rejected) emits one item with phase2_outcome diagnostic.
// Accepted items carry binary (new WAV) → IF node downstream routes them to Drive Update.
// Rejected items have no binary → IF node routes them directly to Update Localizations
// (writes phase2_outcome and expansion_attempts only; Phase 1 audio stays in Drive).
// needs_attention=true is set for accepted cells where newRealDur < en_dur × 0.70.

const SAMPLE_RATE = 22050;
const BPS = 2;
const EXPAND_BATCH_SIZE = 8;
const CHUNK = 6;                       // Tier 2 Anthropic — higher parallelism than W2's CHUNK=3
const ELEVENLABS_CHUNK = 5;            // parallel TTS calls per slice
const STILL_SHORT_THRESHOLD = 0.85;    // accepted but newRealDur < en_dur × this → retry harder
const NEEDS_ATTENTION_THRESHOLD = 0.70;// accepted but newRealDur < en_dur × this → flag for human
const STRUCTURALLY_IMPOSSIBLE_LEAD_RATIO = 0.5; // skip cells where lead_silence ≥ en_dur × this — TTS budget too small to ever expand within slot (Phase 1 borrow / first-segment offset / huge inter-segment gap)
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
const ELEVENLABS_URL = (vid) => `https://api.elevenlabs.io/v1/text-to-speech/${vid}/stream?output_format=pcm_22050`;

// --- read config + prompts + voices ---
const configMap = {};
$('Read Config').all().forEach(i => { if (i.json.key) configMap[i.json.key] = i.json.value; });

const promptMap = {};
$('Read Prompts').all().forEach(i => { if (i.json.key) promptMap[i.json.key] = i.json.value; });

const voiceMap = {};
$('Read Voices').all().forEach(i => { if (i.json.lang) voiceMap[i.json.lang] = i.json; });

const THRESHOLD = parseFloat(configMap.expansion_threshold) || 0.85;
const apiKey = configMap.anthropic_api_key || '';
const geminiKey = configMap.gemini_api_key || '';
const elevenKey = configMap.elevenlabs_api_key || '';
if (!apiKey || !geminiKey || !elevenKey) {
  throw new Error('Phase 2: missing API key in config (anthropic_api_key/gemini_api_key/elevenlabs_api_key)');
}

function loadPrompt(key, vars = {}, optional = false) {
  const raw = promptMap[key];
  if (!raw) {
    if (optional) return null;
    throw new Error(`Missing prompt "${key}" in prompts sheet — add a row with this key`);
  }
  const result = Object.entries(vars).reduce(
    (s, [k, v]) => s.replace(new RegExp(`\\{\\{\\s*${k}\\s*\\}\\}`, 'g'), String(v ?? '')),
    raw
  );
  const leaks = result.match(/\{\{\s*[a-z][a-z0-9_]*\s*\}\}/g);
  if (leaks) throw new Error(`Unsubstituted placeholders in prompt "${key}": ${leaks.join(', ')}`);
  return result;
}

const TOV = loadPrompt('tone_of_voice');
const EXPAND_BATCH_SYSTEM = loadPrompt('w3_expand_batch_system', { tov: TOV });
const QA_SYSTEM = loadPrompt('qa_verify_system');
const EDITOR_SYSTEM = loadPrompt('editor_system');
// Retry prompts are optional — if missing, Phase 2 falls back to single-pass behavior
const EXPAND_RETRY_HARDER = loadPrompt('w3_expand_batch_retry_harder', { tov: TOV }, true);
const EXPAND_RETRY_SHORTER = loadPrompt('w3_expand_batch_retry_shorter', { tov: TOV }, true);
const RETRY_ENABLED = !!(EXPAND_RETRY_HARDER && EXPAND_RETRY_SHORTER);
if (!RETRY_ENABLED) {
  console.log('Phase 2: retry prompts missing — running single-pass (no attempt 2)');
}

const CPS_DEFAULTS = { de: 12, es: 15, fr: 15, pl: 14, pt: 16, it: 14, tr: 14 };
const LANG_CPS = {};
for (const l of ['de','es','fr','pl','pt','it','tr']) {
  LANG_CPS[l] = parseFloat(configMap['cps_estimate_' + l]) || CPS_DEFAULTS[l];
}

// Slowdown-to-fill: after expansion, if accepted/kept audio still leaves silence in the
// slot, slow the voice (down to voice.speed − MAX_SLOW_DOWN_DELTA) to stretch the audio
// and reduce that silence. Secondary lever AFTER text expansion (text first, then stretch).
// Only fires when remaining silence > SLOWDOWN_MIN_GAP_SEC (avoids uneven pacing on tiny gaps).
const MAX_SLOW_DOWN_DELTA = parseFloat(configMap.max_slow_down_delta) || 0.15;
const SLOWDOWN_MIN_GAP_SEC = parseFloat(configMap.slowdown_min_gap_sec) || 0.5;
// Speed-up to fit (mirrors Phase 1 shorten path): when expanded text slightly overshoots
// speechBudget at voice.speed, try faster speeds before giving up. Same relative cap as
// Phase 1 — see DECISIONS 2026-05-27 DYNAMIC_SPEED_AND_SLOWDOWN_FILL. Allows clause-
// preserving expansions whose char count is right but TTS at default speed lands ~5-10%
// over the slot (e.g. seg_004_de restoration that needs ~3.5s in a 3.4s speechBudget).
const MAX_SPEED_UP_DELTA = parseFloat(configMap.max_speed_up_delta) || 0.20;

// Formality enforcement (mirrors the W2 Formality Lint). Phase 2 expand can re-introduce
// formal address that the W2 lint — which ran before W3 — never sees. Same deterministic
// detector + targeted fix, applied to accepted text BEFORE re-TTS so the audio is informal.
const FR_FORMAL_IMPERATIVES = ['Faites','Prenez','Respirez','Inspirez','Expirez','Soufflez','Fermez','Ouvrez','Laissez','Imaginez','Commencez','Asseyez','Allongez','Gardez','Sentez','Restez','Continuez','Permettez','Posez','Ramenez','Observez','Écoutez','Répétez','Détendez','Relâchez','Installez','Portez','Dirigez','Visualisez','Concentrez','Relevez','Baissez','Tournez','Placez','Étirez','Bougez','Notez','Accueillez','Abandonnez','Lâchez'];
function mkFormalRe(words, ci) { return new RegExp('(?<!\\p{L})(?:' + words.join('|') + ')(?!\\p{L})', ci ? 'iu' : 'u'); }
const FORMAL_PATTERNS = {
  fr: [mkFormalRe(['vous','votre','vos', ...FR_FORMAL_IMPERATIVES], true)],
  de: [mkFormalRe(['Sie','Ihnen','Ihre','Ihrem','Ihren','Ihrer','Ihres'], false)],
  es: [mkFormalRe(['usted','ustedes'], true)],
  it: [mkFormalRe(['Lei','Suo','Suoi','Sua','Voi'], false)],
  pl: [mkFormalRe(['Pan','Pani','Panowie','Panie','Pana','Panu','Panem','Państwo','Państwa'], false)],
  pt: [mkFormalRe(['você','vocês'], true)],
  tr: [mkFormalRe(['siz','sizi','sizin','size','sizden','sizinle'], true)],
};
function isFormal(lang, text) {
  const pats = FORMAL_PATTERNS[lang];
  return !!(text && pats && pats.some(re => re.test(text)));
}
const FORMALITY_FIX_SYSTEM = loadPrompt('formality_fix_system', {}, true) ||
  `You convert formal-address meditation/wellness translations to INFORMAL SINGULAR.\nINPUT: JSON segment_id -> { en, <lang>: text } (only langs needing a fix per segment).\nRewrite each cell using informal singular address for THAT language, changing ONLY address/formality — pronouns, verb conjugation, possessives. Keep meaning, vocabulary, register, length and any "..." or "—" markers IDENTICAL. Each cell stays in its own language.\nTargets: DE du/dich/dein; ES Castilian tú/te/tu; FR tu/te/ton/ta + TU imperatives (Prends/Inspire/Laisse/Fais/Respire, never Prenez/Faites); IT tu/ti/tuo; PL ty-forms; PT European tu/te/teu; TR sen/seni/senin. If a cell is ALREADY informal, return it UNCHANGED.\nOUTPUT ONLY JSON segment_id -> { <lang>: corrected_text }, same keys as input. No preamble/markdown/fences. Start with { end with }.`;

// Cross-language false-friend detection (mirrors Formality Lint pattern). Phase 2 batch
// expansion processes multiple langs side-by-side and Opus occasionally leaks vocabulary
// or spelling between neighbor Romance langs (e.g. PT "essencial"/"primeiro" appearing in
// ES text). Real observed example (sleep1_full seg_019_es):
//   "...sino porque es essencial. Recuerda lo primeiro que te dicen..."
// Both Verify (CLASS 1) and Editor (CLASS A) are prompt-based and occasionally miss such
// cells, especially when only one cell in a batch is contaminated. Deterministic regex per
// target lang catches every known marker with 100% recall on the listed patterns.
//
// Patterns are HIGH PRECISION — chosen to never match valid target-language text. A flagged
// cell may be a true positive or a benign edge case; the targeted LLM fix returns text
// unchanged when already correct, so over-flagging is harmless.
const FALSE_FRIEND_PATTERNS = {
  es: [
    /[ãõ]/u,                    // PT diacritics (Spanish never uses these)
    /\bessenc/iu,               // PT "essencial/essência" — ES uses "esenc"
    /\bprimeir[oa]\b/iu,        // PT "primeiro/primeira" — ES uses "primero/primera"
    /\bnecessári[oa]\b/iu,      // PT "necessário/a" — ES uses "necesario/a" (single 's')
    /\bmissão\b/iu,             // PT "missão" — ES uses "misión"
    /\banche\b/iu,              // IT "anche" — ES uses "también"
    /\bmolto\b/iu,              // IT "molto" — ES uses "mucho"
  ],
  pt: [
    /[ñ]/u,                     // ES letter (Portuguese never uses ñ)
    /\besencial\b/iu,           // ES "esencial" — PT uses "essencial"
    /\bprimer[oa]\b/iu,         // ES "primero/primera" — PT uses "primeiro/a"
    /\bnecesari[oa]\b/iu,       // ES "necesario/a" — PT uses "necessário/a"
  ],
  it: [
    /[ãõçñ]/u,                  // PT/ES/FR diacritics (Italian never uses these)
    /\bessenc/iu,               // ES/PT "essencial/essência" — IT uses "essenziale" (no "essenc-" words in IT)
    /\bprimer[oa]\b/iu,         // ES word
    /\bmuy\b/iu,                // ES word
    /\bahora\b/iu,              // ES word — IT uses "ora"
  ],
  fr: [
    /[ñãõ]/u,                   // ES/PT diacritics (French never uses these)
    /\bnecessary\b/iu,          // EN word
    /\besenci/iu,               // ES spelling — FR uses "essentiel"
  ],
  // DE, PL, TR — distance from Romance large enough that cross-leak is rare. Add here if observed.
};
function hasFalseFriend(lang, text) {
  const pats = FALSE_FRIEND_PATTERNS[lang];
  return !!(text && pats && pats.some(re => re.test(text)));
}
const FALSE_FRIEND_FIX_SYSTEM = loadPrompt('false_friend_fix_system', {}, true) ||
  `You fix cross-language contamination in meditation/wellness translations.\nINPUT: JSON segment_id -> { en, <lang>: text } (only langs needing a fix per segment). The text contains a word or spelling from a NEIGHBORING language (e.g. Portuguese spelling in Spanish text, Spanish word in Italian text).\nRewrite each cell so it uses ONLY the target language's vocabulary and spelling, changing as little as possible. Keep meaning, register, length and any "..." or "—" pause markers IDENTICAL. Each cell stays in its own language.\n\nCommon cross-Romance contaminations to fix:\n- ES (Spanish): never use ã/õ; replace PT spellings "essencial→esencial", "primeiro/a→primero/a", "necessário/a→necesario/a", "missão→misión"; replace IT words "anche→también", "molto→mucho".\n- PT (Portuguese): never use ñ; replace ES spellings "esencial→essencial", "primero/a→primeiro/a", "necesario/a→necessário/a".\n- IT (Italian): never use ã/õ/ç/ñ; replace ES/PT words "essencial→essenziale", "primero/a→primo/a", "muy→molto", "ahora→ora".\n- FR (French): never use ñ/ã/õ; replace EN "necessary→nécessaire", ES "esencial→essentiel".\n\nIf a cell is ALREADY clean for the target language, return it UNCHANGED.\nOUTPUT ONLY JSON segment_id -> { <lang>: corrected_text }, same keys as input. No preamble, no markdown, no fences. Start with { end with }.`;

// Passthrough emit: every input row that is NOT an expansion candidate is still
// emitted unchanged (has_binary=false) so the downstream full-audio + VTT chain —
// which now runs AFTER this node completes — receives the COMPLETE 329-row set with
// refreshed audio_drive_file_id. Without this, Download Segment WAV would only see
// candidate rows and Build Full Audio would drop ~300 segments. Passthrough rows
// route through Has Binary?[false] → Update Localizations (idempotent rewrite of
// values they already hold; phase2_outcome stays empty = not_candidate).
function makePassthrough(j) {
  const enDur = parseFloat(j.en_duration_sec) || 0;
  return {
    json: {
      row_key:                       j.row_key,
      segment_id:                    j.segment_id,
      lang:                          j.lang,
      lesson_id:                     j.lesson_id || (j.segment_id || '').split('_seg_')[0],
      text_translated:               j.text_translated,
      en_start_sec:                  parseFloat(j.en_start_sec) || 0,
      en_duration_sec:               enDur,
      real_duration_sec:             parseFloat(j.real_duration_sec) || 0,
      lead_silence_sec:              parseFloat(j.lead_silence_sec) || 0,
      slot_start_sec:                parseFloat(j.slot_start_sec) || 0,
      slot_end_sec:                  parseFloat(j.slot_end_sec) || 0,
      tts_budget_sec:                parseFloat(j.tts_budget_sec) || enDur,
      tail_silence_sec:              parseFloat(j.tail_silence_sec) || 0,
      final_duration_sec:            parseFloat(j.final_duration_sec) || enDur,
      borrowed_sec:                  parseFloat(j.borrowed_sec) || 0,
      expansion_attempts:            parseFloat(j.expansion_attempts) || 0,
      shorten_retries_in_synthesize: parseFloat(j.shorten_retries_in_synthesize) || 0,
      final_speed:                   parseFloat(j.final_speed) || 1.0,
      needs_attention:               (j.needs_attention === true || j.needs_attention === 'TRUE' || j.needs_attention === 'true'),
      audio_drive_file_id:           j.audio_drive_file_id,
      phase2_outcome:                '',
      needs_retts:                   'FALSE',
      file_name:                     `${j.segment_id}_${j.lang}.wav`,
      has_binary:                    false,
    },
  };
}

// --- collect candidates ---
const allItems = $input.all();
const candidates = {};  // { segment_id: { en, langs: { [lang]: { ... } } } }
let structurallySkipped = 0;
for (const it of allItems) {
  const j = it.json;
  if (j.needs_attention === true || j.needs_attention === 'TRUE' || j.needs_attention === 'true') continue;
  const enDur = parseFloat(j.en_duration_sec) || 0;
  const real = parseFloat(j.real_duration_sec) || 0;
  if (enDur <= 0 || real <= 0) continue;
  if (real >= enDur * THRESHOLD) continue;

  const lang = j.lang;
  const voice = voiceMap[lang];
  if (!voice || !voice.voice_id) continue;

  // Structural impossibility guard: if Phase 1 lead already consumes ≥50% of slot
  // (first segment with large EN start offset, accumulated borrow into next slot,
  // or huge inter-segment gap), TTS budget = en_dur - lead is too small to expand.
  // Phase 2 expansion would always overshoot or hit negative_tail. Skip entirely
  // to save LLM cost and avoid noise in diagnostics.
  const leadSilence = parseFloat(j.lead_silence_sec) || 0;
  if (leadSilence >= enDur * STRUCTURALLY_IMPOSSIBLE_LEAD_RATIO) {
    structurallySkipped++;
    continue;
  }

  if (!candidates[j.segment_id]) {
    candidates[j.segment_id] = { en: j.en_text || '', langs: {} };
  }
  candidates[j.segment_id].langs[lang] = {
    current: j.text_translated || '',
    real_duration: real,
    en_duration: enDur,
    lead_silence: leadSilence,
    audio_drive_file_id: j.audio_drive_file_id,
    row_key: j.row_key,
    segment_id: j.segment_id,
    lesson_id: j.lesson_id || (j.segment_id || '').split('_seg_')[0],
    lang,
    voice_id: voice.voice_id,
    voice_speed: parseFloat(voice.speed) || 1.0,
    voice_model: voice.model || 'eleven_multilingual_v2',
    voice_stability: parseFloat(voice.stability) || 0.5,
    voice_similarity: parseFloat(voice.similarity_boost) || 0.75,
    voice_style: parseFloat(voice.style) || 0,
    en_start_sec: parseFloat(j.en_start_sec) || 0,
    slot_start_sec: parseFloat(j.slot_start_sec) || 0,
    slot_end_sec: parseFloat(j.slot_end_sec) || 0,
    tts_budget_sec: parseFloat(j.tts_budget_sec) || enDur,
    // Phase 1 values preserved verbatim for skipped emit (avoid recomputing tail/final)
    phase1_tail_silence: parseFloat(j.tail_silence_sec) || 0,
    phase1_final_duration: parseFloat(j.final_duration_sec) || enDur,
    phase1_borrowed: parseFloat(j.borrowed_sec) || 0,
    phase1_final_speed: parseFloat(j.final_speed) || 1.0,
    phase1_shorten_retries: parseFloat(j.shorten_retries_in_synthesize) || 0,
  };
}
if (structurallySkipped > 0) console.log(`Phase 2: skipped ${structurallySkipped} structurally-impossible cells (lead ≥ en_dur × ${STRUCTURALLY_IMPOSSIBLE_LEAD_RATIO})`);

const totalSegments = Object.keys(candidates).length;
let totalCells = 0;
for (const data of Object.values(candidates)) totalCells += Object.keys(data.langs).length;

if (totalSegments === 0) {
  console.log('Phase 2: no expansion candidates — emitting all rows as passthrough so the full-audio/VTT chain still runs');
  return allItems.map(it => makePassthrough(it.json));
}
console.log(`Phase 2: ${totalSegments} segments / ${totalCells} cells to expand`);

// --- HTTP helpers ---
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function callAnthropic(body, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const resp = await this.helpers.httpRequest({
        method: 'POST',
        url: ANTHROPIC_URL,
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body, json: true,
      });
      return resp.content?.[0]?.text?.trim() || '';
    } catch (e) {
      if (attempt === retries - 1) { console.error('Phase 2 Anthropic failed:', e.message); return ''; }
      await sleep(2000 * Math.pow(2, attempt));
    }
  }
  return '';
}

async function callGemini(body, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const resp = await this.helpers.httpRequest({
        method: 'POST',
        url: GEMINI_URL,
        headers: { Authorization: `Bearer ${geminiKey}`, 'content-type': 'application/json' },
        body, json: true,
      });
      return resp.choices?.[0]?.message?.content?.trim() || '';
    } catch (e) {
      if (attempt === retries - 1) { console.error('Phase 2 Gemini failed:', e.message); return ''; }
      await sleep(2000 * Math.pow(2, attempt));
    }
  }
  return '';
}

function parseLLMJson(raw) {
  try {
    const cleaned = (raw || '').replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch (e) {
    console.error('Phase 2 parseLLMJson error:', e.message);
  }
  return {};
}

// Coerce an LLM-returned cell value to a trimmed string. LLMs (especially the
// retry-expand prompts) sometimes wrap the text in an object — observed shapes:
// {expanded:"..."}, {text:"..."}, etc. — or return a number/null. asStr unwraps
// the common single-text-key object shapes, stringifies primitives, else ''.
// If unwrapping a known key fails but the object has exactly one string value,
// use that (defensive against unanticipated wrapper keys).
function asStr(v) {
  if (typeof v === 'string') return v.trim();
  if (v == null) return '';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v).trim();
  if (typeof v === 'object' && !Array.isArray(v)) {
    const inner = v.expanded ?? v.text ?? v.value ?? v.translation ?? v.output
      ?? v.expansion ?? v.result ?? v.corrected ?? v.edited ?? v.fixed;
    if (typeof inner === 'string') return inner.trim();
    // Fallback: object with a single string-valued property → use it.
    const strVals = Object.values(v).filter(x => typeof x === 'string' && x.trim());
    if (strVals.length === 1) return strVals[0].trim();
  }
  return '';
}

// LLM refusal / meta-output detection. Opus 4.7 (and other models) occasionally
// "step out of character" — refuse to translate, ask clarifying questions, or
// emit English meta-commentary about the task — instead of producing the requested
// target-language text. If such output is allowed to flow into re-TTS, ElevenLabs
// reads it aloud as voiceover (English refusal text spoken in the target voice).
// Real observed example (sleep1_full seg_020_fr, Opus 4.7):
//   "You're absolutely right to flag this. I cannot complete this task as written
//    because the "CURRENT TRANSLATION" input doesn't correspond to the "ORIGINAL
//    EN TEXT" at all."
// This is shipped audio if not blocked here — the W2 + Verify + Editor chain does
// not catch it because it's grammatically clean English on a semantic level.
//
// Detection: regex match on high-precision English refusal phrases. 1+ match in
// a non-EN cell → reject the LLM output and fall back to Phase 1 audio (which has
// the correct W2 translation, not an Opus refusal).
const REFUSAL_PATTERNS = [
  /\bI (?:cannot|can'?t|am unable to|will not|won'?t|need to|have to|should not|shouldn'?t)\b/i,
  /\bYou(?:'re| are)\s+(?:absolutely\s+)?right\b/i,
  /^Note:\s/m,
  /\b(?:input|task|translation|output|CURRENT|ORIGINAL EN|prompt)\b[^.\n]*\b(?:doesn'?t|does not|cannot|can'?t|won'?t)\b/i,
  /\bI(?:'ll| will)\s+(?:need|have)\s+to\b/i,
  /\bSorry,?\s/i,
  /\bAs an AI\b/i,
  /\bI apologize\b/i,
  /\bThis (?:translation|text|input|task) (?:doesn'?t|does not|is not|isn'?t)\b/i,
];
function looksLikeRefusal(text) {
  if (!text || typeof text !== 'string' || text.length < 20) return false;
  for (const pat of REFUSAL_PATTERNS) {
    if (pat.test(text)) return true;
  }
  return false;
}

// Diagnostics surfaced on the first emitted item's json.phase2_diag (visible in the
// node Output panel — n8n Code console.log only reaches server stdout). Captures raw
// retry-expand samples so we can see exactly what the retry LLM returns without server logs.
const phase2Diag = { retryRawSamples: [], retryCoverage: [], retryNoTextTotal: 0, refusalsAttempt1: [], refusalsRetry: [] };

// --- batch helpers ---
const segmentEntries = Object.entries(candidates);
function chunkSegments(entries, size) {
  const batches = [];
  for (let i = 0; i < entries.length; i += size) batches.push(entries.slice(i, i + size));
  return batches;
}

async function runOneExpandBatch(batch, systemPrompt, charsMultiplier) {
  const userMap = {};
  for (const [sid, data] of batch) {
    userMap[sid] = { en: data.en };
    for (const [lang, info] of Object.entries(data.langs)) {
      const targetChars = Math.round(info.en_duration * (LANG_CPS[lang] || 15) * charsMultiplier);
      userMap[sid][lang] = { current: info.current, target_chars: targetChars };
    }
  }
  const body = {
    model: 'claude-opus-4-7',
    max_tokens: 8000,
    system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: JSON.stringify(userMap, null, 2) }],
  };
  const raw = await callAnthropic.call(this, body);
  return parseLLMJson(raw);
}

async function runOneVerifyBatch(batch, srcMap) {
  const userMap = {};
  for (const [sid, data] of batch) {
    if (!srcMap[sid]) continue;
    userMap[sid] = { en: data.en };
    for (const lang of Object.keys(data.langs)) {
      const t = asStr(srcMap[sid][lang]);
      if (t) userMap[sid][lang] = t;
    }
  }
  if (Object.keys(userMap).length === 0) return {};
  const body = {
    model: 'claude-sonnet-4-6',
    max_tokens: 8000,
    system: [{ type: 'text', text: QA_SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: JSON.stringify(userMap, null, 2) }],
  };
  const raw = await callAnthropic.call(this, body);
  return parseLLMJson(raw);
}

async function runOneEditorBatch(batch, srcMap) {
  const userMap = {};
  for (const [sid, data] of batch) {
    if (!srcMap[sid]) continue;
    userMap[sid] = { en: data.en };
    for (const lang of Object.keys(data.langs)) {
      const text = asStr(srcMap[sid][lang]);
      if (text) userMap[sid][lang] = text;
    }
  }
  if (Object.keys(userMap).length === 0) return {};
  const body = {
    model: 'gemini-3.5-flash',
    messages: [
      { role: 'system', content: EDITOR_SYSTEM },
      { role: 'user', content: JSON.stringify(userMap, null, 2) },
    ],
    response_format: { type: 'json_object' },
  };
  const raw = await callGemini.call(this, body);
  return parseLLMJson(raw);
}

async function runAllBatchesParallel(batches, runner) {
  const out = {};
  for (let i = 0; i < batches.length; i += CHUNK) {
    const slice = batches.slice(i, i + CHUNK);
    const partial = await Promise.all(slice.map(b => runner.call(this, b)));
    for (const p of partial) Object.assign(out, p);
  }
  return out;
}

// --- RE-TTS + WAV rebuild ---
function buildWav(pcm) {
  const n = pcm.length;
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + n, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(SAMPLE_RATE, 24);
  h.writeUInt32LE(SAMPLE_RATE * BPS, 28); h.writeUInt16LE(BPS, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(n, 40);
  return Buffer.concat([h, pcm]);
}

async function reTtsOne(task) {
  const { sid, lang, info } = task;
  const newText = asStr(task.newText);
  if (!newText) return { sid, lang, outcome: 'no_change' };

  // Target the EXACT file duration Phase 1 produced (= the segment's slot). Keeps the
  // concatenated full WAV EN-aligned (every segment fills its slot; all langs sum equal).
  const lead = info.lead_silence;
  const targetFileDur = info.phase1_final_duration > 0
    ? info.phase1_final_duration
    : (lead + info.en_duration);
  const speechBudget = targetFileDur - lead;
  const textChanged = newText !== asStr(info.current);

  // Unchanged text: only re-synthesize when slowdown could meaningfully cut silence
  // (Phase 1 real_duration tells us the gap without a wasted TTS call). Else keep Phase 1.
  if (!textChanged) {
    const p1Gap = speechBudget - (info.real_duration || 0);
    if (p1Gap <= SLOWDOWN_MIN_GAP_SEC) return { sid, lang, outcome: 'no_change' };
  }

  const ttsAt = async (speed) => {
    const resp = await this.helpers.httpRequest({
      method: 'POST',
      url: ELEVENLABS_URL(info.voice_id),
      headers: { 'xi-api-key': elevenKey, 'content-type': 'application/json', accept: 'audio/pcm' },
      body: {
        text: newText,
        model_id: info.voice_model,
        voice_settings: {
          stability: info.voice_stability,
          similarity_boost: info.voice_similarity,
          style: info.voice_style,
          speed,
        },
      },
      encoding: 'arraybuffer',
      returnFullResponse: false,
    });
    return Buffer.from(resp);
  };

  try {
    let pcm = await ttsAt(info.voice_speed);
    if (!pcm || pcm.length < 4410) return { sid, lang, outcome: 'tts_empty', pcmLen: pcm?.length || 0 };
    let real = pcm.length / (SAMPLE_RATE * BPS);
    let usedSpeed = info.voice_speed;

    // Speed-up retry: speech at voice.speed slightly overshoots speechBudget. Try faster
    // speeds (relative to voice.speed) before giving up — mirrors Phase 1 shorten path's
    // [voice.speed + Δ·⅔, voice.speed + Δ] schedule. Lets clause-preserving expansions fit
    // when restored text is right by chars but lands ~5-10% over slot at default speed.
    if (real > speechBudget) {
      const speedUpSteps = [
        info.voice_speed + MAX_SPEED_UP_DELTA * (2 / 3),
        info.voice_speed + MAX_SPEED_UP_DELTA,
      ];
      for (const speedTry of speedUpSteps) {
        const fastPcm = await ttsAt(speedTry);
        if (!fastPcm || fastPcm.length < 4410) continue;
        const fastReal = fastPcm.length / (SAMPLE_RATE * BPS);
        if (fastReal <= speechBudget) {
          pcm = fastPcm;
          real = fastReal;
          usedSpeed = parseFloat(speedTry.toFixed(3));
          break;
        }
      }
      if (real > speechBudget) {
        return { sid, lang, outcome: 'overshoot', newRealDur: real, speechBudget, targetFileDur, newText };
      }
    }

    // Slowdown-to-fill (secondary lever, AFTER text expansion): if silence remains beyond
    // the gap threshold, slow the voice to stretch the audio toward filling the slot,
    // floored at voice.speed − MAX_SLOW_DOWN_DELTA. audio_len ∝ 1/speed, so the speed that
    // stretches `real` to `speechBudget` is voice.speed × real/speechBudget; clamp to floor.
    if (speechBudget - real > SLOWDOWN_MIN_GAP_SEC) {
      const floor = info.voice_speed - MAX_SLOW_DOWN_DELTA;
      const wanted = info.voice_speed * (real / speechBudget);
      const slowSpeed = parseFloat(Math.max(floor, wanted).toFixed(3));
      if (slowSpeed < info.voice_speed - 1e-6 && slowSpeed > 0) {
        const slowPcm = await ttsAt(slowSpeed);
        if (slowPcm && slowPcm.length >= 4410) {
          const slowReal = slowPcm.length / (SAMPLE_RATE * BPS);
          if (slowReal <= speechBudget) { pcm = slowPcm; real = slowReal; usedSpeed = slowSpeed; }
        }
      }
    }

    const tail = targetFileDur - lead - real;
    if (tail < 0) {
      return { sid, lang, outcome: 'negative_tail', lead, newRealDur: real, targetFileDur };
    }
    const leadBytes = Math.round(lead * SAMPLE_RATE) * BPS;
    const tailBytes = Math.round(tail * SAMPLE_RATE) * BPS;
    const fullPcm = Buffer.concat([
      leadBytes > 0 ? Buffer.alloc(leadBytes, 0) : Buffer.alloc(0),
      pcm,
      tailBytes > 0 ? Buffer.alloc(tailBytes, 0) : Buffer.alloc(0),
    ]);
    const newWav = buildWav(fullPcm);
    const finalDur = lead + real + tail;
    return {
      sid, lang,
      outcome: 'accepted',
      newText,
      newRealDur: parseFloat(real.toFixed(3)),
      newTailSilence: parseFloat(tail.toFixed(3)),
      newLeadSilence: parseFloat(lead.toFixed(3)),
      newFinalDur: parseFloat(finalDur.toFixed(3)),
      finalSpeed: usedSpeed,
      slowed: usedSpeed !== info.voice_speed,
      wavBase64: newWav.toString('base64'),
      info,
    };
  } catch (e) {
    return { sid, lang, outcome: 'error', error: e.message };
  }
}

// Deterministic cross-language false-friend enforcement, in place, BEFORE re-TTS (and
// before fixFormalityInTasks — so the formality detector sees the post-fix text). Mirrors
// fixFormalityInTasks structure: collect flagged cells, single batched LLM call, apply.
async function fixFalseFriendsInTasks(tasks) {
  const flagged = {};
  const hits = [];
  for (const t of tasks) {
    if (hasFalseFriend(t.lang, t.newText)) {
      if (!flagged[t.sid]) flagged[t.sid] = { en: candidates[t.sid]?.en || '' };
      flagged[t.sid][t.lang] = t.newText;
      hits.push(t);
    }
  }
  if (hits.length === 0) return;
  const byLang = {};
  for (const h of hits) byLang[h.lang] = (byLang[h.lang] || 0) + 1;
  console.log(`Phase 2 false-friend: ${hits.length} flagged cells, fixing before re-TTS`, JSON.stringify(byLang));
  const body = {
    model: 'claude-sonnet-4-6', max_tokens: 8000,
    system: [{ type: 'text', text: FALSE_FRIEND_FIX_SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: JSON.stringify(flagged, null, 2) }],
  };
  const fixed = parseLLMJson(await callAnthropic.call(this, body));
  let applied = 0;
  let stillContaminated = 0;
  for (const t of hits) {
    const nf = asStr(fixed[t.sid]?.[t.lang]);
    if (nf && nf !== t.newText) {
      t.newText = nf;
      applied++;
      if (hasFalseFriend(t.lang, nf)) stillContaminated++;
    }
  }
  console.log(`Phase 2 false-friend: applied ${applied} fixes${stillContaminated ? `; ${stillContaminated} cells still match a marker after fix` : ''}`);
}

// Deterministic formality enforcement on accepted text, in place, BEFORE re-TTS.
// Mutates task.newText for any cell whose text matches a formal-address marker.
async function fixFormalityInTasks(tasks) {
  const flagged = {};
  const hits = [];
  for (const t of tasks) {
    if (isFormal(t.lang, t.newText)) {
      if (!flagged[t.sid]) flagged[t.sid] = { en: candidates[t.sid]?.en || '' };
      flagged[t.sid][t.lang] = t.newText;
      hits.push(t);
    }
  }
  if (hits.length === 0) return;
  const byLang = {};
  for (const h of hits) byLang[h.lang] = (byLang[h.lang] || 0) + 1;
  console.log(`Phase 2 formality: ${hits.length} flagged cells, fixing before re-TTS`, JSON.stringify(byLang));
  const body = {
    model: 'claude-sonnet-4-6', max_tokens: 8000,
    system: [{ type: 'text', text: FORMALITY_FIX_SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: JSON.stringify(flagged, null, 2) }],
  };
  const fixed = parseLLMJson(await callAnthropic.call(this, body));
  let applied = 0;
  for (const t of hits) {
    const nf = asStr(fixed[t.sid]?.[t.lang]);
    if (nf && nf !== t.newText) { t.newText = nf; applied++; }
  }
  console.log(`Phase 2 formality: applied ${applied} informal rewrites`);
}

async function runReTtsTasks(tasks) {
  await fixFalseFriendsInTasks.call(this, tasks);
  await fixFormalityInTasks.call(this, tasks);
  const results = [];
  for (let i = 0; i < tasks.length; i += ELEVENLABS_CHUNK) {
    const slice = tasks.slice(i, i + ELEVENLABS_CHUNK);
    const partial = await Promise.all(slice.map(t => reTtsOne.call(this, t)));
    for (const r of partial) results.push(r);
  }
  return results;
}

// =====================================================================
// PHASE 2 — ATTEMPT 1
// =====================================================================
const expandBatches = chunkSegments(segmentEntries, EXPAND_BATCH_SIZE);
console.log(`Phase 2 attempt 1: ${expandBatches.length} batches of up to ${EXPAND_BATCH_SIZE} segments`);

const expand1Map = await runAllBatchesParallel.call(this,
  expandBatches,
  function (b) { return runOneExpandBatch.call(this, b, EXPAND_BATCH_SYSTEM, 0.95); }
);
console.log(`Phase 2 expand attempt 1 complete — ${Object.keys(expand1Map).length} segments returned`);

const verify1Map = await runAllBatchesParallel.call(this,
  expandBatches,
  function (b) { return runOneVerifyBatch.call(this, b, expand1Map); }
);

const postVerify1Map = {};
for (const [sid, data] of segmentEntries) {
  const exp = expand1Map[sid];
  if (!exp) continue;
  postVerify1Map[sid] = {};
  for (const lang of Object.keys(data.langs)) {
    const expText = asStr(exp[lang]);
    if (!expText) continue;
    const verText = asStr(verify1Map[sid]?.[lang]);
    postVerify1Map[sid][lang] = verText || expText;
  }
}
console.log('Phase 2 verify attempt 1 complete');

const editor1Map = await runAllBatchesParallel.call(this,
  expandBatches,
  function (b) { return runOneEditorBatch.call(this, b, postVerify1Map); }
);

const final1TextMap = {};
for (const [sid, data] of segmentEntries) {
  if (!postVerify1Map[sid]) continue;
  final1TextMap[sid] = {};
  for (const lang of Object.keys(data.langs)) {
    const pv = asStr(postVerify1Map[sid][lang]);
    if (!pv) continue;
    const ed = asStr(editor1Map[sid]?.[lang]);
    final1TextMap[sid][lang] = ed || pv;
  }
}
console.log('Phase 2 editor attempt 1 complete');

// Build attempt 1 re-TTS tasks. Cells where LLM didn't return text get
// a synthetic 'llm_dropped' result so we record the outcome explicitly
// (otherwise they'd silently fall through to pickFinal's 'no_attempt' bucket
// which makes diagnostics ambiguous — was the cell never tried, or did the
// LLM just drop it from its JSON response).
// Refusal detection: if the LLM emitted English meta/refusal text (Opus 4.7
// occasionally does this), reject it as 'llm_refusal' instead of synthesizing.
// pickFinal will fall back to attempt 2 (if accepted) else Phase 1 audio.
const reTts1Tasks = [];
const droppedResults1 = [];
for (const [sid, data] of segmentEntries) {
  for (const [lang, info] of Object.entries(data.langs)) {
    const newText = final1TextMap[sid]?.[lang];
    if (!newText) {
      droppedResults1.push({ sid, lang, outcome: 'llm_dropped' });
    } else if (looksLikeRefusal(newText)) {
      droppedResults1.push({ sid, lang, outcome: 'llm_refusal' });
      if (phase2Diag.refusalsAttempt1.length < 5) {
        phase2Diag.refusalsAttempt1.push({ sid, lang, sample: newText.slice(0, 200) });
      }
      console.log(`Phase 2 attempt 1: LLM refusal detected for ${sid}_${lang} — rejecting, will fall back to Phase 1`);
    } else {
      reTts1Tasks.push({ sid, lang, newText, info });
    }
  }
}

const reTtsResults1 = await runReTtsTasks.call(this, reTts1Tasks);
const results1 = [...reTtsResults1, ...droppedResults1];

// Build outcomes map keyed by row_key — track attempt 1 for ALL candidates
const outcomes = {};
for (const [sid, data] of segmentEntries) {
  for (const [lang, info] of Object.entries(data.langs)) {
    outcomes[info.row_key] = { info, attempt1: null, attempt2: null };
  }
}
for (const r of results1) {
  const rk = `${r.sid}_${r.lang}`;
  if (outcomes[rk]) outcomes[rk].attempt1 = r;
}

// Count attempt 1 outcomes
const outcomeCounts1 = {};
for (const rk of Object.keys(outcomes)) {
  const a1 = outcomes[rk].attempt1;
  const oc = a1 ? a1.outcome : 'no_attempt';
  outcomeCounts1[oc] = (outcomeCounts1[oc] || 0) + 1;
}
console.log('Phase 2 attempt 1 outcomes:', JSON.stringify(outcomeCounts1));

// =====================================================================
// PHASE 2 — ATTEMPT 2 (retry pass)
// =====================================================================
// Classify retry candidates:
//   harder: no_change OR (accepted but newRealDur < en_dur × STILL_SHORT_THRESHOLD)
//   shorter: overshoot
//   no-retry: negative_tail, tts_empty, error — too edge-case, leave as-is

const harderTasks = [];   // { sid, lang, info, prevText }
const shorterTasks = [];

if (RETRY_ENABLED) {
  for (const [rk, o] of Object.entries(outcomes)) {
    const a1 = o.attempt1;
    const info = o.info;
    if (!a1) continue;
    if (a1.outcome === 'no_change') {
      harderTasks.push({ sid: info.segment_id, lang: info.lang, info, prevText: info.current });
    } else if (a1.outcome === 'accepted' && a1.newRealDur < info.en_duration * STILL_SHORT_THRESHOLD) {
      harderTasks.push({ sid: info.segment_id, lang: info.lang, info, prevText: a1.newText });
    } else if (a1.outcome === 'overshoot') {
      shorterTasks.push({ sid: info.segment_id, lang: info.lang, info, prevText: a1.newText });
    }
  }
}

console.log(`Phase 2 attempt 2 candidates: harder=${harderTasks.length}, shorter=${shorterTasks.length}`);

async function runRetryGroup(tasks, systemPrompt, charsMultiplier) {
  if (tasks.length === 0) return [];
  // Re-group by segment_id for batch input. We need en_text per segment;
  // candidates[sid].en already has it.
  const groupedBySid = {};
  for (const t of tasks) {
    if (!groupedBySid[t.sid]) groupedBySid[t.sid] = [];
    groupedBySid[t.sid].push(t);
  }
  const entries = Object.entries(groupedBySid);
  const retryBatches = [];
  for (let i = 0; i < entries.length; i += EXPAND_BATCH_SIZE) {
    retryBatches.push(entries.slice(i, i + EXPAND_BATCH_SIZE));
  }
  // Build batch in format expected by runOneExpandBatch (segmentEntries-shaped):
  // each batch element = [sid, { en, langs: { [lang]: info with previous_attempt added } }]
  const formattedBatches = retryBatches.map(batch =>
    batch.map(([sid, taskList]) => {
      const langsObj = {};
      for (const t of taskList) {
        langsObj[t.lang] = { ...t.info, previous_attempt: t.prevText };
      }
      return [sid, { en: candidates[sid].en, langs: langsObj }];
    })
  );

  // Custom expand call that includes previous_attempt in user payload
  async function runOneRetryExpand(batch) {
    const userMap = {};
    for (const [sid, data] of batch) {
      userMap[sid] = { en: data.en };
      for (const [lang, info] of Object.entries(data.langs)) {
        const targetChars = Math.round(info.en_duration * (LANG_CPS[lang] || 15) * charsMultiplier);
        userMap[sid][lang] = {
          current: info.current,
          previous_attempt: info.previous_attempt,
          target_chars: targetChars,
        };
      }
    }
    const body = {
      model: 'claude-opus-4-7',
      max_tokens: 8000,
      system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: JSON.stringify(userMap, null, 2) }],
    };
    const raw = await callAnthropic.call(this, body);
    if (phase2Diag.retryRawSamples.length < 3) {
      phase2Diag.retryRawSamples.push({
        sids: Object.keys(userMap),
        rawLen: (raw || '').length,
        rawHead: (raw || '').slice(0, 400),
      });
    }
    return parseLLMJson(raw);
  }

  const expandRetryMap = await runAllBatchesParallel.call(this, formattedBatches, runOneRetryExpand);

  // Diagnostic: how many segment_ids did the retry expand actually return? If the
  // retry LLM returns malformed JSON or omits sids, expandRetryMap is missing keys
  // and every retry lang under that sid falls through. Whole-segment drops are the
  // signature of this.
  const expectedSids = [...new Set(tasks.map(t => t.sid))];
  const returnedSids = expectedSids.filter(s => expandRetryMap[s] && Object.keys(expandRetryMap[s]).length);
  phase2Diag.retryCoverage.push({ returned: returnedSids.length, expected: expectedSids.length, missing: expectedSids.filter(s => !returnedSids.includes(s)) });
  if (returnedSids.length < expectedSids.length) {
    console.log(`Phase 2 retry expand coverage: ${returnedSids.length}/${expectedSids.length} segments returned (missing: ${expectedSids.filter(s => !returnedSids.includes(s)).join(', ')})`);
  }

  // Skip Verify, run Editor only
  const editorRetryMap = await runAllBatchesParallel.call(this,
    formattedBatches,
    function (b) { return runOneEditorBatch.call(this, b, expandRetryMap); }
  );

  // Final text per task: editor → expand. If retry produced NO usable text for a cell,
  // we do NOT emit a result for it — leaving outcomes[rk].attempt2 unset so pickFinal
  // falls back to attempt 1. This is critical: a still_short cell had attempt1='accepted'
  // (a real expansion), and a retry-drop must NOT clobber it down to Phase 1 audio.
  // Dropped retries are logged, not surfaced as a worse outcome.
  // Refusals on retry are also dropped without recording a2 — attempt 1 stands.
  const reTtsRetryTasks = [];
  let retryNoText = 0;
  let retryRefusal = 0;
  for (const t of tasks) {
    const ed = asStr(editorRetryMap[t.sid]?.[t.lang]);
    const ex = asStr(expandRetryMap[t.sid]?.[t.lang]);
    const finalText = ed || ex || null;
    if (!finalText) {
      retryNoText++;  // skip → attempt 1 stands (no a2 recorded for this cell)
    } else if (looksLikeRefusal(finalText)) {
      retryRefusal++;  // skip → attempt 1 stands
      if (phase2Diag.refusalsRetry.length < 5) {
        phase2Diag.refusalsRetry.push({ sid: t.sid, lang: t.lang, sample: finalText.slice(0, 200) });
      }
      console.log(`Phase 2 retry: LLM refusal detected for ${t.sid}_${t.lang} — keeping attempt 1 result`);
    } else {
      reTtsRetryTasks.push({ sid: t.sid, lang: t.lang, newText: finalText, info: t.info });
    }
  }
  phase2Diag.retryNoTextTotal += retryNoText;
  if (retryNoText > 0) console.log(`Phase 2 retry: ${retryNoText}/${tasks.length} cells got no retry text — kept attempt 1 result`);
  if (retryRefusal > 0) console.log(`Phase 2 retry: ${retryRefusal}/${tasks.length} cells got LLM refusal text — kept attempt 1 result`);

  return await runReTtsTasks.call(this, reTtsRetryTasks);
}

const [results2Harder, results2Shorter] = await Promise.all([
  runRetryGroup.call(this, harderTasks, EXPAND_RETRY_HARDER || EXPAND_BATCH_SYSTEM, 1.05),
  runRetryGroup.call(this, shorterTasks, EXPAND_RETRY_SHORTER || EXPAND_BATCH_SYSTEM, 0.85),
]);
const results2 = [...results2Harder, ...results2Shorter];
for (const r of results2) {
  const rk = `${r.sid}_${r.lang}`;
  if (outcomes[rk]) outcomes[rk].attempt2 = r;
}

const outcomeCounts2 = {};
for (const rk of Object.keys(outcomes)) {
  const a2 = outcomes[rk].attempt2;
  if (a2) outcomeCounts2[a2.outcome] = (outcomeCounts2[a2.outcome] || 0) + 1;
}
console.log('Phase 2 attempt 2 outcomes:', JSON.stringify(outcomeCounts2));

// =====================================================================
// MERGE & EMIT
// =====================================================================
// Per row_key, choose best result:
//   - If attempt 2 accepted → use attempt 2 (it had better target)
//   - Else if attempt 1 accepted → use attempt 1
//   - Else → use most recent outcome reason (attempt 2 if exists else attempt 1)

function pickFinal(o) {
  const a1 = o.attempt1;
  const a2 = o.attempt2;
  if (a2 && a2.outcome === 'accepted') return { result: a2, attempts: 2, outcome: 'accepted' };
  if (a1 && a1.outcome === 'accepted') return { result: a1, attempts: a2 ? 2 : 1, outcome: 'accepted' };
  // No accept — report most recent skip outcome
  if (a2) return { result: null, attempts: 2, outcome: a2.outcome };
  if (a1) return { result: null, attempts: 1, outcome: a1.outcome };
  return { result: null, attempts: 0, outcome: 'no_attempt' };
}

const emitted = [];
const finalOutcomeCounts = {};
for (const [rk, o] of Object.entries(outcomes)) {
  const { result, attempts, outcome } = pickFinal(o);
  finalOutcomeCounts[outcome] = (finalOutcomeCounts[outcome] || 0) + 1;
  const info = o.info;
  if (result && outcome === 'accepted') {
    // Accepted — emit with binary, recompute needs_attention
    const ratio = result.newRealDur / info.en_duration;
    const needsAttention = ratio < NEEDS_ATTENTION_THRESHOLD;
    emitted.push({
      json: {
        row_key:                       info.row_key,
        segment_id:                    info.segment_id,
        lang:                          info.lang,
        lesson_id:                     info.lesson_id,
        text_translated:               result.newText,
        en_start_sec:                  info.en_start_sec,
        en_duration_sec:               info.en_duration,
        real_duration_sec:             result.newRealDur,
        lead_silence_sec:              result.newLeadSilence,
        slot_start_sec:                info.slot_start_sec,
        slot_end_sec:                  info.slot_end_sec,
        tts_budget_sec:                info.tts_budget_sec,
        tail_silence_sec:              result.newTailSilence,
        final_duration_sec:            result.newFinalDur,
        borrowed_sec:                  0,
        expansion_attempts:            attempts,
        shorten_retries_in_synthesize: 0,
        final_speed:                   (result.finalSpeed != null ? result.finalSpeed : info.voice_speed),
        needs_attention:               needsAttention,
        audio_drive_file_id:           info.audio_drive_file_id,
        phase2_outcome:                'accepted',
        needs_retts:                   'FALSE',
        file_name:                     `${info.segment_id}_${info.lang}.wav`,
        has_binary:                    true,
      },
      binary: {
        data: {
          data:     result.wavBase64,
          mimeType: 'audio/wav',
          fileName: `${info.segment_id}_${info.lang}.wav`,
        },
      },
    });
  } else {
    // Rejected — emit json only (no binary). Update Localizations writes phase2_outcome
    // and expansion_attempts; all audio-fitting fields (tail/final/borrowed/final_speed/
    // shorten_retries) are passed through verbatim from Phase 1 input — we never recompute
    // them from formulas that may not match Phase 1's actual WAV structure (e.g.
    // first-segment offset, accumulated borrow, structurally tight slots).
    emitted.push({
      json: {
        row_key:                       info.row_key,
        segment_id:                    info.segment_id,
        lang:                          info.lang,
        lesson_id:                     info.lesson_id,
        text_translated:               info.current,
        en_start_sec:                  info.en_start_sec,
        en_duration_sec:               info.en_duration,
        real_duration_sec:             info.real_duration,
        lead_silence_sec:              info.lead_silence,
        slot_start_sec:                info.slot_start_sec,
        slot_end_sec:                  info.slot_end_sec,
        tts_budget_sec:                info.tts_budget_sec,
        tail_silence_sec:              info.phase1_tail_silence,
        final_duration_sec:            info.phase1_final_duration,
        borrowed_sec:                  info.phase1_borrowed,
        expansion_attempts:            attempts,
        shorten_retries_in_synthesize: info.phase1_shorten_retries,
        final_speed:                   info.phase1_final_speed,
        needs_attention:               false,
        audio_drive_file_id:           info.audio_drive_file_id,
        phase2_outcome:                outcome,
        needs_retts:                   'FALSE',
        file_name:                     `${info.segment_id}_${info.lang}.wav`,
        has_binary:                    false,
      },
    });
  }
}

// Emit passthrough for every input row that was NOT a candidate (non-candidates,
// needs_attention rows, structurally-impossible skips). Ensures downstream chain
// receives all 329 rows, not just the candidates.
const candidateRowKeys = new Set(Object.keys(outcomes));
let passthroughCount = 0;
for (const it of allItems) {
  if (candidateRowKeys.has(it.json.row_key)) continue;
  emitted.push(makePassthrough(it.json));
  passthroughCount++;
}

console.log('Phase 2 FINAL outcomes:', JSON.stringify(finalOutcomeCounts));
console.log(`Phase 2 emit: ${emitted.filter(e => e.json.has_binary).length} accepted (binary), ${emitted.filter(e => !e.json.has_binary && e.json.phase2_outcome).length} rejected candidates, ${passthroughCount} passthrough → ${emitted.length} total`);

// Surface diagnostics on the first item so they're visible in the node Output panel
// (n8n Code console.log only reaches server stdout). phase2_diag is NOT a mapped
// Update Localizations column, so it never reaches the sheet — UI-only.
if (emitted.length > 0) {
  emitted[0].json.phase2_diag = JSON.stringify({
    finalOutcomes: finalOutcomeCounts,
    attempt1: outcomeCounts1,
    attempt2: outcomeCounts2,
    retryCoverage: phase2Diag.retryCoverage,
    retryNoTextTotal: phase2Diag.retryNoTextTotal,
    retryRawSamples: phase2Diag.retryRawSamples,
  });
}

return emitted;
