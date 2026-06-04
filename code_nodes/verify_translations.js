// Verify Translations — QA pass on Sonnet's initial output.
// Batches segments (8 at a time), sends to Claude with anti-pattern rules.
// Applies corrections when Claude returns a different value; pass-through otherwise.
// QA_SYSTEM is sized ≥1024 tokens so cache_control: ephemeral activates on Sonnet 4.5.
const QA_BATCH_SIZE = 8;
const ALL_LANGS = ['de', 'es', 'fr', 'pl', 'pt', 'it', 'tr'];

const configMap = {};
$('Read Config').all().forEach(i => { if (i.json.key) configMap[i.json.key] = i.json.value; });
const apiKey = configMap.anthropic_api_key || '';
if (!apiKey) throw new Error('anthropic_api_key missing from config sheet');

// active_langs gate — narrow QA pass to active langs only. Inactive lang fields
// are not present in input items (extract_translations already filtered them).
const activeRaw = (configMap.active_langs || '').trim();
const LANGS = activeRaw
  ? activeRaw.split(',').map(s => s.trim().toLowerCase()).filter(l => ALL_LANGS.includes(l))
  : ALL_LANGS.slice();
if (LANGS.length === 0) throw new Error('active_langs filter produced empty lang list — check config');

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
const QA_SYSTEM = loadPrompt('qa_verify_system');

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function callQA(body) {
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
      if (attempt === MAX_TRIES - 1) { console.error('Verify Translations QA failed after retries:', e.message); return ''; }
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
// on big lessons while keeping concurrency within Anthropic Tier 1 rate limits.
// Cap=3: existing exponential backoff in callQA absorbs any 429s gracefully.
const CHUNK = parseFloat(configMap.w2_llm_chunk) || 6;
const corrections = {};
async function runOneVerifyBatch(batch) {
  const userMap = {};
  for (const it of batch) {
    const j = it.json;
    const entry = { en: j.en_text || '' };
    for (const lang of LANGS) entry[lang] = j[`${lang}_text`] || '';
    userMap[j.segment_id] = entry;
  }
  const body = {
    model: 'claude-sonnet-4-6',
    max_tokens: 8000,
    system: [{ type: 'text', text: QA_SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: JSON.stringify(userMap, null, 2) }],
  };
  const raw = await callQA.call(this, body);
  try {
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch (e) { console.error('Verify Translations parse error:', e.message); }
  return {};
}
for (let i = 0; i < batches.length; i += CHUNK) {
  const slice = batches.slice(i, i + CHUNK);
  const partial = await Promise.all(slice.map(b => runOneVerifyBatch.call(this, b)));
  for (const p of partial) Object.assign(corrections, p);
}

// Apply corrections: if QA returned a value for a lang, use it; else keep original.
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
