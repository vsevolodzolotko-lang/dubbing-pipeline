// Strict timing: measures PCM duration, re-adapts text via Claude if over budget,
// adjusts ElevenLabs speed only as last resort, hard-truncates if still over,
// prepends lead silence (so concatenated files match original timeline), builds WAV.
//
// Input:  binary PCM from ElevenLabs TTS (output_format=pcm_22050, responseFormat=file)
// Reads:  $('Expand TTS Jobs').item.json
//           — voice_id, text, en_duration_sec, lead_silence_sec, stability,
//             similarity_boost, speed, segment_id, lang, lesson_id
//         $('Read Config').all() — elevenlabs_api_key, anthropic_api_key
//
// File layout for each segment (so concat matches original EN timeline):
//   [ lead_silence_sec of zeros ] + [ exactly en_duration_sec of audio ]
//
// "audio" = TTS adjusted to fit budget:
//   1. Claude re-adapt (1 attempt) if over budget
//   2. Speed 1.10 → 1.15 if still over
//   3. Hard truncate to en_duration_sec if still over (needs_attention = true)
//   4. Pad end with silence if under en_duration_sec
//
// Requires n8n ≥ 1.x (uses this.helpers.httpRequest, Buffer)

const SAMPLE_RATE   = 22050;
const BPS           = 2;
const BUDGET_FACTOR = 1.05;

const job = $('Expand TTS Jobs').item.json;
const { voice_id, en_duration_sec, lead_silence_sec, stability, similarity_boost,
        segment_id, lang, lesson_id } = job;
const budget  = parseFloat(en_duration_sec)  || 0;
const leadSec = parseFloat(lead_silence_sec) || 0;

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
  const resp = await this.helpers.httpRequest({
    method: 'POST',
    url: 'https://api.anthropic.com/v1/messages',
    headers: { 'x-api-key': ANT_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: {
      model: 'claude-sonnet-4-5',
      max_tokens: 500,
      system: `You are a localization editor. Shorten the given ${lang} text so it fits within ${budget.toFixed(1)}s of audio (currently ~${realSec.toFixed(1)}s). Keep language, tone, and informal address unchanged. Preserve '...' and '—'. Return ONLY the shortened text.`,
      messages: [{ role: 'user', content: currentText }],
    },
    json: true,
  });
  return resp.content?.[0]?.text?.trim() || currentText;
}

// Guard: if no budget, generate natural audio + lead silence and flag
if (!budget || budget <= 0) {
  const leadBytes = Math.round(leadSec * SAMPLE_RATE) * BPS;
  const leadSilence = leadBytes > 0 ? Buffer.alloc(leadBytes, 0) : Buffer.alloc(0);
  const wav = buildWav(Buffer.concat([leadSilence, pcm]));
  const realSec = pcmDuration(pcm);
  const fileName = `${segment_id}_${lang}.wav`;
  return [{
    json: { segment_id, lang, lesson_id, en_duration_sec: 0,
            lead_silence_sec:   leadSec,
            real_duration_sec:  parseFloat(realSec.toFixed(3)),
            final_duration_sec: parseFloat((leadSec + realSec).toFixed(3)),
            final_speed: 1.0, needs_attention: true, file_name: fileName,
            warning: 'en_duration_sec missing — file not strictly timed' },
    binary: { data: { data: wav.toString('base64'), mimeType: 'audio/wav', fileName } }
  }];
}

let finalSpeed     = parseFloat(job.speed) || 1.0;
let needsAttention = false;

// Step 1: Claude re-adapt if over budget
if (pcmDuration(pcm) > budget * BUDGET_FACTOR) {
  const realSec = pcmDuration(pcm);
  const shorter = await claudeAdapt.call(this, text, realSec);
  if (shorter && shorter !== text) {
    text = shorter;
    pcm  = await tts.call(this, text, 1.0);
  }
}

// Step 2: Speed retry only if text adaptation wasn't enough
for (const speed of [1.10, 1.15]) {
  if (pcmDuration(pcm) <= budget * BUDGET_FACTOR) break;
  pcm = await tts.call(this, text, speed);
  finalSpeed = speed;
}

const realDuration = pcmDuration(pcm);
const targetBytes  = Math.round(budget * SAMPLE_RATE) * BPS;

// Step 3: Hard fit to en_duration_sec — truncate if over (cuts mid-word), pad if under
let coreAudio;
if (pcm.length > targetBytes) {
  coreAudio = pcm.subarray(0, targetBytes);
  needsAttention = true;
} else if (pcm.length < targetBytes) {
  coreAudio = Buffer.concat([pcm, Buffer.alloc(targetBytes - pcm.length, 0)]);
} else {
  coreAudio = pcm;
}

// Step 4: Prepend lead silence so concatenated files match original timeline
const leadBytes   = Math.round(leadSec * SAMPLE_RATE) * BPS;
const leadSilence = leadBytes > 0 ? Buffer.alloc(leadBytes, 0) : Buffer.alloc(0);
const finalPcm    = Buffer.concat([leadSilence, coreAudio]);

const wav           = buildWav(finalPcm);
const finalDuration = (leadBytes + targetBytes) / (SAMPLE_RATE * BPS);
const fileName      = `${segment_id}_${lang}.wav`;

return [{
  json: {
    segment_id, lang, lesson_id,
    en_duration_sec:    budget,
    lead_silence_sec:   leadSec,
    real_duration_sec:  parseFloat(realDuration.toFixed(3)),
    final_duration_sec: parseFloat(finalDuration.toFixed(3)),
    final_speed:        finalSpeed,
    needs_attention:    needsAttention,
    file_name:          fileName,
  },
  binary: { data: { data: wav.toString('base64'), mimeType: 'audio/wav', fileName } }
}];
