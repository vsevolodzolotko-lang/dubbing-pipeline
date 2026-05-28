const LANG_CPS = { de: 12, es: 15, fr: 15, pl: 14, pt: 16, it: 14, tr: 14 };
const LANGS = ['de', 'es', 'fr', 'pl', 'pt', 'it', 'tr'];
const BUDGET_FACTOR = 1.05;
const MAX_ATTEMPTS = 3;
const MIN_RETAIN = 0.60;  // never accept shortening below 60% of input
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

const configItems = $('Read Config').all();
const configMap = {};
configItems.forEach(i => { if (i.json.key) configMap[i.json.key] = i.json.value; });
const apiKey = configMap['anthropic_api_key'] || '';
if (!apiKey) throw new Error('anthropic_api_key missing from config sheet');

// Per-language CPS — defaults tuned against real ElevenLabs output; overridable via
// config keys cps_estimate_de, cps_estimate_es, …, cps_estimate_tr. Computed below.
const CPS_DEFAULTS = { de: 12, es: 15, fr: 15, pl: 14, pt: 16, it: 14, tr: 14 };

// Externalized-prompts loader. Reads from the "prompts" Google Sheets tab via
// upstream Read Prompts node. Throws if a required key is missing (fail-fast).
// Placeholders use {{var}} syntax; vars object replaces them at load time.
const promptMap = {};
$('Read Prompts').all().forEach(i => { if (i.json.key) promptMap[i.json.key] = i.json.value; });
function loadPrompt(key, vars = {}) {
  const raw = promptMap[key];
  if (!raw) throw new Error(`Missing prompt "${key}" in prompts sheet — add a row with this key`);
  const result = Object.entries(vars).reduce(
    (s, [k, v]) => s.replace(new RegExp(`\\{\\{\\s*${k}\\s*\\}\\}`, 'g'), String(v ?? '')),
    raw
  );
  const leaks = result.match(/\{\{\s*[a-z][a-z0-9_]*\s*\}\}/g);
  if (leaks) throw new Error(`Unsubstituted placeholders in prompt "${key}": ${leaks.join(', ')}`);
  return result;
}
const SYSTEM_PROMPT = loadPrompt('adapt_shorten_system');

// R6.a: unified template + 3 attempt-level aggression descriptors.
// AGGRESSION[i] passed as {{aggression}} placeholder; i = attempt level (0..2).
const AGGRESSION = [
  'Aim for ~5-15% reduction. Remove only filler words and minor redundancies. Preserve sentence structure and all key concepts.',
  'Aim for ~15-25% reduction. Rephrase for compactness, but every concept from the English source must remain.',
  'Reduce as much as possible. Preserve every distinct concept, negation, contrast, and proper noun from the English. Cut only filler and stylistic flourishes.',
];
const ATTEMPT_PROMPTS = AGGRESSION.map(aggression =>
  (lang, budget, est, en, trans, minChars) =>
    loadPrompt('adapt_attempt_template', { lang, budget, est, en, trans, min_chars: minChars, aggression })
);


// Strip Claude meta-commentary.
// Meditation translations are always single-line, so cut at the FIRST newline —
// anything after is meta-commentary like "(Already at N characters; cannot shorten further)"
// which Claude (esp. Sonnet) sometimes appends on a single newline (not \n\n).
function sanitizeClaudeOutput(rawText) {
  if (!rawText) return '';
  let t = rawText.trim();
  const nlIdx = t.indexOf('\n');
  if (nlIdx >= 0) t = t.substring(0, nlIdx).trim();
  t = t.replace(/^[\*_]+|[\*_]+$/g, '').trim();
  t = t.replace(/^["'`]+|["'`]+$/g, '').trim();
  // Strip trailing parenthesized meta even on same line ("text (12 chars)")
  t = t.replace(/\s*\([^)]*(character|char|cannot|already|maximally|minimal)[^)]*\)\s*$/i, '').trim();
  return t;
}

