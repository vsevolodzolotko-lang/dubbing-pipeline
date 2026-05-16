// Strict timing with MIN_GAP enforcement and concept-preserving Claude re-adapt.
//
// File layout per segment (so concat reproduces EN timeline):
//   [ lead_silence_sec of zeros ]
//   + [ tts_budget_sec of TTS audio (Claude adapt + speed + truncate to fit) ]
//   + [ trailing_silence_sec of zeros (creates MIN_GAP to next segment) ]
//
// Total file duration = lead_silence_sec + en_duration_sec (slot size, unchanged).
//
// Input:  binary PCM from ElevenLabs TTS (output_format=pcm_22050, responseFormat=file)
// Reads:  $('Expand TTS Jobs').item.json
//           — voice_id, text, en_text, en_duration_sec, lead_silence_sec, tts_budget_sec,
//             trailing_silence_sec, stability, similarity_boost, speed,
//             segment_id, lang, lesson_id
//         $('Read Config').all() — elevenlabs_api_key, anthropic_api_key
//
// needs_attention: TRUE only when real PCM duration > budget × 1.05 after all retries
// (i.e., even speed 1.15 couldn't fit and we had to hard-truncate noticeably).
// Tiny truncations within tolerance do NOT flag.
//
// Length floor on Claude adaptation: reject output below 60% of input length.

const SAMPLE_RATE   = 22050;
const BPS           = 2;
const BUDGET_FACTOR = 1.05;
const MIN_RETAIN    = 0.60;

const job = $('Expand TTS Jobs').item.json;
const { voice_id, en_text, en_duration_sec, lead_silence_sec, tts_budget_sec, trailing_silence_sec,
        stability, similarity_boost, segment_id, lang, lesson_id } = job;
const enDur    = parseFloat(en_duration_sec)      || 0;
const leadSec  = parseFloat(lead_silence_sec)     || 0;
const budget   = parseFloat(tts_budget_sec)       || enDur;
const trailSec = parseFloat(trailing_silence_sec) || 0;
const enRef    = en_text || '';

const configMap = {};
$('Read Config').all().forEach(i => { if (i.json.key) configMap[i.json.key] = i.json.value; });
const EL_KEY  = configMap.elevenlabs_api_key  || '';
const ANT_KEY = configMap.anthropic_api_key   || '';
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

