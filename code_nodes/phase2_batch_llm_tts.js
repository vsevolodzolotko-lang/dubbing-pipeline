// W3 Phase 2: Batched late-stage expansion through Verify + Editor.
// Reads all localizations rows from Read Localizations Fresh, identifies cells with
// real_duration < en_duration × threshold (and needs_attention=false), runs a batch
// Expansion (Anthropic Sonnet) → Verify (Sonnet QA) → Editor (Gemini Flash) → re-TTS
// pipeline. For each accepted expansion, builds a new WAV (same lead silence + new TTS +
// recomputed tail silence) and emits an item with new binary + updated metadata for
// downstream Drive Update (overwrites file at same audio_drive_file_id) and Update
// Localizations Sheet nodes. Items where expansion was rejected or not needed are NOT
// emitted (this branch terminates side-effect only; Download Segment WAV continues
// reading the original Read Localizations Fresh items in parallel branch).

const SAMPLE_RATE = 22050;
const BPS = 2;
const EXPAND_BATCH_SIZE = 8;
const CHUNK = 6;                 // Tier 2 Anthropic — higher parallelism than W2's CHUNK=3
const ELEVENLABS_CHUNK = 5;      // parallel TTS calls per slice
const MAX_RETAIN_EXPANSION = 1.5;
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
const EXPAND_BATCH_SYSTEM = loadPrompt('w3_expand_batch_system', { tov: TOV });
const QA_SYSTEM = loadPrompt('qa_verify_system');
const EDITOR_SYSTEM = loadPrompt('editor_system');

const CPS_DEFAULTS = { de: 12, es: 15, fr: 15, pl: 14, pt: 16, it: 14, tr: 14 };
const LANG_CPS = {};
for (const l of ['de','es','fr','pl','pt','it','tr']) {
  LANG_CPS[l] = parseFloat(configMap['cps_estimate_' + l]) || CPS_DEFAULTS[l];
}

// --- collect candidates ---
const allItems = $input.all();
const candidates = {};  // { segment_id: { en, langs: { [lang]: { current, real, en_dur, lead, file_id, row_key, lesson_id, voice_id, voice_speed, ... } } } }
for (const it of allItems) {
  const j = it.json;
  // Skip needs_attention rows (Phase 1 already flagged for manual review)
  if (j.needs_attention === true || j.needs_attention === 'TRUE' || j.needs_attention === 'true') continue;
  const enDur = parseFloat(j.en_duration_sec) || 0;
  const real = parseFloat(j.real_duration_sec) || 0;
  if (enDur <= 0 || real <= 0) continue;
  if (real >= enDur * THRESHOLD) continue;

  const lang = j.lang;
  const voice = voiceMap[lang];
  if (!voice || !voice.voice_id) continue;

  if (!candidates[j.segment_id]) {
    candidates[j.segment_id] = { en: j.en_text || '', langs: {} };
  }
  candidates[j.segment_id].langs[lang] = {
    current: j.text_translated || '',
    real_duration: real,
    en_duration: enDur,
    lead_silence: parseFloat(j.lead_silence_sec) || 0,
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
  };
}

const totalSegments = Object.keys(candidates).length;
let totalCells = 0;
for (const data of Object.values(candidates)) totalCells += Object.keys(data.langs).length;

