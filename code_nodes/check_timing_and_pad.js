// W3 Synthesize v3 — smart timing with breath-borrow, expansion, 20/80 silence, speed-as-last-resort.
//
// File layout per segment:
//   [ lead_silence_sec of zeros ]
//   + [ real_duration of TTS audio (after shorten/expand/speed loops) ]
//   + [ tail_silence_sec of zeros ]
//
// Total file duration is variable:
//   - real ≤ tts_budget_sec (audio fits): file = lead + (budget) + tail, where lead+tail = silence padding (20/80 or natural-EN-lead exception)
//   - tts_budget_sec < real ≤ effective_slot_sec (breath borrow): file = lead + real + 0, file extends `borrowed_sec` past EN slot end
//   - real > effective_slot_sec after all retries: hard-truncate, needs_attention=true
//
// Fallback chain when initial TTS exceeds effective_slot:
//   1. Claude shorten attempt 1 (light) → re-TTS → re-check
//   2. Claude shorten attempt 2 (medium) → re-TTS → re-check
//   3. Claude shorten attempt 3 (max) → re-TTS → re-check
//   4. Speed 1.10 → re-TTS → re-check
//   5. Speed 1.15 → re-TTS → re-check
//   6. Hard truncate, needs_attention = true
//
// Expansion loop (only when shorten/speed never fired and initial real < en_duration × expansion_threshold):
//   1. Claude expand attempt 1 → re-TTS → if overshoot effective_slot, revert
//   2. Claude expand attempt 2 → re-TTS → if overshoot, revert
//
// Input:  binary PCM from ElevenLabs TTS (output_format=pcm_22050, responseFormat=file)
// Reads:  $('Expand TTS Jobs').item.json — voice_id, text, en_text, en_duration_sec,
//           lead_silence_natural_sec, tts_budget_sec, effective_slot_sec, trailing_steal_sec,
//           silence_lead_ratio, expansion_threshold, stability, similarity_boost, speed,
//           segment_id, lang, lesson_id
//         $('Read Config').all() — elevenlabs_api_key, anthropic_api_key, tone_of_voice
//
// Requires n8n ≥ 1.x (uses this.helpers.httpRequest, Buffer).

const SAMPLE_RATE          = 22050;
const BPS                  = 2;
const BUDGET_FACTOR        = 1.05;
const MIN_RETAIN           = 0.60;
const MAX_RETAIN_EXPANSION = 1.5;
const LANG_CPS             = { de: 13, es: 17, fr: 15, pl: 14, pt: 16, it: 16, tr: 14 };

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
const expThreshold = parseFloat(expansion_threshold)      || 0.85;
const enRef        = en_text || '';

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
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + n, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);                  // PCM
  h.writeUInt16LE(1, 22);                  // mono
  h.writeUInt32LE(SAMPLE_RATE, 24);
  h.writeUInt32LE(SAMPLE_RATE * BPS, 28);
  h.writeUInt16LE(BPS, 32);
  h.writeUInt16LE(16, 34);                 // 16-bit
  h.write('data', 36);
  h.writeUInt32LE(n, 40);
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

