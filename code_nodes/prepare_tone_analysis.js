// Batches tone analysis into chunks of TONE_BATCH so a long lesson (100+ segments)
// doesn't overflow a single Claude call or exceed max_tokens.
const TONE_BATCH = 40;
const lesson_id = $('Get Params').first().json.lesson_id;
let segments = $input.all()
  .filter(i => i.json.segment_id && i.json.en_text)
  .map(i => ({ segment_id: i.json.segment_id, en_text: i.json.en_text }));
if (lesson_id) segments = segments.filter(s => s.segment_id.startsWith(lesson_id + '_'));
if (segments.length === 0) throw new Error('No segments to analyze' + (lesson_id ? ' for lesson_id=' + lesson_id : ''));

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
const sysPrompt = loadPrompt('tone_analysis_system');

const batches = [];
for (let i = 0; i < segments.length; i += TONE_BATCH) {
  batches.push(segments.slice(i, i + TONE_BATCH));
}

return batches.map(batch => ({
  json: {
    model: 'claude-sonnet-4-5',
    max_tokens: 4000,
    system: sysPrompt,
    messages: [{ role: 'user', content: 'Segments:\n\n' + JSON.stringify(batch, null, 2) }],
  },
}));
