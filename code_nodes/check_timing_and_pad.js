const SAMPLE_RATE          = 22050;
const BPS                  = 2;
const BUDGET_FACTOR        = 1.05;
const MIN_RETAIN           = 0.45;
const MAX_RETAIN_EXPANSION = 1.5;
// Per-language CPS — defaults tuned against real ElevenLabs output; overridable via
// config keys cps_estimate_de, cps_estimate_es, …, cps_estimate_tr. Computed below.
const CPS_DEFAULTS = { de: 12, es: 15, fr: 15, pl: 14, pt: 16, it: 14, tr: 14 };
// W3 single-segment shortener. Switched from Claude Haiku 4.5 to Gemini 3.5 Flash
// on 2026-05-31 — Haiku was too conservative on FR tight slots (returned same text
// across all 3 retries with a "cannot shorten further" meta tag, hitting the slot
// truncation path). Gemini Flash is also significantly cheaper. See DECISIONS.md.
const SHORTEN_MODEL        = 'gemini-3.5-flash';
// Failure threshold: anything shorter than 100ms of PCM (4410 bytes at 22050Hz
// mono 16-bit) is treated as a failed TTS response.
const MIN_VALID_PCM_BYTES = 4410;  // 0.1s × 22050 × 2

// ---------------------------------------------------------------------------
// Shared context (identical for every job in the batch) — built ONCE.
// This node now synthesizes the INITIAL TTS itself (the separate "ElevenLabs TTS"
// HTTP node was removed) and processes its whole input batch in parallel via
// Promise.all. Concurrency = "Loop Over Items" batchSize (default 7); retries
// within a single job stay sequential, so in-flight ElevenLabs calls ≤ batchSize.
// As of 2026-05-31 each synthOne invocation also enforces a per-segment wall-clock
// budget (SEG_BUDGET_MS, default 90s). If Gemini or ElevenLabs hangs on one cell,
// only that cell's retries are skipped — the rest of the Promise.all batch keeps
// running, so one bad segment can't blow the 300s task-runner timeout for everyone.
// ---------------------------------------------------------------------------
const configMap = {};
$('Read Config').all().forEach(i => { if (i.json.key) configMap[i.json.key] = i.json.value; });
const EL_KEY  = configMap.elevenlabs_api_key  || '';
const GEM_KEY = configMap.gemini_api_key      || '';

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
if (!GEM_KEY) throw new Error('gemini_api_key missing from config sheet');

const SHORT_SEG_THRESHOLD = parseFloat(configMap.short_seg_threshold_sec) || 2.0;
const MAX_SPEED_UP_DELTA  = parseFloat(configMap.max_speed_up_delta) || 0.20;
const SHORTEN_STATIC      = loadPrompt('w3_shorten_system', { tov: TOV });

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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

// Strip LLM meta-commentary.
// Meditation translations are always single-line; cut at FIRST newline — anything after is meta
// like "(Already at N characters; cannot shorten further)" which the LLM sometimes appends.
function sanitizeLLMOutput(rawText) {
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

// Generic Gemini call — only needs GEM_KEY, so it stays at module scope.
// Uses the OpenAI-compatible endpoint (same as W2 Editor + Phase 2 Editor); no
// prompt caching equivalent to Anthropic ephemeral cache, but per-call cost for
// Gemini 3.5 Flash is ~3× cheaper than cached Haiku 4.5, so net cost still drops.
async function callGemini(systemPrompt, userText) {
  const MAX_TRIES = 4;
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    try {
      const resp = await this.helpers.httpRequest({
        method: 'POST',
        url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
        headers: { Authorization: `Bearer ${GEM_KEY}`, 'content-type': 'application/json' },
        body: {
          model: SHORTEN_MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user',   content: userText      },
          ],
        },
        json: true,
      });
      return resp.choices?.[0]?.message?.content?.trim() || '';
    } catch (e) {
      const isLast = attempt === MAX_TRIES - 1;
      if (isLast) { console.error('W3 callGemini failed after retries:', e.message); return ''; }
      // Exponential backoff: 2s, 4s, 8s.
      await sleep(2000 * Math.pow(2, attempt));
    }
  }
  return '';
}

