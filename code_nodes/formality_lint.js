// W2 Formality Lint — deterministic informal-address enforcement.
// Runs AFTER all LLM passes (Adapt Translations), BEFORE Update Sheet. The prompt-based
// guards (translate_system FORMALITY, qa_verify_system R6.c CLASS 2 + FR scan) are
// probabilistic and miss isolated slips — e.g. one FR segment in "vous" (Faites confiance)
// while every other segment is "tu". R6.c itself notes: when only ONE segment in a batch
// violates, the LLM scan misses it. This node deterministically scans every {lang}_text for
// formal-address markers (100% recall on known markers) and, for any hit, does a single
// targeted Anthropic call to rewrite ONLY the flagged cells to informal singular.
//
// Safety: the fix prompt returns text UNCHANGED when already informal, so a false-positive
// detection costs one cheap call but never corrupts. Detection can therefore be generous.
//
// Input  (from Adapt Translations): one item per segment with segment_id, en_text,
//         de_text..tr_text, *_adaptation_attempts, adaptation_attempts.
// Output (to Update Sheet, autoMap by segment_id): same items, formal {lang}_text replaced.

const LANGS = ['de', 'es', 'fr', 'pl', 'pt', 'it', 'tr'];
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-5';

// --- config + prompt ---
const configMap = {};
$('Read Config').all().forEach(i => { if (i.json.key) configMap[i.json.key] = i.json.value; });
const apiKey = configMap.anthropic_api_key || '';
if (!apiKey) throw new Error('anthropic_api_key missing from config sheet');

const promptMap = {};
$('Read Prompts').all().forEach(i => { if (i.json.key) promptMap[i.json.key] = i.json.value; });

// Optional externalized prompt; falls back to the built-in default below if absent.
const FIX_SYSTEM = (promptMap.formality_fix_system && promptMap.formality_fix_system.trim())
  ? promptMap.formality_fix_system
  : `You convert formal-address meditation/wellness translations to INFORMAL SINGULAR.
INPUT: a JSON object mapping segment_id -> { en, <lang>: text } (only the langs that need fixing are present per segment).
For each cell, rewrite the text using informal singular address for THAT language, changing ONLY address/formality — pronouns, verb conjugation, possessives. Keep meaning, vocabulary, register, length and any "..." or "—" pause markers IDENTICAL. Do not translate across languages; each cell stays in its own language.
Informal targets:
- DE: du/dich/dein (never Sie/Ihnen/Ihr)
- ES: Castilian tú/te/tu (never usted/le/su, never vos/ustedes)
- FR: tu/te/ton/ta/tes; imperatives in TU form: Prends (not Prenez), Inspire (not Inspirez), Laisse (not Laissez), Fais (not Faites), Ferme (not Fermez), Ouvre (not Ouvrez), Commence (not Commencez), Respire (not Respirez) (never vous/votre/vos)
- IT: tu/ti/tuo/tua (never Lei/La/Suo/Voi)
- PL: ty-form verbs (jesteś, czujesz, weź) (never Pan/Pani/Państwo)
- PT: European tu/te/teu/tua with EU conjugation (tu fazes, tu sentes) (never Brazilian você/seu/sua)
- TR: sen/seni/senin (never siz/sizi/sizin)
If a cell is ALREADY informal, return it UNCHANGED.
OUTPUT ONLY a JSON object mapping segment_id -> { <lang>: corrected_text }, the SAME segment_ids and langs as input. No preamble, no markdown, no commentary, no \`\`\`json fences. Start with { and end with }.`;

