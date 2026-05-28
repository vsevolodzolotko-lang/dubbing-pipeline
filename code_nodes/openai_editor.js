// OpenAI Editor — cross-model second-pass review on Sonnet's QA-corrected output.
// Same input/output schema as Verify Translations (drop-in compatible). Reads
// openai_api_key from config sheet. Calls GPT-5 with JSON response_format and
// retries with exponential backoff (4 attempts: 2s/4s/8s). On final failure,
// returns empty corrections → all items pass through with Verify-cleaned text.
//
// EDITOR_SYSTEM is sized ≥1024 tokens so OpenAI's automatic prompt cache activates
// on batches 2-4 (no explicit cache_control needed — OpenAI auto-detects shared
// system-prompt prefixes).
const QA_BATCH_SIZE = 8;
const ALL_LANGS = ['de', 'es', 'fr', 'pl', 'pt', 'it', 'tr'];

const configMap = {};
$('Read Config').all().forEach(i => { if (i.json.key) configMap[i.json.key] = i.json.value; });
const apiKey = configMap.openai_api_key || '';
if (!apiKey) throw new Error('openai_api_key missing from config sheet');

// active_langs gate — narrow editor pass to active langs only.
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
const EDITOR_SYSTEM = loadPrompt('editor_system');

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function callEditor(body) {
  const MAX_TRIES = 4;
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    try {
      const resp = await this.helpers.httpRequest({
        method: 'POST',
        url: 'https://api.openai.com/v1/chat/completions',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body, json: true,
      });
      return resp.choices?.[0]?.message?.content?.trim() || '';
    } catch (e) {
      if (attempt === MAX_TRIES - 1) { console.error('OpenAI Editor failed after retries:', e.message); return ''; }
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
async function runOneEditorBatch(batch) {
  const userMap = {};
  for (const it of batch) {
    const j = it.json;
    const entry = { en: j.en_text || '' };
    for (const lang of LANGS) entry[lang] = j[`${lang}_text`] || '';
    userMap[j.segment_id] = entry;
  }
  const body = {
    model: 'gpt-5',
    messages: [
      { role: 'system', content: EDITOR_SYSTEM },
      { role: 'user',   content: JSON.stringify(userMap, null, 2) },
    ],
    response_format: { type: 'json_object' },
  };
  const raw = await callEditor.call(this, body);
  try {
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch (e) { console.error('OpenAI Editor parse error:', e.message); }
  return {};
}
for (let i = 0; i < batches.length; i += CHUNK) {
  const slice = batches.slice(i, i + CHUNK);
  const partial = await Promise.all(slice.map(b => runOneEditorBatch.call(this, b)));
  for (const p of partial) Object.assign(corrections, p);
}

// Apply corrections: if GPT-5 returned a value for a lang, use it; else keep original.
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

