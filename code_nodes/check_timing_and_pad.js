const SAMPLE_RATE          = 22050;
const BPS                  = 2;
const BUDGET_FACTOR        = 1.05;
const MIN_RETAIN           = 0.60;
const MAX_RETAIN_EXPANSION = 1.5;
// Per-language CPS — defaults tuned against real ElevenLabs output; overridable via
// config keys cps_estimate_de, cps_estimate_es, …, cps_estimate_tr. Computed below.
const CPS_DEFAULTS = { de: 12, es: 15, fr: 15, pl: 14, pt: 16, it: 14, tr: 14 };
const HAIKU_MODEL          = 'claude-haiku-4-5-20251001';

const job = $('Expand TTS Jobs').item.json;
const {
  voice_id, en_text, en_duration_sec,
  lead_silence_natural_sec, tts_budget_sec, effective_slot_sec, trailing_steal_sec,
  silence_lead_ratio, silence_lead_max_sec, expansion_threshold,
  stability, similarity_boost, segment_id, lang, lesson_id,
} = job;

const enDur        = parseFloat(en_duration_sec)          || 0;
const naturalLead  = parseFloat(lead_silence_natural_sec) || 0;
const budget       = parseFloat(tts_budget_sec)           || enDur;
const slot         = parseFloat(effective_slot_sec)       || budget;
const trailSteal   = parseFloat(trailing_steal_sec)       || 0;
const leadRatio    = parseFloat(silence_lead_ratio)       || 0.2;
const leadMaxSec   = parseFloat(silence_lead_max_sec)    || 0.05;
const expThreshold = parseFloat(expansion_threshold)      || 0.75;
const enRef        = en_text || '';

const maxBorrowable = Math.max(0, slot - budget);
// Conditional breath-borrow: maxAllowed computed below after configMap is built (needs short_seg_threshold_sec).

const configMap = {};
$('Read Config').all().forEach(i => { if (i.json.key) configMap[i.json.key] = i.json.value; });
const EL_KEY  = configMap.elevenlabs_api_key  || '';
const ANT_KEY = configMap.anthropic_api_key   || '';
const TOV     = configMap.tone_of_voice       || '';

// Resolve per-language CPS from config (defaults from CPS_DEFAULTS above).
const LANG_CPS = {
  de: parseFloat(configMap.cps_estimate_de) || CPS_DEFAULTS.de,
  es: parseFloat(configMap.cps_estimate_es) || CPS_DEFAULTS.es,
  fr: parseFloat(configMap.cps_estimate_fr) || CPS_DEFAULTS.fr,
  pl: parseFloat(configMap.cps_estimate_pl) || CPS_DEFAULTS.pl,
  pt: parseFloat(configMap.cps_estimate_pt) || CPS_DEFAULTS.pt,
  it: parseFloat(configMap.cps_estimate_it) || CPS_DEFAULTS.it,
  tr: parseFloat(configMap.cps_estimate_tr) || CPS_DEFAULTS.tr,
};
if (!EL_KEY)  throw new Error('elevenlabs_api_key missing from config sheet');
if (!ANT_KEY) throw new Error('anthropic_api_key missing from config sheet');

// Conditional breath-borrow: only short segments (< SHORT_SEG_THRESHOLD) with available
// trailing silence (slot > enDur) may extend past en_duration into the gap. Bounded by
// effective_slot_sec (= en_duration + maxBorrowable). Normal-length segments stay strict.
// Set short_seg_threshold_sec=0 in config to fully disable (revert to strict alignment).
const SHORT_SEG_THRESHOLD = parseFloat(configMap.short_seg_threshold_sec) || 2.0;
const isShortSeg          = enDur > 0 && enDur < SHORT_SEG_THRESHOLD && slot > enDur;
const maxAllowed          = isShortSeg ? slot : enDur;