// ---------------------------------------------------------------------------
// Per-job synthesis + timing + padding. Returns one { json, binary } item.
// All per-job state (voice params, slot budgets, retry loops) lives here so the
// batch can run many jobs concurrently with no cross-talk.
// ---------------------------------------------------------------------------
async function synthOne(job) {
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
  const leadMaxSec   = parseFloat(silence_lead_max_sec)     || 0.05;
  const expThreshold = parseFloat(expansion_threshold)      || 0.75;
  const enRef        = en_text || '';

  const maxBorrowable = Math.max(0, slot - budget);

  // Conditional breath-borrow: only short segments (< SHORT_SEG_THRESHOLD) with available
  // trailing silence (slot > enDur) may extend past en_duration into the gap. Bounded by
  // effective_slot_sec (= en_duration + maxBorrowable). Normal-length segments stay strict.
  const isShortSeg = enDur > 0 && enDur < SHORT_SEG_THRESHOLD && slot > enDur;
  const maxAllowed = isShortSeg ? slot : enDur;

  // Dynamic speed-up ceiling for the shorten path, RELATIVE to this voice's configured
  // speed (replaces the old absolute 1.15 / dead max_speed config key). A 0.8-speed voice
  // previously jumped to an absolute 1.15 (+0.35, jarring); now it caps at 0.8+delta=0.95.
  const baseSpeed      = parseFloat(job.speed) || 1.0;
  const SPEED_UP_STEPS = [
    parseFloat((baseSpeed + MAX_SPEED_UP_DELTA * (2 / 3)).toFixed(3)),
    parseFloat((baseSpeed + MAX_SPEED_UP_DELTA).toFixed(3)),
  ];

  // ElevenLabs call — closes over this job's voice params. Soft-fail: returns null on final
  // failure instead of throwing. Caller checks for null and either keeps the previous PCM
  // (retries) or builds a silent WAV with needs_attention=true (initial TTS). Prevents one
  // bad segment from killing W3 and triggering an expensive full-workflow retry.
  async function tts(t, speed) {
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

  async function geminiShorten(currentText, realSec, level) {
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

    const systemPrompt = `${SHORTEN_STATIC}\n\n${dynamicPart}`;
    const raw = await callGemini.call(this, systemPrompt, currentText);
    const result = sanitizeLLMOutput(raw);
    if (!result || result.length < floorChars) return currentText;
    return result;
  }

  let text = job.text;

  // Per-segment wall-clock budget. Caps total time spent on shorten + speed-up
  // retries for ONE segment so that if Gemini or ElevenLabs slows down badly on
  // a particular cell, the rest of the batch (Promise.all) is not held hostage.
  // 90s is generous: a normal shorten cycle (3 Gemini + 3 TTS) is ~20-30s. Set
  // higher than the n8n task-runner default 300s minus initial-TTS+overhead so
  // 7 parallel segments under worst conditions still fit. When budget is hit
  // mid-retry, the loop exits, needs_attention=true is set, and the segment
  // emits with whatever audio was last produced (truncated as needed).
  const SEG_BUDGET_MS = 90000;
  const segStartedAt  = Date.now();
  const overBudget    = () => (Date.now() - segStartedAt) > SEG_BUDGET_MS;

  // Initial TTS — synthesized here (the separate HTTP node was removed).
  let pcm = await tts.call(this, text, baseSpeed);
  if (pcm && pcm.length < MIN_VALID_PCM_BYTES) {
    console.error(`TTS response too small for ${segment_id}_${lang}: ${pcm.length} bytes.`);
    pcm = null;
  }

  if (!enDur || enDur <= 0) {
    const leadBytes   = Math.round(naturalLead * SAMPLE_RATE) * BPS;
    const leadSilence = leadBytes > 0 ? Buffer.alloc(leadBytes, 0) : Buffer.alloc(0);
    const wav         = buildWav(Buffer.concat([leadSilence, pcm]));
    const realSec     = pcmDuration(pcm);
    const fileName    = `${segment_id}_${lang}.wav`;
    return {
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
    };
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
    console.error(`Initial ElevenLabs TTS produced no audio for ${segment_id}_${lang}.`);
    const silentBytes = Math.round(enDur * SAMPLE_RATE) * BPS;
    const silentPcm   = silentBytes > 0 ? Buffer.alloc(silentBytes, 0) : Buffer.alloc(0);
    const wav         = buildWav(silentPcm);
    const fileName    = `${segment_id}_${lang}.wav`;
    return {
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
              warning:                       `ElevenLabs initial TTS failed for ${segment_id}_${lang}` },
      binary: { data: { data: wav.toString('base64'), mimeType: 'audio/wav', fileName } }
    };
  }

  const LEVELS = ['light', 'medium', 'max'];
  for (let i = 0; i < 3 && pcmDuration(pcm) > maxAllowed; i++) {
    if (overBudget()) {
      console.warn(`${segment_id}_${lang}: per-segment budget exhausted in shorten iter ${i + 1}; skipping remaining retries`);
      needsAttention = true;
      break;
    }
    const realSec = pcmDuration(pcm);
    const shorter = await geminiShorten.call(this, text, realSec, LEVELS[i]);
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

  for (const speed of SPEED_UP_STEPS) {
    if (pcmDuration(pcm) <= maxAllowed) break;
    if (overBudget()) {
      console.warn(`${segment_id}_${lang}: per-segment budget exhausted in speed-up at ${speed}; skipping`);
      needsAttention = true;
      break;
    }
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

  // Inline expansion removed — Phase 2 batch handles all expansion candidates.

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

  return {
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
  };
}

// Drain the batch in parallel. With "Loop Over Items" batchSize=7, ≤7 synthOne run
// concurrently → ≤7 simultaneous ElevenLabs/Gemini calls; one output item per input
// job. The per-segment SEG_BUDGET_MS guard above means even if one segment hangs
// on a slow Gemini/ElevenLabs call, its retries cut off at 90s and the batch
// progresses — staying well under the 300s task-runner ceiling even with all
// 7 segments running their full shorten + speed-up paths in parallel.
const jobs = $input.all().map(i => i.json);
const out  = await Promise.all(jobs.map(j => synthOne.call(this, j)));
return out;