if (totalSegments === 0) {
  console.log('Phase 2: no expansion candidates — branch terminates with 0 items');
  return [];
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

// --- group into batches of EXPAND_BATCH_SIZE segments ---
const segmentEntries = Object.entries(candidates);
const expandBatches = [];
for (let i = 0; i < segmentEntries.length; i += EXPAND_BATCH_SIZE) {
  expandBatches.push(segmentEntries.slice(i, i + EXPAND_BATCH_SIZE));
}
console.log(`Phase 2: ${expandBatches.length} batches of up to ${EXPAND_BATCH_SIZE} segments each`);

// --- Phase 2.1: BATCH EXPAND ---
async function runOneExpandBatch(batch) {
  const userMap = {};
  for (const [sid, data] of batch) {
    userMap[sid] = { en: data.en };
    for (const [lang, info] of Object.entries(data.langs)) {
      const targetChars = Math.round(info.en_duration * (LANG_CPS[lang] || 15) * 0.95);
      userMap[sid][lang] = { current: info.current, target_chars: targetChars };
    }
  }
  const body = {
    model: 'claude-sonnet-4-5',
    max_tokens: 8000,
    system: [{ type: 'text', text: EXPAND_BATCH_SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: JSON.stringify(userMap, null, 2) }],
  };
  const raw = await callAnthropic.call(this, body);
  return parseLLMJson(raw);
}

const expandedMap = {};
for (let i = 0; i < expandBatches.length; i += CHUNK) {
  const slice = expandBatches.slice(i, i + CHUNK);
  const partial = await Promise.all(slice.map(b => runOneExpandBatch.call(this, b)));
  for (const p of partial) Object.assign(expandedMap, p);
}
console.log(`Phase 2 expand complete — ${Object.keys(expandedMap).length} segments returned`);

// --- Phase 2.2: BATCH VERIFY (using expanded text) ---
async function runOneVerifyBatch(batch) {
  const userMap = {};
  for (const [sid, data] of batch) {
    if (!expandedMap[sid]) continue;
    userMap[sid] = { en: data.en };
    for (const lang of Object.keys(data.langs)) {
      const expanded = expandedMap[sid][lang];
      if (expanded && expanded.trim()) userMap[sid][lang] = expanded.trim();
    }
  }
  if (Object.keys(userMap).length === 0) return {};
  const body = {
    model: 'claude-sonnet-4-5',
    max_tokens: 8000,
    system: [{ type: 'text', text: QA_SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: JSON.stringify(userMap, null, 2) }],
  };
  const raw = await callAnthropic.call(this, body);
  return parseLLMJson(raw);
}

const verifiedMap = {};
for (let i = 0; i < expandBatches.length; i += CHUNK) {
  const slice = expandBatches.slice(i, i + CHUNK);
  const partial = await Promise.all(slice.map(b => runOneVerifyBatch.call(this, b)));
  for (const p of partial) Object.assign(verifiedMap, p);
}

// Apply verify corrections: if verify returned text for (sid, lang), use it; else keep expanded
const postVerifyMap = {};
for (const [sid, data] of segmentEntries) {
  const expanded = expandedMap[sid];
  if (!expanded) continue;
  postVerifyMap[sid] = {};
  for (const lang of Object.keys(data.langs)) {
    const expText = expanded[lang];
    if (!expText || !expText.trim()) continue;
    const verText = verifiedMap[sid]?.[lang];
    postVerifyMap[sid][lang] = (verText && verText.trim()) ? verText.trim() : expText.trim();
  }
}
console.log(`Phase 2 verify complete`);

// --- Phase 2.3: BATCH EDITOR ---
async function runOneEditorBatch(batch) {
  const userMap = {};
  for (const [sid, data] of batch) {
    if (!postVerifyMap[sid]) continue;
    userMap[sid] = { en: data.en };
    for (const lang of Object.keys(data.langs)) {
      const text = postVerifyMap[sid][lang];
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

const editedMap = {};
for (let i = 0; i < expandBatches.length; i += CHUNK) {
  const slice = expandBatches.slice(i, i + CHUNK);
  const partial = await Promise.all(slice.map(b => runOneEditorBatch.call(this, b)));
  for (const p of partial) Object.assign(editedMap, p);
}

// Final text per (sid, lang) — prefer editor > verify > expanded
const finalTextMap = {};
for (const [sid, data] of segmentEntries) {
  if (!postVerifyMap[sid]) continue;
  finalTextMap[sid] = {};
  for (const lang of Object.keys(data.langs)) {
    const postVerify = postVerifyMap[sid][lang];
    if (!postVerify) continue;
    const edited = editedMap[sid]?.[lang];
    finalTextMap[sid][lang] = (edited && edited.trim()) ? edited.trim() : postVerify;
  }
}
console.log(`Phase 2 editor complete`);

// --- Phase 2.4: RE-TTS + WAV rebuild ---
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
  const { sid, lang, newText, info } = task;
  if (!newText || newText.trim() === info.current.trim()) {
    return { sid, lang, skipped: 'no_change' };
  }
  try {
    const ttsResp = await this.helpers.httpRequest({
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
          speed: info.voice_speed,
        },
      },
      encoding: 'arraybuffer',
      returnFullResponse: false,
    });
    const newPcm = Buffer.from(ttsResp);
    if (!newPcm || newPcm.length < 4410) {
      return { sid, lang, skipped: 'tts_too_short_or_empty', pcmLen: newPcm?.length || 0 };
    }
    const newRealDur = newPcm.length / (SAMPLE_RATE * BPS);

    // Overshoot guard: if new audio exceeds en_duration, abort — keep Phase 1 audio
    if (newRealDur > info.en_duration) {
      return { sid, lang, skipped: 'overshoot', newRealDur, enDuration: info.en_duration };
    }

    // Recompute padding: lead stays same (naturalLead invariant), tail shrinks
    const lead = info.lead_silence;
    let tail = info.en_duration - lead - newRealDur;
    if (tail < 0) {
      return { sid, lang, skipped: 'negative_tail', lead, newRealDur, enDur: info.en_duration };
    }
    const leadBytes = Math.round(lead * SAMPLE_RATE) * BPS;
    const tailBytes = Math.round(tail * SAMPLE_RATE) * BPS;
    const fullPcm = Buffer.concat([
      leadBytes > 0 ? Buffer.alloc(leadBytes, 0) : Buffer.alloc(0),
      newPcm,
      tailBytes > 0 ? Buffer.alloc(tailBytes, 0) : Buffer.alloc(0),
    ]);
    const newWav = buildWav(fullPcm);
    const finalDur = lead + newRealDur + tail;

    return {
      sid, lang, success: true,
      newText,
      newRealDur: parseFloat(newRealDur.toFixed(3)),
      newTailSilence: parseFloat(tail.toFixed(3)),
      newLeadSilence: parseFloat(lead.toFixed(3)),
      newFinalDur: parseFloat(finalDur.toFixed(3)),
      wavBase64: newWav.toString('base64'),
      info,
    };
  } catch (e) {
    return { sid, lang, error: e.message };
  }
}

// Build re-TTS task list (only cells where text actually changed)
const reTtsTasks = [];
for (const [sid, data] of segmentEntries) {
  if (!finalTextMap[sid]) continue;
  for (const [lang, info] of Object.entries(data.langs)) {
    const newText = finalTextMap[sid][lang];
    if (!newText) continue;
    if (newText.trim() === info.current.trim()) continue;
    reTtsTasks.push({ sid, lang, newText, info });
  }
}
console.log(`Phase 2: ${reTtsTasks.length} cells accepted for re-TTS (${totalCells - reTtsTasks.length} unchanged after LLM pipeline)`);

// Process re-TTS in CHUNK-parallel slices
const reTtsResults = [];
for (let i = 0; i < reTtsTasks.length; i += ELEVENLABS_CHUNK) {
  const slice = reTtsTasks.slice(i, i + ELEVENLABS_CHUNK);
  const partial = await Promise.all(slice.map(t => reTtsOne.call(this, t)));
  for (const r of partial) reTtsResults.push(r);
}

// Count outcomes
const accepted = reTtsResults.filter(r => r.success);
const skipped = reTtsResults.filter(r => r.skipped);
const errored = reTtsResults.filter(r => r.error);
console.log(`Phase 2 re-TTS results: accepted=${accepted.length}, skipped=${skipped.length}, errored=${errored.length}`);
if (skipped.length > 0) {
  const reasons = {};
  for (const s of skipped) reasons[s.skipped] = (reasons[s.skipped] || 0) + 1;
  console.log(`Phase 2 skip reasons:`, JSON.stringify(reasons));
}

// Emit per-(sid, lang) items for accepted expansions only
return accepted.map(r => ({
  json: {
    row_key:                       `${r.sid}_${r.lang}`,
    segment_id:                    r.sid,
    lang:                          r.lang,
    lesson_id:                     r.info.lesson_id,
    text_translated:               r.newText,
    en_start_sec:                  r.info.en_start_sec,
    en_duration_sec:               r.info.en_duration,
    real_duration_sec:             r.newRealDur,
    lead_silence_sec:              r.newLeadSilence,
    slot_start_sec:                r.info.slot_start_sec,
    slot_end_sec:                  r.info.slot_end_sec,
    tts_budget_sec:                r.info.tts_budget_sec,
    tail_silence_sec:              r.newTailSilence,
    final_duration_sec:            r.newFinalDur,
    borrowed_sec:                  0,
    expansion_attempts:            1,
    shorten_retries_in_synthesize: 0,
    final_speed:                   r.info.voice_speed,
    needs_attention:               false,
    audio_drive_file_id:           r.info.audio_drive_file_id,
    file_name:                     `${r.sid}_${r.lang}.wav`,
  },
  binary: {
    data: {
      data:     r.wavBase64,
      mimeType: 'audio/wav',
      fileName: `${r.sid}_${r.lang}.wav`,
    },
  },
}));
