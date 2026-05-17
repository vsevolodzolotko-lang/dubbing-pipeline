// W3 Synthesize v3 — smart timing.
// Cost optimizations (2026-05-17):
//   - Claude model: Haiku 4.5 (shorten/expand are simple text transforms, 4× cheaper)
//   - Prompt caching: system prefix marked cache_control: ephemeral (refreshed each hit)
//   - Expansion threshold default: 0.75 (was 0.85) — fires less for marginally short TTS
//   - LANG_CPS retuned to observed real_duration / chars from sleep_001 run 2
//   - Strict drift cap: in steal case (no borrow available), truncate to en_duration
//     instead of slot * 1.05 — eliminates positive drift on speed-retried IT segments
//
// File layout per segment:
//   [lead_silence] + [TTS audio] + [tail_silence]
// Drift-free: file = naturalLead + en_duration when real ≤ en_duration; otherwise
//             file = naturalLead + real (borrow case, only when max_borrowable > 0).

const SAMPLE_RATE          = 22050;
const BPS                  = 2;
const BUDGET_FACTOR        = 1.05;
const MIN_RETAIN           = 0.60;
const MAX_RETAIN_EXPANSION = 1.5;
// CPS tuned against real ElevenLabs PCM output (sleep_001 run 2 observations):
const LANG_CPS             = { de: 12, es: 15, fr: 15, pl: 14, pt: 16, it: 14, tr: 14 };
const HAIKU_MODEL          = 'claude-haiku-4-5-20251001';

const job = $('Expand TTS Jobs').item.json;
const {
  voice_id, en_text, en_duration_sec,
  lead_silence_natural_sec, tts_budget_sec, effective_slot_sec, trailing_steal_sec,
  silence_lead_ratio, expansion_threshold,
  stability, similarity_boost, segment_id, lang, lesson_id,
} = job;

const enDur        = parseFloat(en_duration_sec)          || 0;
const naturalLead  = parseFloat(lead_silence_natural_sec) || 0;
const budget       = parseFloat(tts_budget_sec)           || enDur;
const slot         = parseFloat(effective_slot_sec)       || budget;
const trailSteal   = parseFloat(trailing_steal_sec)       || 0;
const leadRatio    = parseFloat(silence_lead_ratio)       || 0.2;
const expThreshold = parseFloat(expansion_threshold)      || 0.75;
const enRef        = en_text || '';

// Strict drift cap:
//   - borrow case (max_borrowable > 0): real may extend into next gap up to slot * 1.05
//   - steal case  (max_borrowable = 0): real must NOT exceed en_duration — prevents drift
const maxBorrowable = Math.max(0, slot - budget);
const maxAllowed    = maxBorrowable > 0 ? slot * BUDGET_FACTOR : enDur;

const configMap = {};
$('Read Config').all().forEach(i => { if (i.json.key) configMap[i.json.key] = i.json.value; });
const EL_KEY  = configMap.elevenlabs_api_key  || '';
const ANT_KEY = configMap.anthropic_api_key   || '';
const TOV     = configMap.tone_of_voice       || '';
if (!EL_KEY)  throw new Error('elevenlabs_api_key missing from config sheet');
if (!ANT_KEY) throw new Error('anthropic_api_key missing from config sheet');

const binaryData = $input.first().binary?.data;
if (!binaryData) throw new Error(`No binary data for ${segment_id}_${lang}`);
let pcm  = Buffer.from(binaryData.data, 'base64');
let text = job.text;

function pcmDuration(buf) { return buf.length / (SAMPLE_RATE * BPS); }

function buildWav(pcmBuf) {
  const n = pcmBuf.length;
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);          h.writeUInt32LE(36 + n, 4);
  h.write('WAVE', 8);          h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);     h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);      h.writeUInt32LE(SAMPLE_RATE, 24);
  h.writeUInt32LE(SAMPLE_RATE * BPS, 28);
  h.writeUInt16LE(BPS, 32);    h.writeUInt16LE(16, 34);
  h.write('data', 36);         h.writeUInt32LE(n, 40);
  return Buffer.concat([h, pcmBuf]);
}

async function tts(t, speed) {
  const resp = await this.helpers.httpRequest({
    method: 'POST',
    url: `https://api.elevenlabs.io/v1/text-to-speech/${voice_id}?output_format=pcm_22050`,
    headers: { 'xi-api-key': EL_KEY, 'content-type': 'application/json' },
    body: { text: t, model_id: 'eleven_multilingual_v2', voice_settings: { stability, similarity_boost, speed } },
    json: true, returnFullResponse: true, encoding: 'arraybuffer',
  });
  return Buffer.from(resp.body);
}