const binaryData = $input.first().binary?.data;
let pcm  = binaryData?.data ? Buffer.from(binaryData.data, 'base64') : null;
// Failure threshold: anything shorter than 100ms of PCM (4410 bytes at 22050Hz
// mono 16-bit) is treated as a failed TTS response. ElevenLabs sometimes returns
// HTTP 200 with a small error blob (JSON error message, redirect, partial
// response) that n8n materializes as a non-empty Buffer. The PREVIOUS guard only
// caught buffer.length === 0; tiny-but-nonzero buffers slipped through, got
// pcmDuration ≈ 0.001s which rounds to 0 in toFixed(3), produced silence-padded
// WAVs without setting needs_attention=true. Result: pipeline appeared successful
// while emitting silence and the user had no signal that TTS failed.
const MIN_VALID_PCM_BYTES = 4410;  // 0.1s × 22050 × 2
if (pcm && pcm.length < MIN_VALID_PCM_BYTES) {
  // Diagnostic: log what we actually got so we can identify upstream cause
  // (JSON error blob, empty body, etc.). Truncate to first 200 chars to avoid
  // log spam; only meaningful if response was small enough to be an error msg.
  const preview = pcm.length > 0
    ? Buffer.from(binaryData.data, 'base64').toString('utf8', 0, Math.min(200, pcm.length))
    : '(empty)';
  console.error(`TTS response too small for ${segment_id}_${lang}: ${pcm.length} bytes (< ${MIN_VALID_PCM_BYTES} threshold). Content preview: ${JSON.stringify(preview)}`);
  pcm = null;
}
let text = job.text;
let initialTtsFailed = !pcm;
if (initialTtsFailed && !pcm && binaryData?.data === undefined) console.error(`Initial ElevenLabs TTS produced no binary at all for ${segment_id}_${lang} — likely HTTP error swallowed by onError. Emitting silent placeholder.`);

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

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function tts(t, speed) {
  // Soft-fail: returns null on final failure instead of throwing. Caller checks for null and
  // either keeps the previous PCM (for retries inside Check Timing) or builds a silent WAV
  // with needs_attention=true (for initial TTS). Prevents one bad segment from killing W3
  // and triggering an expensive full-workflow retry.
  const MAX_TRIES = 4;
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    try {
      const resp = await this.helpers.httpRequest({
        method: 'POST',
        url: `https://api.elevenlabs.io/v1/text-to-speech/${voice_id}?output_format=pcm_22050`,
        headers: { 'xi-api-key': EL_KEY, 'content-type': 'application/json' },
        body: { text: t, model_id: 'eleven_multilingual_v2', voice_settings: { stability, similarity_boost, speed } },
        json: true, returnFullResponse: true, encoding: 'arraybuffer',
      });
      return Buffer.from(resp.body);
    } catch (e) {
      const isLast = attempt === MAX_TRIES - 1;
      if (isLast) {
        console.error(`tts() failed for ${segment_id}_${lang} after ${MAX_TRIES} tries:`, e.message);
        return null;
      }
      // Exponential backoff: 2s, 4s, 8s.
      await sleep(2000 * Math.pow(2, attempt));
    }
  }
  return null;
}

// Strip Claude meta-commentary.
// Meditation translations are always single-line; cut at FIRST newline — anything after is meta
// like "(Already at N characters; cannot shorten further)" which Claude sometimes appends.
function sanitizeClaudeOutput(rawText) {
  if (!rawText) return '';
  let t = rawText.trim();
  const nlIdx = t.indexOf('\n');
  if (nlIdx >= 0) t = t.substring(0, nlIdx).trim();
  // Strip leading/trailing markdown emphasis (*, **, __)
  t = t.replace(/^[\*_]+|[\*_]+$/g, '').trim();
  // Strip surrounding quotes
  t = t.replace(/^["'`]+|["'`]+$/g, '').trim();
  // Strip trailing parenthesized meta even on same line ("text (12 chars)")
  t = t.replace(/\s*\([^)]*(character|char|cannot|already|maximally|minimal)[^)]*\)\s*$/i, '').trim();
  return t;
}

async function callClaude(systemBlocks, userText) {
  const MAX_TRIES = 4;
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    try {
      const resp = await this.helpers.httpRequest({
        method: 'POST',
        url: 'https://api.anthropic.com/v1/messages',
        headers: { 'x-api-key': ANT_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: { model: HAIKU_MODEL, max_tokens: 500, system: systemBlocks, messages: [{ role: 'user', content: userText }] },
        json: true,
      });
      return resp.content?.[0]?.text?.trim() || '';
    } catch (e) {
      const isLast = attempt === MAX_TRIES - 1;
      if (isLast) { console.error('W3 callClaude failed after retries:', e.message); return ''; }
      // Exponential backoff: 2s, 4s, 8s.
      await sleep(2000 * Math.pow(2, attempt));
    }
  }
  return '';
}

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

OUTPUT FORMAT (strict — any violation will cause your reply to be rejected and re-tried):
- Reply with ONLY the new translated text, as a single block of text in the target language.
- DO NOT include character counts, "(N characters)", or any meta-commentary.
- DO NOT include reasoning words like "Wait", "Let me", "Actually", "Note:", "Hmm".
- DO NOT use markdown formatting (**, __, backticks).
- DO NOT include multiple drafts or alternatives — pick ONE and output only it.
- DO NOT include surrounding quotes.
- DO NOT include any blank lines.`;

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
  const raw = await callClaude.call(this, systemBlocks, currentText);
  const result = sanitizeClaudeOutput(raw);
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

OUTPUT FORMAT (strict — any violation will cause your reply to be rejected and re-tried):
- Reply with ONLY the new translated text, as a single block of text in the target language.
- DO NOT include character counts, "(N characters)", or any meta-commentary.
- DO NOT include reasoning words like "Wait", "Let me", "Actually", "Note:", "Hmm".
- DO NOT use markdown formatting (**, __, backticks).
- DO NOT include multiple drafts or alternatives — pick ONE and output only it.
- DO NOT include surrounding quotes.
- DO NOT include any blank lines.`;

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
  const raw = await callClaude.call(this, systemBlocks, currentText);
  return sanitizeClaudeOutput(raw);
}

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

