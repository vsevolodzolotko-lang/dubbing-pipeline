// Adaptation loop: shortens translations that exceed the EN timing budget.
// CPS-based estimation; up to 3 progressive Claude attempts per language.
//
// Input (from Extract Translations):
//   { segment_id, en_text, en_duration_sec, de_text, es_text, ..., tr_text }
// Also reads:
//   $('Read Config') — needs key 'anthropic_api_key'
//
// For each segment × language:
//   1. Estimate duration = chars / LANG_CPS[lang]
//   2. If estimated > en_duration_sec * 1.05 → call Claude to shorten (up to 3 attempts)
//   3. Each attempt is progressively more aggressive
//   4. Length floor: reject Claude output below 60% of input length (sanity)
//
// Output: same shape + {lang}_adaptation_attempts + adaptation_attempts (max across langs)
//
// Requires n8n ≥ 1.x (uses this.helpers.httpRequest)

const LANG_CPS     = { de: 13, es: 17, fr: 15, pl: 14, pt: 16, it: 16, tr: 14 };
const LANGS        = ['de', 'es', 'fr', 'pl', 'pt', 'it', 'tr'];
const BUDGET_FACTOR = 1.05;
const MAX_ATTEMPTS  = 3;
const MIN_RETAIN    = 0.60;   // never accept shortening below 60% of input length
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

const configItems = $('Read Config').all();
const configMap = {};
configItems.forEach(i => { if (i.json.key) configMap[i.json.key] = i.json.value; });
const apiKey = configMap['anthropic_api_key'] || '';
if (!apiKey) throw new Error('anthropic_api_key missing from config sheet');

const SYSTEM_PROMPT = `You are a localization editor for meditation/wellness audio. Your job is to shorten a translated text so it fits within a strict time budget for audio dubbing.

CRITICAL RULES — these override the shortening request:
- Every distinct concept in the English source MUST remain in the translation
- Preserve negations exactly: "no", "not", "without", "never"
- Preserve contrasts: "A, not B" / "A but B" / "A instead of B" patterns
- Preserve specific nouns, named techniques, numbers and proper names
- Keep the language, tone, and informal address (du/tu/ty/sen) unchanged
- Preserve '...' and '—' as pause timing cues
- Do NOT translate or switch languages — edit only the given translation
- Only remove genuinely redundant filler words (e.g., "really", "very", "just", "actually")
- Return ONLY the shortened text. No explanation, no quotes, no preamble.`;

const ATTEMPT_PROMPTS = [
  (lang, budget, est, en, trans, minChars) =>
    `Shorten this ${lang} translation slightly (~5-15%) to fit within ${budget}s (currently ~${est}s).
Remove only filler words and minor redundancies. Preserve sentence structure and all key concepts.
Minimum allowed length: ${minChars} characters.

Original English (preserve all concepts): ${en}
Current translation: ${trans}`,
  (lang, budget, est, en, trans, minChars) =>
    `Shorten this ${lang} translation more (~15-25%) to fit within ${budget}s (currently ~${est}s).
Rephrase for compactness, but every concept from the English source must remain.
Minimum allowed length: ${minChars} characters.

Original English (preserve all concepts): ${en}
Current translation: ${trans}`,
  (lang, budget, est, en, trans, minChars) =>
    `Shorten this ${lang} translation as much as possible to fit within ${budget}s (currently ~${est}s).
Preserve every distinct concept, negation, contrast, and proper noun from the English. Cut only filler and stylistic flourishes.
Minimum allowed length: ${minChars} characters.

Original English (preserve all concepts): ${en}
Current translation: ${trans}`,
];

function estimateDuration(text, lang) {
  return text.length / (LANG_CPS[lang] || 15);
}

async function callClaude(userContent) {
  const resp = await this.helpers.httpRequest({
    method: 'POST',
    url: ANTHROPIC_URL,
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: { model: 'claude-sonnet-4-5', max_tokens: 500, system: SYSTEM_PROMPT, messages: [{ role: 'user', content: userContent }] },
    json: true,
  });
  return resp.content?.[0]?.text?.trim() || '';
}

const results = [];
for (const item of $input.all()) {
  const { segment_id, en_text, en_duration_sec } = item.json;
  const budget = parseFloat(en_duration_sec) || 0;
  const out = { segment_id, en_text, en_duration_sec: budget };
  let maxAttempts = 0;

  for (const lang of LANGS) {
    let text = item.json[`${lang}_text`] || '';
    let attempts = 0;
    if (text && budget) {
      for (let a = 0; a < MAX_ATTEMPTS; a++) {
        const est = estimateDuration(text, lang);
        if (est <= budget * BUDGET_FACTOR) break;
        const minChars = Math.floor(text.length * MIN_RETAIN);
        const shortened = await callClaude.call(this, ATTEMPT_PROMPTS[a](lang, budget.toFixed(1), est.toFixed(1), en_text, text, minChars));
        // Length floor: reject Claude output below 60% of input length
        if (shortened && shortened.length >= minChars) {
          text = shortened;
        }
        attempts = a + 1;
      }
    }
    out[`${lang}_text`] = text;
    out[`${lang}_adaptation_attempts`] = attempts;
    if (attempts > maxAttempts) maxAttempts = attempts;
  }
  out.adaptation_attempts = maxAttempts;
  results.push({ json: out });
}
return results;