// --- formal-address detection per lang (high recall; LLM fix is no-op when clean) ---
// Unicode-aware word boundaries: ASCII \b breaks around accented letters (você, Państwo,
// Écoutez), so we use (?<!\p{L})word(?!\p{L}) with the /u flag instead.
// FR imperatives are a WHITELIST of meditation verbs in -ez form — a blind /\w+ez/ would
// false-match nouns/adverbs (nez, assez, chez). vous/votre/vos are unconditional.
// Case sensitivity per lang: DE/IT/PL formal pronouns are capitalized (lowercase sie/ihr/
// lei = she/their/she — legitimate), so case-SENSITIVE. FR/ES/PT/TR markers are wrong in
// any case, so case-INsensitive.
const FR_FORMAL_IMPERATIVES = ['Faites','Prenez','Respirez','Inspirez','Expirez','Soufflez','Fermez','Ouvrez','Laissez','Imaginez','Commencez','Asseyez','Allongez','Gardez','Sentez','Restez','Continuez','Permettez','Posez','Ramenez','Observez','Écoutez','Répétez','Détendez','Relâchez','Installez','Portez','Dirigez','Visualisez','Concentrez','Relevez','Baissez','Tournez','Placez','Étirez','Bougez','Notez','Accueillez','Abandonnez','Lâchez'];
function mkRe(words, caseInsensitive) {
  return new RegExp('(?<!\\p{L})(?:' + words.join('|') + ')(?!\\p{L})', caseInsensitive ? 'iu' : 'u');
}
const FORMAL_PATTERNS = {
  fr: [mkRe(['vous', 'votre', 'vos', ...FR_FORMAL_IMPERATIVES], true)],
  de: [mkRe(['Sie', 'Ihnen', 'Ihre', 'Ihrem', 'Ihren', 'Ihrer', 'Ihres'], false)],
  es: [mkRe(['usted', 'ustedes'], true)],
  it: [mkRe(['Lei', 'Suo', 'Suoi', 'Sua', 'Voi'], false)],
  pl: [mkRe(['Pan', 'Pani', 'Panowie', 'Panie', 'Pana', 'Panu', 'Panem', 'Państwo', 'Państwa'], false)],
  pt: [mkRe(['você', 'vocês'], true)],
  tr: [mkRe(['siz', 'sizi', 'sizin', 'size', 'sizden', 'sizinle'], true)],
};

function isFormal(lang, text) {
  if (!text) return false;
  const pats = FORMAL_PATTERNS[lang];
  if (!pats) return false;
  return pats.some(re => re.test(text));
}

// --- collect flagged cells ---
const items = $input.all();
const flagged = {};   // { segment_id: { en, [lang]: text } }
const flagList = [];  // [{ sid, lang }]
for (const it of items) {
  const j = it.json;
  const sid = j.segment_id;
  if (!sid) continue;
  for (const lang of LANGS) {
    const text = j[`${lang}_text`];
    if (isFormal(lang, text)) {
      if (!flagged[sid]) flagged[sid] = { en: j.en_text || '' };
      flagged[sid][lang] = text;
      flagList.push({ sid, lang });
    }
  }
}

if (flagList.length === 0) {
  console.log('Formality Lint: no formal-address markers detected — passthrough');
  return items;
}
const byLang = {};
for (const f of flagList) byLang[f.lang] = (byLang[f.lang] || 0) + 1;
console.log(`Formality Lint: ${flagList.length} cells flagged for informal re-fix`, JSON.stringify(byLang));

// --- targeted LLM re-fix (single batch call) ---
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function callClaude(body, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const resp = await this.helpers.httpRequest({
        method: 'POST', url: ANTHROPIC_URL,
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body, json: true,
      });
      return resp.content?.[0]?.text?.trim() || '';
    } catch (e) {
      if (attempt === retries - 1) { console.error('Formality Lint Claude failed:', e.message); return ''; }
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
  } catch (e) { console.error('Formality Lint parse error:', e.message); }
  return {};
}
function asStr(v) {
  if (typeof v === 'string') return v.trim();
  if (v == null) return '';
  if (typeof v === 'object' && !Array.isArray(v)) {
    const inner = v.text ?? v.corrected ?? v.fixed ?? v.value ?? v.informal;
    if (typeof inner === 'string') return inner.trim();
    const s = Object.values(v).filter(x => typeof x === 'string' && x.trim());
    if (s.length === 1) return s[0].trim();
  }
  return '';
}

const body = {
  model: MODEL,
  max_tokens: 8000,
  system: [{ type: 'text', text: FIX_SYSTEM, cache_control: { type: 'ephemeral' } }],
  messages: [{ role: 'user', content: JSON.stringify(flagged, null, 2) }],
};
const fixed = parseLLMJson(await callClaude.call(this, body));

// --- apply fixes (only replace when LLM returned a non-empty changed string) ---
let applied = 0, stillFormal = 0;
for (const it of items) {
  const j = it.json;
  const sid = j.segment_id;
  if (!flagged[sid]) continue;
  for (const lang of LANGS) {
    if (!(lang in flagged[sid])) continue;
    const newText = asStr(fixed[sid]?.[lang]);
    if (!newText) continue;                       // LLM dropped this cell — keep original
    if (newText !== (j[`${lang}_text`] || '')) {
      j[`${lang}_text`] = newText;
      applied++;
    }
    if (isFormal(lang, newText)) stillFormal++;   // fix didn't clear the marker
  }
}
console.log(`Formality Lint: applied ${applied} fixes; ${stillFormal} cells still match a formal marker after fix`);

return items;