async function callClaude(systemPrompt, userText) {
  const resp = await this.helpers.httpRequest({
    method: 'POST',
    url: 'https://api.anthropic.com/v1/messages',
    headers: { 'x-api-key': ANT_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: { model: 'claude-sonnet-4-5', max_tokens: 500, system: systemPrompt, messages: [{ role: 'user', content: userText }] },
    json: true,
  });
  return resp.content?.[0]?.text?.trim() || '';
}

const ATTEMPT_DESCRIPTIONS = {
  light:  'Remove filler words, contractions, redundancies. Keep all meaning.',
  medium: 'Rephrase for compactness. May drop redundant qualifiers but keep all content.',
  max:    'Compress to essential meaning only. May drop secondary context but preserve core message.',
};

async function claudeShorten(currentText, realSec, level) {
  const minChars    = Math.floor(currentText.length * MIN_RETAIN);
  const targetChars = Math.floor(slot * (LANG_CPS[lang] || 15));
  const systemPrompt = `You are shortening a translated meditation/wellness script segment to fit a tight audio time slot.

The current translation produced TTS audio that exceeds the available slot by a small margin. Your job: shorten the translation just enough to fit, while preserving meaning and tone.

ORIGINAL EN: ${enRef}
CURRENT TRANSLATION (${lang}): ${currentText}
TARGET LENGTH: ~${targetChars} characters
ATTEMPT LEVEL: ${level} — ${ATTEMPT_DESCRIPTIONS[level]}

TONE OF VOICE:
${TOV}

RULES:
1. Stay close to target length (within ±10%).
2. Maintain ToV warmth and rhythm.
3. Preserve any ellipsis (...) or em-dash (—) timing markers.
4. Never add new filler ("really", "very", etc.) — those break tone.
5. Use natural language structures for ${lang}.
6. Preserve negations ("no", "not", "without", "never") and contrasts ("A, not B") exactly.
7. Preserve specific nouns, named techniques, numbers, proper names.

OUTPUT: ONLY the shortened translation text. No commentary, no quotes.`;

  const result = await callClaude.call(this, systemPrompt, currentText);
  if (!result || result.length < minChars) return currentText;
  return result;
}

async function claudeExpand(currentText, realSec) {
  const targetChars = Math.floor(enDur * (LANG_CPS[lang] || 15));
  const systemPrompt = `You are expanding a previously-shortened translation to fit a longer audio slot.

The current translation was shortened earlier, but TTS output is now too short — creating awkward silence in the dubbed audio. Your job: restore meaningful content while keeping the brand tone intact.

ORIGINAL EN: ${enRef}
CURRENT (SHORTENED) TRANSLATION (${lang}): ${currentText}
TARGET LENGTH: ~${targetChars} characters

TONE OF VOICE:
${TOV}

RULES:
1. Restore meaningful content that was likely cut, especially context-setting phrases or qualifiers.
2. Do NOT add filler ("really", "very", "kind of") — those break meditative tone.
3. Do NOT artificially repeat or rephrase the same idea.
4. Stay close to target length (within ±10%).
5. Preserve ToV: warm, knowing-friend tone.
6. Natural language structures for ${lang}.
7. Preserve negations and contrasts from the English source.
8. Preserve specific nouns, named techniques, numbers, proper names.

OUTPUT: ONLY the expanded translation. No commentary, no quotes.`;

  return await callClaude.call(this, systemPrompt, currentText);
}

// Guard: no timing data → natural audio + flag
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

// === Shorten loop (up to 3 attempts: light → medium → max) ===
const LEVELS = ['light', 'medium', 'max'];
for (let i = 0; i < 3 && pcmDuration(pcm) > slot * BUDGET_FACTOR; i++) {
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
  if (pcmDuration(pcm) <= slot * BUDGET_FACTOR) break;
  pcm = await tts.call(this, text, speed);
  finalSpeed = speed;
}

// === Hard truncate if still over after all retries ===
if (pcmDuration(pcm) > slot * BUDGET_FACTOR) {
  needsAttention = true;
  const truncBytes = Math.round(slot * SAMPLE_RATE) * BPS;
  pcm = pcm.subarray(0, truncBytes);
}

// === Expansion loop (only when shorten/speed never fired) ===
if (shortenRetries === 0 && finalSpeed === 1.0 && !needsAttention) {
  let lastText = text;
  let lastPcm  = pcm;
  while (expansionAttempts < 2 && pcmDuration(lastPcm) < enDur * expThreshold) {
    const realSec = pcmDuration(lastPcm);
    const longer  = await claudeExpand.call(this, lastText, realSec);
    if (!longer || longer.length <= lastText.length || longer.length > lastText.length * MAX_RETAIN_EXPANSION) break;
    const newPcm = await tts.call(this, longer, 1.0);
    if (pcmDuration(newPcm) > slot * BUDGET_FACTOR) break;   // overshoot — revert
    lastText = longer;
    lastPcm  = newPcm;
    expansionAttempts++;
  }
  text = lastText;
  pcm  = lastPcm;
}

// === Compute lead / tail silence ===
const realDur = pcmDuration(pcm);
let leadSec, tailSec, borrowedSec;

if (realDur <= budget) {
  // Within audio budget — pad with silence
  const padding = budget - realDur;
  borrowedSec = 0;
  if (naturalLead > 0) {
    leadSec = naturalLead;
    tailSec = padding + trailSteal;
  } else {
    leadSec = leadRatio * padding;
    tailSec = (1 - leadRatio) * padding + trailSteal;
  }
} else {
  // Borrow case: budget < real <= slot (only reachable when borrow case; steal case can't reach here)
  borrowedSec = realDur - enDur;
  leadSec     = naturalLead;
  tailSec     = 0;
}

// === Build WAV: [lead] + [TTS] + [tail] ===
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
