// W_Regen — Regen Engine Code node.
// Reads localizations rows from upstream Read Localizations, filters where
// needs_retts=TRUE, and synthesizes each via ElevenLabs using Phase 1-style
// timing logic (lead silence + speech + tail silence to match phase1_final_duration).
//
// Editor flow:
//   1. Open localizations sheet, find row(s) to fix.
//   2. Edit text_translated (and any other content fields if needed).
//   3. Set needs_retts=TRUE; optionally add regen_comment for audit.
//   4. Trigger W_Regen via Manual Trigger.
// Result: audio for each flagged cell overwritten in Drive, sheet metrics updated,
// needs_retts cleared, last_regen_at set.
//
// Multi-cell + multi-lesson handled in one run: cells processed with bounded concurrency
// (regen_concurrency config key, default 5). Affected lessons are deduped and propagated
// downstream so Build Full Audio + VTT regenerates only the lessons that had at least
// one cell touched.

const SAMPLE_RATE = 22050;
const BPS = 2;
const MIN_VALID_PCM_BYTES = 4410;
const NEEDS_ATTENTION_THRESHOLD = 0.70;

const configMap = {};
$('Read Config').all().forEach(i => { if (i.json.key) configMap[i.json.key] = i.json.value; });

const voiceMap = {};
$('Read Voices').all().forEach(i => { if (i.json.lang) voiceMap[i.json.lang] = i.json; });

const EL_KEY = configMap.elevenlabs_api_key || '';
if (!EL_KEY) throw new Error('elevenlabs_api_key missing from config sheet');

const MAX_SPEED_UP_DELTA = parseFloat(configMap.max_speed_up_delta) || 0.15;
const MAX_SLOW_DOWN_DELTA = parseFloat(configMap.max_slow_down_delta) || 0.15;
const SLOWDOWN_MIN_GAP_SEC = parseFloat(configMap.slowdown_min_gap_sec) || 0.5;
const REGEN_CONCURRENCY = parseFloat(configMap.regen_concurrency) || 5;

// Read upstream localizations rows, filter by needs_retts flag
const allRows = $input.all();
const candidates = allRows.filter(it => {
  const v = it.json.needs_retts;
  return v === true || v === 'TRUE' || v === 'true';
});

if (candidates.length === 0) {
  console.log('W_Regen: no rows flagged needs_retts=TRUE — nothing to do');
  // Emit a single sentinel item so downstream nodes don't error on empty input;
  // sentinel has has_audio=false and affected_lessons=[] — Build Full guard skips.
  return [{ json: { regen_count: 0, affected_lessons: [], has_audio: false } }];
}

