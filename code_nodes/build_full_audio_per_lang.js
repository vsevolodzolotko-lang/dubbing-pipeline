// W3 final stage — concatenates per-segment WAVs into one full-lesson file per lang.
//
// Receives N items (one per localization row), each with:
//   item.json    — row data: segment_id, lang, audio_drive_file_id, etc.
//   item.binary.data — the per-segment WAV binary (downloaded by upstream
//                       "Download Segment WAV" Google Drive node)
//
// For each lang:
//   1. Sort items by segment_id (zero-padded → lexicographic order works).
//   2. Strip 44-byte WAV header from each segment, accumulate raw PCM.
//   3. Wrap with fresh WAV header (22050Hz mono 16-bit — same format as segments).
//   4. Emit one item with the full WAV as binary, named `{lesson_id}_full_{lang}.wav`.
//
// Why pre-download via n8n Drive node instead of fetching via httpRequest here:
//   `this.getCredentials` is NOT available in Code nodes, so we can't get the
//   OAuth token directly. The upstream Drive Download node handles auth and
//   exposes binaries on each item.

const SAMPLE_RATE = 22050;
const BPS         = 2;

const items = $input.all();
if (!items.length) throw new Error('No items — Download Segment WAV must run first');

const byLang = {};
for (const item of items) {
  const row = item.json || {};
  if (!row.lang) continue;
  if (!byLang[row.lang]) byLang[row.lang] = [];
  byLang[row.lang].push({ row, binary: item.binary });
}

const results = [];
for (const lang of Object.keys(byLang).sort()) {
  const entries = byLang[lang].sort((a, b) =>
    String(a.row.segment_id).localeCompare(String(b.row.segment_id))
  );

  const pcmChunks = [];
  for (const e of entries) {
    const binData = e.binary?.data;
    if (!binData?.data) continue;
    const wavBuf = Buffer.from(binData.data, 'base64');
    if (wavBuf.length <= 44) continue;
    pcmChunks.push(wavBuf.subarray(44));
  }

  const fullPcm = Buffer.concat(pcmChunks);
  const n = fullPcm.length;

  const h = Buffer.alloc(44);
  h.write('RIFF', 0);          h.writeUInt32LE(36 + n, 4);
  h.write('WAVE', 8);          h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);     h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);      h.writeUInt32LE(SAMPLE_RATE, 24);
  h.writeUInt32LE(SAMPLE_RATE * BPS, 28);
  h.writeUInt16LE(BPS, 32);    h.writeUInt16LE(16, 34);
  h.write('data', 36);         h.writeUInt32LE(n, 40);
  const fullWav = Buffer.concat([h, fullPcm]);

  const lessonId = String(entries[0].row.segment_id).split('_seg_')[0] || 'lesson';
  const fileName = `${lessonId}_full_${lang}.wav`;

  results.push({
    json: {
      lang,
      lesson_id:         lessonId,
      file_name:         fileName,
      total_segments:    entries.length,
      full_duration_sec: parseFloat((n / (SAMPLE_RATE * BPS)).toFixed(3)),
    },
    binary: {
      data: {
        data:     fullWav.toString('base64'),
        mimeType: 'audio/wav',
        fileName,
      },
    },
  });
}

return results;