function estimateDuration(text, lang) {
  return text.length / (LANG_CPS[lang] || 15);
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function callClaude(userContent) {
  const MAX_TRIES = 4;
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    try {
      const resp = await this.helpers.httpRequest({
        method: 'POST',
        url: ANTHROPIC_URL,
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: { model: 'claude-sonnet-4-6', max_tokens: 500, system: SYSTEM_PROMPT, messages: [{ role: 'user', content: userContent }] },
        json: true,
      });
      return sanitizeClaudeOutput(resp.content?.[0]?.text || '');
    } catch (e) {
      const isLast = attempt === MAX_TRIES - 1;
      if (isLast) { console.error('Adapt callClaude failed after retries:', e.message); return ''; }
      // Exponential backoff: 2s, 4s, 8s.
      await sleep(2000 * Math.pow(2, attempt));
    }
  }
  return '';
}

// Concurrency cap for the whole node, across ALL (segment × lang) cells — not
// per-segment. The old code parallelized the 7 langs WITHIN a segment but ran
// segments sequentially, so an N-segment lesson serialized into N waves and a
// long lesson (~90 segments) blew past n8n's 300s task-runner timeout. We now
// flatten every cell that needs shortening into one task list and run it with a
// single global bound, so wall-clock scales with total over-budget cells / CONC
// rather than with segment count. Overridable via config key w2_adapt_concurrency.
const ADAPT_CONCURRENCY = parseFloat(configMap['w2_adapt_concurrency']) || 8;

// Prefill one output object per segment, preserving the exact output shape that
// Formality Lint + Update Sheet expect: each {lang}_text starts as the original
// translation, {lang}_adaptation_attempts = 0. Tasks below overwrite only the
// cells they touch, so segments/langs that fit budget pass through unchanged.
const items = $input.all();
const outputs = items.map((item) => {
  const { segment_id, en_text, en_duration_sec } = item.json;
  const budget = parseFloat(en_duration_sec) || 0;
  const out = { segment_id, en_text, en_duration_sec: budget, adaptation_attempts: 0 };
  for (const lang of LANGS) {
    out[`${lang}_text`] = item.json[`${lang}_text`] || '';
    out[`${lang}_adaptation_attempts`] = 0;
  }
  return out;
});

// Flatten to a task list of (segIdx, lang) pairs that actually need work:
// non-empty translation AND a positive duration budget. Cells that fit on the
// first estimate make 0 Claude calls (the loop breaks immediately) but are still
// cheap to include; we keep them out to avoid useless task overhead.
const tasks = [];
items.forEach((item, segIdx) => {
  const budget = parseFloat(item.json.en_duration_sec) || 0;
  if (!budget) return;
  for (const lang of LANGS) {
    const text = item.json[`${lang}_text`] || '';
    if (!text) continue;
    if (estimateDuration(text, lang) <= budget * BUDGET_FACTOR) continue; // already fits
    tasks.push({ segIdx, lang, en_text: item.json.en_text, budget });
  }
});

async function runTask(task) {
  const { segIdx, lang, en_text, budget } = task;
  let text = outputs[segIdx][`${lang}_text`];
  let attempts = 0;
  for (let a = 0; a < MAX_ATTEMPTS; a++) {
    const est = estimateDuration(text, lang);
    if (est <= budget * BUDGET_FACTOR) break;
    const minChars = Math.floor(text.length * MIN_RETAIN);
    const shortened = await callClaude.call(this, ATTEMPT_PROMPTS[a](lang, budget.toFixed(1), est.toFixed(1), en_text, text, minChars));
    // Length floor: reject Claude output that went below 60% of input length
    if (shortened && shortened.length >= minChars) {
      text = shortened;
    }
    attempts = a + 1;
  }
  outputs[segIdx][`${lang}_text`] = text;
  outputs[segIdx][`${lang}_adaptation_attempts`] = attempts;
}

// Bounded-concurrency drain via chunked Promise.all — same idiom as Verify/Editor.
for (let i = 0; i < tasks.length; i += ADAPT_CONCURRENCY) {
  await Promise.all(tasks.slice(i, i + ADAPT_CONCURRENCY).map(t => runTask.call(this, t)));
}

// Recompute the per-segment rollup (max attempts across its langs) after the pool.
for (const out of outputs) {
  let maxAttempts = 0;
  for (const lang of LANGS) {
    if (out[`${lang}_adaptation_attempts`] > maxAttempts) maxAttempts = out[`${lang}_adaptation_attempts`];
  }
  out.adaptation_attempts = maxAttempts;
}

return outputs.map(json => ({ json }));