console.log(`W_Regen: ${candidates.length} cells flagged for regeneration`);

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function buildWav(pcm) {
  const n = pcm.length;
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + n, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(SAMPLE_RATE, 24);
  h.writeUInt32LE(SAMPLE_RATE * BPS, 28); h.writeUInt16LE(BPS, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(n, 40);
  return Buffer.concat([h, pcm]);
}

async function synthOne(row) {
  const j = row.json;
  const lang = j.lang;
  const voice = voiceMap[lang];
  if (!voice || !voice.voice_id) {
    return {
      json: { ...j, regen_error: `no voice for lang=${lang}`, has_audio: false },
    };
  }

  const text = (j.text_translated || '').toString();
  if (!text.trim()) {
    return {
      json: { ...j, regen_error: 'text_translated is empty', has_audio: false },
    };
  }

  const enDur = parseFloat(j.en_duration_sec) || 0;
  const lead = parseFloat(j.lead_silence_sec) || 0;
  // Target the EXACT slot duration Phase 1 produced — matches Phase 2 reTtsOne logic
  // so the concatenated full WAV stays EN-aligned after regen.
  const phase1FinalDur = parseFloat(j.final_duration_sec) || 0;
  const targetFileDur = phase1FinalDur > 0 ? phase1FinalDur : (lead + enDur);
  const speechBudget = targetFileDur - lead;

  if (speechBudget <= 0) {
    return {
      json: { ...j, regen_error: `speechBudget <= 0 (lead=${lead}, target=${targetFileDur})`, has_audio: false },
    };
  }

  const baseSpeed = parseFloat(voice.speed) || 1.0;
  const stability = parseFloat(voice.stability) || 0.5;
  const similarity = parseFloat(voice.similarity_boost) || 0.75;
  const style = parseFloat(voice.style) || 0;
  const model = voice.model || 'eleven_multilingual_v2';

  async function ttsAt(speed) {
    const MAX_TRIES = 4;
    for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
      try {
        const resp = await this.helpers.httpRequest({
          method: 'POST',
          url: `https://api.elevenlabs.io/v1/text-to-speech/${voice.voice_id}/stream?output_format=pcm_22050`,
          headers: { 'xi-api-key': EL_KEY, 'content-type': 'application/json', accept: 'audio/pcm' },
          body: {
            text,
            model_id: model,
            voice_settings: { stability, similarity_boost: similarity, style, speed },
          },
          encoding: 'arraybuffer',
          returnFullResponse: false,
        });
        return Buffer.from(resp);
      } catch (e) {
        if (attempt === MAX_TRIES - 1) {
          console.error(`W_Regen TTS failed for ${j.segment_id}_${lang}:`, e.message);
          return null;
        }
        await sleep(2000 * Math.pow(2, attempt));
      }
    }
    return null;
  }

  let pcm = await ttsAt.call(this, baseSpeed);
  if (!pcm || pcm.length < MIN_VALID_PCM_BYTES) {
    return {
      json: { ...j, regen_error: 'TTS produced no audio', has_audio: false },
    };
  }
  let real = pcm.length / (SAMPLE_RATE * BPS);
  let usedSpeed = baseSpeed;

  // Speed-up retry if overshoot (mirrors Phase 1 shorten path + Phase 2 reTtsOne)
  if (real > speechBudget) {
    const steps = [
      baseSpeed + MAX_SPEED_UP_DELTA * (2 / 3),
      baseSpeed + MAX_SPEED_UP_DELTA,
    ];
    for (const speedTry of steps) {
      const fastPcm = await ttsAt.call(this, speedTry);
      if (!fastPcm || fastPcm.length < MIN_VALID_PCM_BYTES) continue;
      const fastReal = fastPcm.length / (SAMPLE_RATE * BPS);
      if (fastReal <= speechBudget) {
        pcm = fastPcm; real = fastReal; usedSpeed = parseFloat(speedTry.toFixed(3));
        break;
      }
    }
  }

  let needsAttention = false;

  if (real > speechBudget) {
    // Still overshoot at max speed-up — hard-truncate and flag
    needsAttention = true;
    const truncBytes = Math.round(speechBudget * SAMPLE_RATE) * BPS;
    pcm = pcm.subarray(0, truncBytes);
    real = pcm.length / (SAMPLE_RATE * BPS);
  } else if (speechBudget - real > SLOWDOWN_MIN_GAP_SEC) {
    // Slowdown-to-fill (mirrors Phase 2 reTtsOne)
    const floor = baseSpeed - MAX_SLOW_DOWN_DELTA;
    const wanted = baseSpeed * (real / speechBudget);
    const slowSpeed = parseFloat(Math.max(floor, wanted).toFixed(3));
    if (slowSpeed < baseSpeed - 1e-6 && slowSpeed > 0) {
      const slowPcm = await ttsAt.call(this, slowSpeed);
      if (slowPcm && slowPcm.length >= MIN_VALID_PCM_BYTES) {
        const slowReal = slowPcm.length / (SAMPLE_RATE * BPS);
        if (slowReal <= speechBudget) {
          pcm = slowPcm; real = slowReal; usedSpeed = slowSpeed;
        }
      }
    }
  }

  const tail = Math.max(0, targetFileDur - lead - real);

  // Flag if speech is significantly shorter than the EN slot (mirrors Phase 2 threshold)
  if (enDur > 0 && real / enDur < NEEDS_ATTENTION_THRESHOLD) needsAttention = true;

  const leadBytes = Math.round(lead * SAMPLE_RATE) * BPS;
  const tailBytes = Math.round(tail * SAMPLE_RATE) * BPS;
  const fullPcm = Buffer.concat([
    leadBytes > 0 ? Buffer.alloc(leadBytes, 0) : Buffer.alloc(0),
    pcm,
    tailBytes > 0 ? Buffer.alloc(tailBytes, 0) : Buffer.alloc(0),
  ]);
  const wav = buildWav(fullPcm);
  const finalDur = (leadBytes + pcm.length + tailBytes) / (SAMPLE_RATE * BPS);

  return {
    json: {
      row_key:                       j.row_key,
      segment_id:                    j.segment_id,
      lang,
      lesson_id:                     j.lesson_id || (j.segment_id || '').split('_seg_')[0],
      text_translated:               text,
      en_start_sec:                  parseFloat(j.en_start_sec) || 0,
      en_duration_sec:               enDur,
      slot_start_sec:                parseFloat(j.slot_start_sec) || 0,
      slot_end_sec:                  parseFloat(j.slot_end_sec) || 0,
      lead_silence_sec:              parseFloat(lead.toFixed(3)),
      tts_budget_sec:                parseFloat(j.tts_budget_sec) || enDur,
      tail_silence_sec:              parseFloat(tail.toFixed(3)),
      real_duration_sec:             parseFloat(real.toFixed(3)),
      final_duration_sec:            parseFloat(finalDur.toFixed(3)),
      borrowed_sec:                  parseFloat(j.borrowed_sec) || 0,
      expansion_attempts:            parseFloat(j.expansion_attempts) || 0,
      shorten_retries_in_synthesize: parseFloat(j.shorten_retries_in_synthesize) || 0,
      final_speed:                   usedSpeed,
      needs_attention:               needsAttention ? 'TRUE' : 'FALSE',
      needs_retts:                   'FALSE',
      last_regen_at:                 new Date().toISOString(),
      regen_comment:                 j.regen_comment || '',
      audio_drive_file_id:           j.audio_drive_file_id,
      phase2_outcome:                j.phase2_outcome || '',
      file_name:                     `${j.segment_id}_${lang}.wav`,
      has_audio:                     true,
    },
    binary: {
      data: {
        data:     wav.toString('base64'),
        mimeType: 'audio/wav',
        fileName: `${j.segment_id}_${lang}.wav`,
      },
    },
  };
}

// Bounded-concurrent synthesis. Same idiom as W3 Phase 2 reTtsOne batching.
const results = [];
for (let i = 0; i < candidates.length; i += REGEN_CONCURRENCY) {
  const slice = candidates.slice(i, i + REGEN_CONCURRENCY);
  const partial = await Promise.all(slice.map(c => synthOne.call(this, c)));
  for (const r of partial) results.push(r);
}

const ok = results.filter(r => r.json.has_audio).length;
const failed = results.length - ok;
const affectedLessons = [...new Set(results.filter(r => r.json.has_audio).map(r => r.json.lesson_id))];
console.log(`W_Regen: ${ok} cells regenerated, ${failed} failed, affected lessons: ${affectedLessons.join(', ')}`);

return results;
