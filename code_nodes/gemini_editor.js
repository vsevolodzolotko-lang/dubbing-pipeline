// Gemini Editor — cross-model second-pass review on Sonnet's QA-corrected output.
// Same input/output schema as Verify Translations (drop-in compatible). Reads
// gemini_api_key from config sheet. Calls Gemini 3.5 Flash via OpenAI-compatible endpoint with
// retries with exponential backoff (4 attempts: 2s/4s/8s). On final failure,
// returns empty corrections → all items pass through with Verify-cleaned text.
//
// EDITOR_SYSTEM is sized ≥1024 tokens so Gemini's prompt cache (when prefix ≥ threshold) activates
// on batches 2-4 (no explicit cache_control needed — Google handles shared
// system-prompt prefixes).
const QA_BATCH_SIZE = 8;
const LANGS = ['de', 'es', 'fr', 'pl', 'pt', 'it', 'tr'];

const configMap = {};
$('Read Config').all().forEach(i => { if (i.json.key) configMap[i.json.key] = i.json.value; });
const apiKey = configMap.gemini_api_key || '';
if (!apiKey) throw new Error('gemini_api_key missing from config sheet');

const EDITOR_SYSTEM = `You are a SECOND-PASS EDITOR for meditation/wellness translations. A primary QA model (Claude Sonnet 4.5) has already reviewed these translations once for false-friend mistranslations, formality drift, and tone-of-voice violations. Your job is to catch what the first pass missed — NOT to re-edit clean translations for style.

INPUT: a JSON object mapping segment_id → { en, de, es, fr, pl, pt, it, tr }. Each segment has the English source plus 7 translations.

=== PRIMARY RULE (HIGHEST PRIORITY) ===
If a translation has NO false friend, NO formality drift, NO ToV violation, and NO typo — RETURN IT UNCHANGED. Do not modify wording, rhythm, or word choice just because you would phrase it differently. Style is a matter of taste; only intervene on objective issues you can name.

=== CLASS 1: LITERAL-DICTIONARY MISTRANSLATIONS (false friends) ===
Replace if found:
- DE: "gültig" for "valid" (means "valid ticket/document"). Use "Ich bin wertvoll." or "Ich bin richtig, so wie ich bin."
- FR: "suffisant" for "enough" when about a person (means "arrogant, conceited"). Use "Je suis assez." or "Je me suffis."
- FR: "valide" for "valid" when about a person (means "able-bodied"). Use "Je suis légitime." or "J'ai ma place."
- TR: "geçerli/geçerliyim" for "valid" (means "valid as a rule/password"). Use "Değerliyim." or "Ben yeterliyim."
- PL: bare "Jestem dość." for "I am enough" (ungrammatical). Use "Jestem wystarczający." or "Jestem dość dobry."
- ES: "válido" for "valid" about a person reads clinical/legal. Prefer warmer "Yo valgo." or "Tengo valor."
- PT: "válido" for "valid" about a person reads clinical/legal. Prefer "Eu tenho valor." or "Eu importo."
- IT: "valido" for "valid" about a person reads clinical. Prefer "Ho valore." or "Sono prezioso."
- ES/PT/IT: "suficiente"/"sufficiente" applied to a person is grammatical but reads flat for affirmations. When slot allows, prefer self-acceptance phrasing.
- ANY obvious typos: double letters where they shouldn't be, missing or wrong diacritics on common words.

=== CLASS 2: FORMALITY DRIFT (must stay informal singular) ===
All translations MUST use informal singular address. Replace any formal-creep:
- DE: must use "du/dich/dein", NEVER "Sie/Ihnen/Ihr" or capitalized formal forms.
- ES: must be Castilian "tú/te/tu", NEVER "usted/le/su"; NEVER Latin American "vos/ustedes".
- FR: must use "tu/te/ton/ta/tes", NEVER "vous/votre/vos".
- IT: must use "tu/ti/tuo/tua/tuoi/tue", NEVER capitalized formal "Lei/La/Suo/Le".
- PL: must use direct "ty"-form verbs (e.g., "jesteś", "czujesz"), NEVER "Pan/Pani/Państwo" or third-person formality.
- PT: must be European Portuguese "tu/te/teu/tua" with EU conjugation ("tu fazes", "tu sentes"), NEVER Brazilian "você/seu/sua" or BR verb forms ("você faz", "você sente").
- TR: must use "sen/seni/senin", NEVER "siz/sizi/sizin" or capitalized formal forms.

=== CLASS 3: TONE-OF-VOICE VIOLATIONS ===
Spirio's voice is the warm, knowing friend — not a guru, coach, or marketer. Replace or soften:
- Marketing/transformation vocab: "transformación/transformation/Transformation", "alpha", "vibration/vibración", "manifest/manifester/manifestar", "energy field" — strip or rephrase to plain sensation.
- Promise/guarantee tone: "you will feel amazing" → soften to "you might notice" / "puedes notar" / "tu peux remarquer" / "vielleicht spürst du" / etc.
- Bare imperative filler: "Just relax", "Be present", "Calm down" without sensation grounding — replace with sensation-grounded language ("let your shoulders drop", "notice the weight of your hands").
- Clinical/medical register: "diagnóstico", "intervención terapéutica", over-formal Latinisms in ES/PT/IT — soften to everyday vocabulary.
- Word-for-word anglicism: a translation that copies English syntax verbatim and reads stilted in the target language. Rephrase to native rhythm without losing meaning.
- Urgency words: "immediately", "ya mismo", "tout de suite", "sofort" — these break meditative pacing.

=== HARD CONSTRAINTS (do not violate even when correcting) ===
- LENGTH: keep corrections within ±25% of original character count (TTS timing budget).
- NEGATIONS: preserve "no"/"not"/"never"/"without" exactly as in source.
- CONTRASTS: preserve "A, not B" / "A but B" / "A instead of B" patterns exactly.
- NUMBERS, PROPER NOUNS, NAMED TECHNIQUES: never alter.
- PAUSE MARKERS: preserve "..." and "—" exactly.
- DEFAULT BEHAVIOR: return translations UNCHANGED. Only intervene when you can name a specific Class 1/2/3 violation. When in doubt, leave it alone.

=== OUTPUT FORMAT ===
JSON object mapping segment_id → { de, es, fr, pl, pt, it, tr } with same 7 langs. No "en" in output. No commentary. Only the JSON.`;

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function callGemini(body) {
  const MAX_TRIES = 4;
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    try {
      const resp = await this.helpers.httpRequest({
        method: 'POST',
        url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body, json: true,
      });
      return resp.choices?.[0]?.message?.content?.trim() || '';
    } catch (e) {
      if (attempt === MAX_TRIES - 1) { console.error('Gemini Editor failed after retries:', e.message); return ''; }
      // Exponential backoff: 2s, 4s, 8s.
      await sleep(2000 * Math.pow(2, attempt));
    }
  }
  return '';
}