async function claudeAdapt(currentText, realSec) {
  const minChars = Math.floor(currentText.length * MIN_RETAIN);
  const systemPrompt = `You are a localization editor for meditation/wellness audio. Shorten the ${lang} translation to fit within ${budget.toFixed(1)}s of audio (currently ~${realSec.toFixed(1)}s).

CRITICAL — DO NOT remove any concept from the English source:
- Every distinct concept must remain. If English mentions X, translation must mention X.
- Preserve negations exactly: "no", "not", "without", "never" stay.
- Preserve contrasts: "A, not B" / "A but B" / "A instead of B" patterns stay.
- Only remove genuinely redundant filler words (e.g., "really", "very", "just", "actually").
- Keep informal address (du/tu/ty/sen). Preserve '...' and '—' as pause cues.
- DO NOT shorten below ${minChars} characters.

English source (preserve all concepts): ${enRef}
Current ${lang} translation: ${currentText}

Return ONLY the shortened ${lang} text. No preamble, no quotes.`;

  const resp = await this.helpers.httpRequest({
    method: 'POST',
    url: 'https://api.anthropic.com/v1/messages',
    headers: { 'x-api-key': ANT_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: {
      model: 'claude-sonnet-4-5',
      max_tokens: 500,
      system: systemPrompt,
      messages: [{ role: 'user', content: currentText }],
    },
    json: true,
  });
  const result = resp.content?.[0]?.text?.trim() || '';
  // Sanity floor: reject if Claude over-shortened
  if (!result || result.length < minChars) return currentText;
  return result;
}

// Guard: no timing data → natural audio + lead silence + flag
if (!enDur || enDur <= 0) {
  const leadBytes   = Math.round(leadSec * SAMPLE_RATE) * BPS;
  const leadSilence = leadBytes > 0 ? Buffer.alloc(leadBytes, 0) : Buffer.alloc(0);
  const wav         = buildWav(Buffer.concat([leadSilence, pcm]));
  const realSec     = pcmDuration(pcm);
  const fileName    = `${segment_id}_${lang}.wav`;
  return [{
    json: { segment_id, lang, lesson_id, en_duration_sec: 0,
            lead_silence_sec:     leadSec,
            tts_budget_sec:       0,
            trailing_silence_sec: 0,
            real_duration_sec:    parseFloat(realSec.toFixed(3)),
            final_duration_sec:   parseFloat((leadSec + realSec).toFixed(3)),
            final_speed: 1.0, needs_attention: true, file_name: fileName,
            warning: 'en_duration_sec missing — file not strictly timed' },
    binary: { data: { data: wav.toString('base64'), mimeType: 'audio/wav', fileName } }
  }];
}

let finalSpeed     = parseFloat(job.speed) || 1.0;
let needsAttention = false;

// Step 1: Claude re-adapt if over tts_budget_sec (with EN reference + length floor)
if (pcmDuration(pcm) > budget * BUDGET_FACTOR) {
  const realSec = pcmDuration(pcm);
  const shorter = await claudeAdapt.call(this, text, realSec);
  if (shorter && shorter !== text) {
    text = shorter;
    pcm  = await tts.call(this, text, 1.0);
  }
}

// Step 2: Speed retry only if adaptation wasn't enough
for (const speed of [1.10, 1.15]) {
  if (pcmDuration(pcm) <= budget * BUDGET_FACTOR) break;
  pcm = await tts.call(this, text, speed);
  finalSpeed = speed;
}

const realDuration = pcmDuration(pcm);
const targetBytes  = Math.round(budget * SAMPLE_RATE) * BPS;

// Step 3: Hard fit to tts_budget — truncate if over, pad if under.
// needs_attention only TRUE if real > budget × 1.05 (i.e., all retries failed).
let coreAudio;
if (pcm.length > targetBytes) {
  coreAudio = pcm.subarray(0, targetBytes);
  needsAttention = realDuration > budget * BUDGET_FACTOR;
} else if (pcm.length < targetBytes) {
  coreAudio = Buffer.concat([pcm, Buffer.alloc(targetBytes - pcm.length, 0)]);
} else {
  coreAudio = pcm;
}

// Step 4: Append trailing silence (creates MIN_GAP to next segment)
const trailBytes   = Math.round(trailSec * SAMPLE_RATE) * BPS;
const trailSilence = trailBytes > 0 ? Buffer.alloc(trailBytes, 0) : Buffer.alloc(0);

// Step 5: Prepend lead silence so concat reproduces original EN timeline
const leadBytes   = Math.round(leadSec * SAMPLE_RATE) * BPS;
const leadSilence = leadBytes > 0 ? Buffer.alloc(leadBytes, 0) : Buffer.alloc(0);

const finalPcm = Buffer.concat([leadSilence, coreAudio, trailSilence]);

const wav           = buildWav(finalPcm);
const finalDuration = (leadBytes + targetBytes + trailBytes) / (SAMPLE_RATE * BPS);
const fileName      = `${segment_id}_${lang}.wav`;

return [{
  json: {
    segment_id, lang, lesson_id,
    en_duration_sec:      enDur,
    lead_silence_sec:     leadSec,
    tts_budget_sec:       parseFloat(budget.toFixed(3)),
    trailing_silence_sec: parseFloat(trailSec.toFixed(3)),
    real_duration_sec:    parseFloat(realDuration.toFixed(3)),
    final_duration_sec:   parseFloat(finalDuration.toFixed(3)),
    final_speed:          finalSpeed,
    needs_attention:      needsAttention,
    file_name:            fileName,
  },
  binary: { data: { data: wav.toString('base64'), mimeType: 'audio/wav', fileName } }
}];
