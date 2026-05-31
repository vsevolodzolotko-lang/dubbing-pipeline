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

// As of 2026-05-31 refactor: borrow compensation is now done UPSTREAM by the
// new `Trim Lead For Sequence` node (which trims each post-borrow segment's
// lead silence by the previous segment's borrowed_sec and overwrites the Drive
// copy via a parallel Save Trimmed Audio path). By the time items reach Build
// Full Audio Per Lang, they are already sequence-aligned. This node is now a
// pure concatenator — just strip 44-byte WAV headers, accumulate PCM, emit.
//
// Why the change: individual WAVs in Drive used to extend past their slot_end
// for short-segment-borrow cells; editors placing them end-to-end (e.g. in
// Reaper) saw ~1.5s cumulative drift. Trimming upstream gives Drive a
// sequence-friendly set of files; Build Full Audio no longer needs special
// per-segment compensation logic.

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
  // Segments come in already trimmed by upstream Trim Lead For Sequence node, so
  // this is a straight concat — no per-segment borrow compensation here.
  const pcmChunks = [];
  let skippedNoBinary = 0;
  let skippedEmptyWav = 0;
  for (const e of entries) {
    if (!e.binary?.data) {
      skippedNoBinary++;
      console.warn(`Build Full: ${lang} ${e.json?.segment_id} skipped — no binary slot on item`);
      continue;
    }
    // CRITICAL: must use this.helpers.getBinaryDataBuffer() — with
    // N8N_BINARY_DATA_MODE=filesystem the raw binary.data.data is a tiny
    // placeholder, not the actual WAV bytes.
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
    pcmChunks.push(wavBuf.subarray(44));
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