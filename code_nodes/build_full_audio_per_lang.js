// Concat per-segment WAVs into one full WAV per language.
// Memory-conscious: iterates active_langs sequentially, no pre-grouping of all items,
// explicit reference cleanup after each lang. Pairs with N8N_BINARY_DATA_MODE=filesystem
// for further heap savings.
const SAMPLE_RATE = 22050;
const BPS         = 2;

const lesson_id = $('Get Params').first().json.lesson_id;

const configMap = {};
$('Read Config').all().forEach(i => { if (i.json.key) configMap[i.json.key] = i.json.value; });
const activeLangs = (configMap.active_langs || 'de,es,fr,it,pl,pt,tr')
  .split(',').map(s => s.trim()).filter(Boolean).sort();

// Authoritative borrow/lead source = the localizations SHEET (Read Localizations Fresh),
// keyed by `${segment_id}_${lang}`. The per-item json flowing through
// Phase 2 Update Localizations → Download Segment WAV (Drive) loses/zeros these fields,
// which silently disabled borrow compensation → the full track drifted from the first
// breath-borrow segment onward. Values here are in SECONDS (format-independent), so this
// also avoids inferring duration from PCM byte length.
const locMap = {};
$('Read Localizations Fresh').all().forEach(i => {
  const j = i.json || {};
  if (!j.segment_id || !j.lang) return;
  locMap[`${j.segment_id}_${j.lang}`] = {
    borrowed_sec:     parseFloat(j.borrowed_sec) || 0,
    lead_silence_sec: parseFloat(j.lead_silence_sec) || 0,
  };
});

const items = $input.all();
if (!items.length) throw new Error('No items — Download Segment WAV must run first');

// Map item reference → its original index in $input.all() so that, after
// filter/sort, we can still pass the correct itemIndex to getBinaryDataBuffer.
// (Critical for N8N_BINARY_DATA_MODE=filesystem support — see Check Timing + Pad.)
const indexMap = new Map(items.map((it, idx) => [it, idx]));

const results = [];
for (const lang of activeLangs) {
  // Lazy filter for current lang only (no pre-grouping → no doubled refs).
  const entries = items
    .filter(i => i.json && i.json.lang === lang)
    .filter(i => !lesson_id || (i.json.segment_id || '').startsWith(lesson_id + '_'))
    .sort((a, b) => String(a.json.segment_id).localeCompare(String(b.json.segment_id)));

  if (!entries.length) continue;

  // Strip 44-byte WAV header from each segment, accumulate raw PCM.
  //
  // BORROW COMPENSATION (drift fix):
  // When segment N has borrowed_sec > 0, its WAV extends past en_end[N] by that amount
  // (breath-borrow path in Check Timing + Pad). To keep the concatenated lesson aligned
  // with the EN timeline we trim that many seconds from the START of seg N+1's PCM —
  // eating into its lead silence, never into TTS audio. The borrow budget in Expand
  // TTS Jobs (max_borrowable ≤ gap_after − MIN_GAP, and lead_silence[N+1] == gap_after[N])
  // guarantees trimSec ≤ lead_silence[N+1], so the bound is structural; the
  // Math.min(prevBorrow, leadSec) clamp is belt-and-braces in case Sheet round-trip
  // introduces rounding.
  const pcmChunks = [];
  let prevBorrow      = 0;
  let trimmedLeadSum  = 0;
  let skippedNoBinary = 0;
  let skippedEmptyWav = 0;
  for (const e of entries) {
    if (!e.binary?.data) {
      skippedNoBinary++;
      console.warn(`Build Full: ${lang} ${e.json?.segment_id} skipped — no binary slot on item`);
      continue;
    }
    // CRITICAL: must use this.helpers.getBinaryDataBuffer() — see Check Timing
    // + Pad for full explanation. With N8N_BINARY_DATA_MODE=filesystem the raw
    // binary.data.data is a tiny placeholder, not the actual WAV bytes.
    const originalIdx = indexMap.get(e);
    if (originalIdx === undefined) {
      skippedNoBinary++;
      console.warn(`Build Full: ${lang} ${e.json?.segment_id} skipped — could not resolve original item index`);
      continue;
    }
    let wavBuf;
    try {
      wavBuf = await this.helpers.getBinaryDataBuffer(originalIdx, 'data');
    } catch (err) {
      skippedNoBinary++;
      console.warn(`Build Full: ${lang} ${e.json?.segment_id} skipped — getBinaryDataBuffer failed: ${err.message}`);
      continue;
    }
    if (!wavBuf || wavBuf.length <= 44) {
      skippedEmptyWav++;
      console.warn(`Build Full: ${lang} ${e.json?.segment_id} skipped — WAV is ${wavBuf?.length ?? 0} bytes (header-only or empty)`);
      continue;
    }
    let pcm = wavBuf.subarray(44);
    const loc = locMap[`${e.json.segment_id}_${e.json.lang}`] || {};
    if (prevBorrow > 0) {
      const leadSec   = loc.lead_silence_sec ?? (parseFloat(e.json.lead_silence_sec) || 0);
      const trimSec   = Math.min(prevBorrow, leadSec);
      const trimBytes = Math.round(trimSec * SAMPLE_RATE) * BPS;
      if (trimBytes > 0 && trimBytes < pcm.length) {
        pcm = pcm.subarray(trimBytes);
        trimmedLeadSum += trimSec;
      }
    }
    pcmChunks.push(pcm);
    prevBorrow = loc.borrowed_sec ?? (parseFloat(e.json.borrowed_sec) || 0);
  }

  const fullPcm = Buffer.concat(pcmChunks);
  pcmChunks.length = 0;  // explicit ref clear — helps GC reclaim per-segment buffers
  const n = fullPcm.length;

  // Build fresh WAV header (22050Hz mono 16-bit — matches segments)
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);          h.writeUInt32LE(36 + n, 4);
  h.write('WAVE', 8);          h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);     h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);      h.writeUInt32LE(SAMPLE_RATE, 24);
  h.writeUInt32LE(SAMPLE_RATE * BPS, 28);
  h.writeUInt16LE(BPS, 32);    h.writeUInt16LE(16, 34);
  h.write('data', 36);         h.writeUInt32LE(n, 40);
  const fullWav = Buffer.concat([h, fullPcm]);

  const lessonId = String(entries[0].json.segment_id).split('_seg_')[0] || 'lesson';
  const fileName = `${lessonId}_full_${lang}.wav`;

  if (skippedNoBinary > 0 || skippedEmptyWav > 0) {
    console.warn(`Build Full: ${lang} skipped ${skippedNoBinary} items (no binary) + ${skippedEmptyWav} items (empty WAV) out of ${entries.length}`);
  }
  results.push({
    json: {
      lang,
      lesson_id:              lessonId,
      file_name:              fileName,
      total_segments:         entries.length,
      skipped_no_binary:      skippedNoBinary,
      skipped_empty_wav:      skippedEmptyWav,
      full_duration_sec:      parseFloat((n / (SAMPLE_RATE * BPS)).toFixed(3)),
      trimmed_lead_total_sec: parseFloat(trimmedLeadSum.toFixed(3)),
    },
    binary: {
      data: {
        data:     fullWav.toString('base64'),
        mimeType: 'audio/wav',
        fileName,
      },
    },
  });
  // fullPcm + fullWav fall out of scope at next iteration — GC can reclaim.
}

if (!results.length) throw new Error('No localizations to concat' + (lesson_id ? ' for lesson_id=' + lesson_id : ''));
return results;