const items = $input.all();
const batches = [];
for (let i = 0; i < items.length; i += QA_BATCH_SIZE) batches.push(items.slice(i, i + QA_BATCH_SIZE));

// Bounded-concurrent batch processing: process CHUNK batches in parallel via
// Promise.all, sequential between chunks. Avoids n8n's 300s task-runner timeout
// on big lessons (GPT-5 is ~30s/batch, 7 batches sequential = 210s).
// Cap=3 respects OpenAI Tier 1 (~30K TPM on GPT-5).
const CHUNK = 3;
const corrections = {};
async function runOneGeminiBatch(batch) {
  const userMap = {};
  for (const it of batch) {
    const j = it.json;
    userMap[j.segment_id] = {
      en: j.en_text || '',
      de: j.de_text || '', es: j.es_text || '', fr: j.fr_text || '',
      pl: j.pl_text || '', pt: j.pt_text || '', it: j.it_text || '', tr: j.tr_text || '',
    };
  }
  const body = {
    model: 'gemini-3.5-flash',
    messages: [
      { role: 'system', content: EDITOR_SYSTEM },
      { role: 'user',   content: JSON.stringify(userMap, null, 2) },
    ],
    response_format: { type: 'json_object' },
  };
  const raw = await callGemini.call(this, body);
  try {
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch (e) { console.error('Gemini Editor parse error:', e.message); }
  return {};
}
for (let i = 0; i < batches.length; i += CHUNK) {
  const slice = batches.slice(i, i + CHUNK);
  const partial = await Promise.all(slice.map(b => runOneGeminiBatch.call(this, b)));
  for (const p of partial) Object.assign(corrections, p);
}

// Apply corrections: if Gemini returned a value for a lang, use it; else keep original.
return items.map(it => {
  const sid = it.json.segment_id;
  const corr = corrections[sid] || {};
  const out = { ...it.json };
  for (const lang of LANGS) {
    const key = `${lang}_text`;
    if (corr[lang] && corr[lang].trim()) out[key] = corr[lang].trim();
  }
  return { json: out };
});
