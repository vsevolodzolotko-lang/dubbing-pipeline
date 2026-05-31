// Parses batched Claude response → emits one item per segment.
// Each batch's Claude reply is a JSON object: { segment_id: { de, es, fr, pl, pt, it, tr }, ... }.
//
// R3.a: dropped segments (translator silently missed them).
// As of 2026-05-31: instead of immediately throwing, attempt auto-recovery by
// re-translating each dropped segment INDIVIDUALLY (one segment per Claude call,
// no prompt cache). Single-segment calls are effectively immune to silent-drop —
// Claude can't "forget" the only segment it was asked to translate. Only if
// individual retries also fail (genuine API error or refusal), then throw with
// the remaining unrecovered list. This makes W2 resilient to the silent-drop
// pattern that bit us when Sonnet 4.6 occasionally drops 1 entire batch per run.
//
// active_langs gate: when set, REQUIRED_LANGS narrows to that subset so partial
// translator output is not flagged as "dropped" for inactive langs, and emitted
// items only carry *_text for active langs (autoMapInputData on Update Sheet
// then leaves inactive lang columns untouched in the segments sheet).
const ALL_LANGS = ['de', 'es', 'fr', 'pl', 'pt', 'it', 'tr'];
const configMap = {};
$('Read Config').all().forEach(i => { if (i.json.key) configMap[i.json.key] = i.json.value; });
const activeRaw = (configMap.active_langs || '').trim();
const REQUIRED_LANGS = activeRaw
  ? activeRaw.split(',').map(s => s.trim().toLowerCase()).filter(l => ALL_LANGS.includes(l))
  : ALL_LANGS.slice();
if (REQUIRED_LANGS.length === 0) throw new Error('active_langs filter produced empty lang list — check config');
const langsRestricted = REQUIRED_LANGS.length < ALL_LANGS.length;

const ANT_KEY = configMap.anthropic_api_key || '';

// Load translate_system prompt (same as Prepare and Expand) so the recovery
// retry uses identical instructions. Without this, a retry would skip the
// tone-of-voice + JSON-shape contract → output schema would drift.
const promptMap = {};
$('Read Prompts').all().forEach(i => { if (i.json.key) promptMap[i.json.key] = i.json.value; });
function loadPrompt(key, vars = {}) {
  const raw = promptMap[key];
  if (!raw) throw new Error(`Missing prompt "${key}" in prompts sheet — add a row with this key`);
  return Object.entries(vars).reduce(
    (s, [k, v]) => s.replace(new RegExp(`\\{\\{\\s*${k}\\s*\\}\\}`, 'g'), String(v ?? '')),
    raw
  );
}

const preparedItems = $('Prepare and Expand').all();
const claudeItems = $input.all();
const results = [];
const dropped = [];
const partial = [];

function parseClaudeBody(claudeResp) {
  try {
    let text = claudeResp.content?.[0]?.text?.trim() || '{}';
    text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch (e) {
    console.error(`Extract Translations: parse error: ${e.message}`);
  }
  return {};
}

for (let i = 0; i < claudeItems.length; i++) {
  const batchTranslations = parseClaudeBody(claudeItems[i].json);
  const batchSegments = preparedItems[i]?.json?.batch_segments || [];
  const batchIdx = preparedItems[i]?.json?.batch_index ?? i;

  for (const seg of batchSegments) {
    const translations = batchTranslations[seg.segment_id] || {};
    const filled = REQUIRED_LANGS.filter(l => translations[l] && translations[l].trim());
    if (filled.length === 0) {
      console.error(`Extract Translations: ${seg.segment_id} — empty/missing in batch ${batchIdx}.`);
      dropped.push(seg);
      continue;
    }
    if (filled.length < REQUIRED_LANGS.length) {
      const missing = REQUIRED_LANGS.filter(l => !filled.includes(l));
      console.warn(`Extract Translations: ${seg.segment_id} missing langs: ${missing.join(',')}`);
      partial.push({ segment_id: seg.segment_id, missing });
    }
    const out = {
      segment_id:      seg.segment_id,
      en_text:         seg.en_text || '',
      en_duration_sec: seg.en_duration_sec || 0,
    };
    for (const lang of REQUIRED_LANGS) out[`${lang}_text`] = translations[lang] || '';
    results.push({ json: out });
  }
}

// Auto-recovery for dropped segments. Single-segment Claude calls bypass the
// silent-drop failure mode: Claude cannot "forget" the only segment it was
// asked to translate. No prompt cache (fresh call per segment) avoids any
// cache-induced determinism the batch path may have hit.
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function retryOneSegment(seg) {
  const systemPrompt = loadPrompt('translate_system', { tov: loadPrompt('tone_of_voice') });
  const userMap = { [seg.segment_id]: { text: (seg.en_text || '').replace(/"/g, "'") } };
  const userJson = JSON.stringify(userMap, null, 2);
  const userContent = langsRestricted
    ? `IMPORTANT: For this batch, output translations ONLY for these language codes: ${REQUIRED_LANGS.join(', ')}. Omit all other languages from your JSON output.\n\n${userJson}`
    : userJson;

  const body = {
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
    system: [{ type: 'text', text: systemPrompt }],
    messages: [{ role: 'user', content: userContent }],
  };

  const MAX_TRIES = 3;
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    try {
      const resp = await this.helpers.httpRequest({
        method: 'POST',
        url: 'https://api.anthropic.com/v1/messages',
        headers: { 'x-api-key': ANT_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body, json: true,
      });
      const parsed = parseClaudeBody(resp);
      const translations = parsed[seg.segment_id] || {};
      const filled = REQUIRED_LANGS.filter(l => translations[l] && translations[l].trim());
      if (filled.length > 0) return translations;
      console.warn(`Recovery for ${seg.segment_id} attempt ${attempt + 1}: still empty/missing`);
    } catch (e) {
      console.error(`Recovery for ${seg.segment_id} attempt ${attempt + 1} threw: ${e.message}`);
    }
    if (attempt < MAX_TRIES - 1) await sleep(2000 * Math.pow(2, attempt));
  }
  return null;
}

const stillDropped = [];
if (dropped.length > 0) {
  if (!ANT_KEY) throw new Error(`Extract Translations: ${dropped.length} segments dropped and anthropic_api_key missing from config — cannot auto-recover`);
  console.log(`Extract Translations: ${dropped.length} dropped, attempting per-segment recovery`);
  for (const seg of dropped) {
    const translations = await retryOneSegment.call(this, seg);
    if (translations) {
      const out = {
        segment_id:      seg.segment_id,
        en_text:         seg.en_text || '',
        en_duration_sec: seg.en_duration_sec || 0,
      };
      for (const lang of REQUIRED_LANGS) out[`${lang}_text`] = translations[lang] || '';
      results.push({ json: out });
      console.log(`Recovered ${seg.segment_id}`);
    } else {
      stillDropped.push(seg.segment_id);
    }
  }
}

if (stillDropped.length > 0) {
  const partialNote = partial.length ? ` Partial: ${partial.map(p => p.segment_id + '(' + p.missing.join(',') + ')').join('; ')}.` : '';
  throw new Error(`Translator dropped ${stillDropped.length} segment(s) and auto-recovery failed: ${stillDropped.join(', ')}. Re-run W2 to recover.${partialNote}`);
}
return results;
