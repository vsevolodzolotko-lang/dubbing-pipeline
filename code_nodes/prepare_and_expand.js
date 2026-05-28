// Batched translation: groups segments into batches of BATCH_SIZE and emits one Claude request per batch.
// This dramatically reduces Anthropic API request count (31 → 4 for a typical lesson) and stays under
// the default tier's output-tokens-per-minute ceiling (8K), which 1-segment-per-call hits at ~14 segments.
const lesson_id = $('Get Params').first().json.lesson_id;
const configItems = $('Read Config').all();
const configMap = {};
configItems.forEach(i => { if (i.json.key) configMap[i.json.key] = i.json.value; });
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
const TOV = loadPrompt('tone_of_voice');

// active_langs gate — when set in config (e.g. "de" or "de,fr"), restricts W2
// to those langs only. Saves output tokens on Translate + skips Verify/Editor/
// Adapt work on the dropped langs. Empty/missing → all 7 (default behavior).
const ALL_LANGS = ['de', 'es', 'fr', 'pl', 'pt', 'it', 'tr'];
const activeRaw = (configMap.active_langs || '').trim();
const ACTIVE_LANGS = activeRaw
  ? activeRaw.split(',').map(s => s.trim().toLowerCase()).filter(l => ALL_LANGS.includes(l))
  : ALL_LANGS.slice();
const langsRestricted = ACTIVE_LANGS.length > 0 && ACTIVE_LANGS.length < ALL_LANGS.length;

const toneItems = $('Parse Tone Map').all();
const toneMap = {};
toneItems.forEach(i => { if (i.json.segment_id) toneMap[i.json.segment_id] = i.json; });

const BATCH_SIZE = 8;

const segments = $('Read Pending Segments').all()
  .filter(i => i.json.segment_id && i.json.en_text)
  .filter(i => !lesson_id || i.json.segment_id.startsWith(lesson_id + '_'));

const systemBlocks = [
  { type: 'text', text: loadPrompt('translate_system', { tov: TOV }), cache_control: { type: 'ephemeral' } },
];

const batches = [];
for (let i = 0; i < segments.length; i += BATCH_SIZE) {
  batches.push(segments.slice(i, i + BATCH_SIZE));
}

return batches.map((batch, bIdx) => {
  const userMap = {};
  const batchInfo = [];
  for (const s of batch) {
    const sid = s.json.segment_id;
    const enText = (s.json.en_text || '').replace(/"/g, "'");
    const tone = toneMap[sid] || {};
    userMap[sid] = { text: enText };
    if (tone.segment_type) userMap[sid].type = tone.segment_type;
    if (tone.key_concepts) userMap[sid].key_concepts = tone.key_concepts;
    batchInfo.push({ segment_id: sid, en_text: s.json.en_text, en_duration_sec: s.json.en_duration_sec });
  }
  // When active_langs is restricted, prepend an explicit instruction so Claude
  // emits only the requested lang keys instead of all 7 (cuts output tokens
  // ~85% on single-lang dry-runs). System prompt still permits the full set;
  // user-level override is sufficient and avoids touching the prompts sheet.
  const userJson = JSON.stringify(userMap, null, 2);
  const userContent = langsRestricted
    ? `IMPORTANT: For this batch, output translations ONLY for these language codes: ${ACTIVE_LANGS.join(', ')}. Omit all other languages from your JSON output.\n\n${userJson}`
    : userJson;
  return {
    json: {
      batch_index: bIdx,
      batch_size: batch.length,
      batch_segments: batchInfo,
      active_langs: ACTIVE_LANGS,
      claude_body: {
        model: 'claude-sonnet-4-6',
        max_tokens: 8000,
        system: systemBlocks,
        messages: [{ role: 'user', content: userContent }],
      },
    },
  };
});