// Soft fallback: if initial TTS produced no audio, emit a silent placeholder WAV of
// en_duration length so downstream Save to Drive / Build Full Audio Per Lang still run.
// W3 finishes successfully; W_Master Slack notification still fires; flag for manual
// review via needs_attention=true.
if (!pcm) {
  const silentBytes = Math.round(enDur * SAMPLE_RATE) * BPS;
  const silentPcm   = silentBytes > 0 ? Buffer.alloc(silentBytes, 0) : Buffer.alloc(0);
  const wav         = buildWav(silentPcm);
  const fileName    = `${segment_id}_${lang}.wav`;
  return [{
    json: { segment_id, lang, lesson_id,
            en_duration_sec:               enDur,
            lead_silence_sec:              0,
            tts_budget_sec:                0,
            tail_silence_sec:              0,
            borrowed_sec:                  0,
            expansion_attempts:            0,
            shorten_retries_in_synthesize: 0,
            real_duration_sec:             0,
            final_duration_sec:            parseFloat((silentBytes / (SAMPLE_RATE * BPS)).toFixed(3)),
            final_text:                    text,
            final_speed:                   1.0,
            needs_attention:               true,
            file_name:                     fileName,
            warning:                       'ElevenLabs TTS failed after retries — silent placeholder WAV' },
    binary: { data: { data: wav.toString('base64'), mimeType: 'audio/wav', fileName } }
  }];
}

const LEVELS = ['light', 'medium', 'max'];
for (let i = 0; i < 3 && pcmDuration(pcm) > maxAllowed; i++) {
  const realSec = pcmDuration(pcm);
  const shorter = await claudeShorten.call(this, text, realSec, LEVELS[i]);
  if (shorter && shorter !== text) {
    const newPcm = await tts.call(this, shorter, 1.0);
    if (newPcm) {
      text = shorter;
      pcm  = newPcm;
    } else {
      // TTS failed during shorten retry — keep previous text/pcm, abort shorten loop.
      needsAttention = true;
      shortenRetries = i + 1;
      break;
    }
  }
  shortenRetries = i + 1;
}

for (const speed of [1.10, 1.15]) {
  if (pcmDuration(pcm) <= maxAllowed) break;
  const newPcm = await tts.call(this, text, speed);
  if (!newPcm) {
    // TTS failed during speed retry — keep previous pcm + finalSpeed, abort loop.
    needsAttention = true;
    break;
  }
  pcm = newPcm;
  finalSpeed = speed;
}

if (pcmDuration(pcm) > maxAllowed) {
  needsAttention = true;
  const truncBytes = Math.round(maxAllowed * SAMPLE_RATE) * BPS;
  pcm = pcm.subarray(0, truncBytes);
}

if (finalSpeed === 1.0 && !needsAttention) {
  let lastText = text;
  let lastPcm  = pcm;
  while (expansionAttempts < 2 && pcmDuration(lastPcm) < enDur * expThreshold) {
    const realSec = pcmDuration(lastPcm);
    const longer  = await claudeExpand.call(this, lastText, realSec);
    if (!longer || longer.length <= lastText.length || longer.length > lastText.length * MAX_RETAIN_EXPANSION) break;
    const newPcm = await tts.call(this, longer, 1.0);
    if (!newPcm) break;  // TTS failed during expand — keep previous, abort expansion.
    if (pcmDuration(newPcm) > maxAllowed) break;
    lastText = longer;
    lastPcm  = newPcm;
    expansionAttempts++;
  }
  text = lastText;
  pcm  = lastPcm;
}

const realDur = pcmDuration(pcm);
let leadSec, tailSec, borrowedSec;

if (realDur <= enDur) {
  const padding = enDur - realDur;
  borrowedSec = 0;
  if (naturalLead > 0) {
    leadSec = naturalLead;
    tailSec = padding;
  } else {
    // Cap breath-lead so dubbed words align with EN even when EN slot has a long trailing silence
    leadSec = Math.min(padding * leadRatio, leadMaxSec);
    tailSec = padding - leadSec;
  }
} else if (realDur <= maxAllowed) {
  // Borrow case (short-seg path): TTS audio extends past en_duration into the trailing
  // silence budgeted in effective_slot_sec. File duration = lead + real_dur, no tail.
  // borrowed_sec = how much we extended beyond en_duration. Not flagged for attention —
  // this is intentional breath-borrow for ultra-short segments.
  borrowedSec = parseFloat((realDur - enDur).toFixed(3));
  leadSec     = naturalLead;
  tailSec     = 0;
} else {
  // Defensive: real_dur exceeds even the borrow ceiling. Hard-truncate earlier in the
  // shorten/speed loop should have prevented this; flag for manual review if reached.
  borrowedSec = parseFloat((maxAllowed - enDur).toFixed(3));
  leadSec     = naturalLead;
  tailSec     = 0;
  needsAttention = true;
}

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