// Reusable Claude caller with prompt-caching support.
// systemBlocks: array of { type:'text', text, cache_control?: {type:'ephemeral'} }
async function callClaude(systemBlocks, userText) {
  const resp = await this.helpers.httpRequest({
    method: 'POST',
    url: 'https://api.anthropic.com/v1/messages',
    headers: { 'x-api-key': ANT_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: { model: HAIKU_MODEL, max_tokens: 500, system: systemBlocks, messages: [{ role: 'user', content: userText }] },
    json: true,
  });
  return resp.content?.[0]?.text?.trim() || '';
}

// Static (cacheable) part of shorten prompt — identical across calls within a run.
const SHORTEN_STATIC = `You are shortening a translated meditation/wellness script segment to fit a tight audio time slot.

The current translation produced TTS audio that exceeds the available slot by a small margin. Your job: shorten the translation just enough to fit, while preserving meaning and tone.

TONE OF VOICE:
${TOV}

RULES:
1. Stay within ±10% of target length. Do NOT undershoot — removing too much breaks the meditation rhythm.
2. Maintain ToV warmth and rhythm.
3. Preserve any ellipsis (...) or em-dash (—) timing markers.
4. Never add new filler ("really", "very", etc.) — those break tone.
5. Use natural language structures for the target language.
6. Preserve negations ("no", "not", "without", "never") and contrasts ("A, not B") exactly.
7. Preserve specific nouns, named techniques, numbers, proper names.

ATTEMPT LEVEL DESCRIPTIONS:
- Level light:  Remove filler words, contractions, redundancies. Keep all meaning.
- Level medium: Rephrase for compactness. May drop redundant qualifiers but keep all content.
- Level max:    Compress to essential meaning only. May drop secondary context but preserve core message.

OUTPUT: ONLY the shortened translation text. No commentary, no quotes.`;

async function claudeShorten(currentText, realSec, level) {
  const minChars       = Math.floor(currentText.length * MIN_RETAIN);
  const targetChars    = Math.floor(slot * (LANG_CPS[lang] || 15));
  const targetCharsLow = Math.floor(targetChars * 0.85);
  const floorChars     = Math.max(minChars, targetCharsLow);

  const dynamicPart = `Task — shorten this segment:
LANG: ${lang}
ORIGINAL EN: ${enRef}
CURRENT TRANSLATION: ${currentText}
TARGET LENGTH: ~${targetChars} characters
MINIMUM ALLOWED LENGTH: ${floorChars} characters — do NOT go below this
ATTEMPT LEVEL: ${level}`;

  const systemBlocks = [
    { type: 'text', text: SHORTEN_STATIC, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: dynamicPart },
  ];
  const result = await callClaude.call(this, systemBlocks, currentText);
  if (!result || result.length < floorChars) return currentText;
  return result;
}

const EXPAND_STATIC = `You are expanding a previously-shortened translation to fit a longer audio slot.

The current translation was shortened earlier, but TTS output is now too short — creating awkward silence in the dubbed audio. Your job: restore meaningful content while keeping the brand tone intact.

TONE OF VOICE:
${TOV}

RULES:
1. Restore meaningful content that was likely cut, especially context-setting phrases or qualifiers.
2. Do NOT add filler ("really", "very", "kind of") — those break meditative tone.
3. Do NOT artificially repeat or rephrase the same idea.
4. Stay close to target length (within ±10%).
5. Preserve ToV: warm, knowing-friend tone.
6. Natural language structures for the target language.
7. Preserve negations and contrasts from the English source.
8. Preserve specific nouns, named techniques, numbers, proper names.

OUTPUT: ONLY the expanded translation. No commentary, no quotes.`;

async function claudeExpand(currentText, realSec) {
  const targetChars = Math.floor(enDur * (LANG_CPS[lang] || 15));
  const dynamicPart = `Task — expand this segment:
LANG: ${lang}
ORIGINAL EN: ${enRef}
CURRENT (SHORTENED) TRANSLATION: ${currentText}
TARGET LENGTH: ~${targetChars} characters`;

  const systemBlocks = [
    { type: 'text', text: EXPAND_STATIC, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: dynamicPart },
  ];
  return await callClaude.call(this, systemBlocks, currentText);
}

// Guard: no timing data
if (!enDur || enDur <= 0) {
  const leadBytes   = Math.round(naturalLead * SAMPLE_RATE) * BPS;
  const leadSilence = leadBytes > 0 ? Buffer.alloc(leadBytes, 0) : Buffer.alloc(0);
  const wav         = buildWav(Buffer.concat([leadSilence, pcm]));
  const realSec     = pcmDuration(pcm);
  const fileName    = `${segment_id}_${lang}.wav`;
  return [{
    json: { segment_id, lang, lesson_id, en_duration_sec: 0,
            lead_silence_sec:              naturalLead,
            tts_budget_sec:                0,
            tail_silence_sec:              0,
            borrowed_sec:                  0,
            expansion_attempts:            0,
            shorten_retries_in_synthesize: 0,
            real_duration_sec:             parseFloat(realSec.toFixed(3)),
            final_duration_sec:            parseFloat((naturalLead + realSec).toFixed(3)),
            final_text:                    text,
            final_speed: 1.0, needs_attention: true, file_name: fileName,
            warning: 'en_duration_sec missing — file not strictly timed' },
    binary: { data: { data: wav.toString('base64'), mimeType: 'audio/wav', fileName } }
  }];
}

let finalSpeed        = parseFloat(job.speed) || 1.0;
let needsAttention    = false;
let shortenRetries    = 0;
let expansionAttempts = 0;

// === Shorten loop (up to 3 attempts: light → medium → max), targeting maxAllowed ===
const LEVELS = ['light', 'medium', 'max'];
for (let i = 0; i < 3 && pcmDuration(pcm) > maxAllowed; i++) {
  const realSec = pcmDuration(pcm);
  const shorter = await claudeShorten.call(this, text, realSec, LEVELS[i]);
  if (shorter && shorter !== text) {
    text = shorter;
    pcm  = await tts.call(this, text, 1.0);
  }
  shortenRetries = i + 1;
}

// === Speed retry AS LAST RESORT (after all 3 shorten attempts) ===
for (const speed of [1.10, 1.15]) {
  if (pcmDuration(pcm) <= maxAllowed) break;
  pcm = await tts.call(this, text, speed);
  finalSpeed = speed;
}

// === Hard truncate at maxAllowed (= enDur in steal case, slot*1.05 in borrow case) ===
if (pcmDuration(pcm) > maxAllowed) {
  needsAttention = true;
  const truncBytes = Math.round(maxAllowed * SAMPLE_RATE) * BPS;
  pcm = pcm.subarray(0, truncBytes);
}

// === Expansion loop ===
if (finalSpeed === 1.0 && !needsAttention) {
  let lastText = text;
  let lastPcm  = pcm;
  while (expansionAttempts < 2 && pcmDuration(lastPcm) < enDur * expThreshold) {
    const realSec = pcmDuration(lastPcm);
    const longer  = await claudeExpand.call(this, lastText, realSec);
    if (!longer || longer.length <= lastText.length || longer.length > lastText.length * MAX_RETAIN_EXPANSION) break;
    const newPcm = await tts.call(this, longer, 1.0);
    if (pcmDuration(newPcm) > maxAllowed) break;   // overshoot — revert
    lastText = longer;
    lastPcm  = newPcm;
    expansionAttempts++;
  }
  text = lastText;
  pcm  = lastPcm;
}

// === Compute lead / tail silence (drift-free: file = naturalLead + enDur unless borrow) ===
const realDur = pcmDuration(pcm);
let leadSec, tailSec, borrowedSec;

if (realDur <= enDur) {
  const padding = enDur - realDur;
  borrowedSec = 0;
  if (naturalLead > 0) {
    leadSec = naturalLead;
    tailSec = padding;
  } else {
    leadSec = leadRatio * padding;
    tailSec = (1 - leadRatio) * padding;
  }
} else {
  borrowedSec = realDur - enDur;
  leadSec     = naturalLead;
  tailSec     = 0;
}

// === Build WAV ===
const leadBytes = Math.round(leadSec * SAMPLE_RATE) * BPS;
const tailBytes = Math.round(tailSec * SAMPLE_RATE) * BPS;
const finalPcm  = Buffer.concat([
  leadBytes > 0 ? Buffer.alloc(leadBytes, 0) : Buffer.alloc(0),
  pcm,
  tailBytes > 0 ? Buffer.alloc(tailBytes, 0) : Buffer.alloc(0),
]);

const wav           = buildWav(finalPcm);
const finalDuration = (leadBytes + pcm.length + tailBytes) / (SAMPLE_RATE * BPS);
const fileName      = `${segment_id}_${lang}.wav`;

return [{
  json: {
    segment_id, lang, lesson_id,
    en_duration_sec:               enDur,
    lead_silence_sec:              parseFloat(leadSec.toFixed(3)),
    tts_budget_sec:                parseFloat(budget.toFixed(3)),
    tail_silence_sec:              parseFloat(tailSec.toFixed(3)),
    borrowed_sec:                  parseFloat(borrowedSec.toFixed(3)),
    expansion_attempts:            expansionAttempts,
    shorten_retries_in_synthesize: shortenRetries,
    real_duration_sec:             parseFloat(realDur.toFixed(3)),
    final_duration_sec:            parseFloat(finalDuration.toFixed(3)),
    final_text:                    text,
    final_speed:                   finalSpeed,
    needs_attention:               needsAttention,
    file_name:                     fileName,
  },
  binary: { data: { data: wav.toString('base64'), mimeType: 'audio/wav', fileName } }
}];
