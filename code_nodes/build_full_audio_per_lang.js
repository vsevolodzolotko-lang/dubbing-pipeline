// W3 final stage — after Loop Over Items completes, builds a full-lesson WAV per language
// by concatenating all per-segment files in segment_id order, then emits 7 binary items
// for the downstream "Save Full to Drive" node.
//
// Reads:
//   $('Read Localizations Fresh').all() — every row written by the loop
//   $('Read Config').all()              — drive_output_full_folder_id (or fallback to drive_output_folder_id)
//   Drive OAuth credential               — via this.getCredentials('googleDriveOAuth2Api')
//
// For each lang:
//   1. Sort rows by segment_id (works because we use zero-padded `seg_NNN` ids).
//   2. Download each segment WAV from Drive via the v3 files API (alt=media).
//   3. Strip the 44-byte WAV header, concatenate raw PCM data.
//   4. Wrap the result in a fresh WAV header (22050Hz mono 16-bit, same as segments).
//   5. Emit one item per lang with the WAV as binary, named `{lesson_id}_full_{lang}.wav`.
//
// Notes:
//   - The concat works because every segment file has identical PCM format (set in
//     Check Timing + Pad). Stripping the 44-byte header is safe — it's a standard PCM WAV.
//   - n8n Drive node downstream uploads each item by reading $binary.data and the
//     file_name in $json.

const SAMPLE_RATE = 22050;
const BPS         = 2;

const rows = $('Read Localizations Fresh').all().map(i => i.json);
if (!rows.length) throw new Error('No localization rows found — run W3 main loop first');

const driveCreds = await this.getCredentials('googleDriveOAuth2Api');
const driveToken = driveCreds.oauthTokenData?.access_token;
if (!driveToken) throw new Error('Drive OAuth token unavailable from credential');

const byLang = {};
for (const row of rows) {
  if (!row.lang || !row.audio_drive_file_id) continue;
  if (!byLang[row.lang]) byLang[row.lang] = [];
  byLang[row.lang].push(row);
}

const results = [];
for (const lang of Object.keys(byLang).sort()) {
  const sortedRows = byLang[lang].sort((a, b) =>
    String(a.segment_id).localeCompare(String(b.segment_id))
  );

  const pcmChunks = [];
  for (const row of sortedRows) {
    const resp = await this.helpers.httpRequest({
      method: 'GET',
      url: `https://www.googleapis.com/drive/v3/files/${row.audio_drive_file_id}?alt=media`,
      headers: { Authorization: `Bearer ${driveToken}` },
      returnFullResponse: true,
      encoding: 'arraybuffer',
    });
    const wavBuf = Buffer.from(resp.body);
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

  const lessonId = String(sortedRows[0].segment_id).split('_seg_')[0] || 'lesson';
  const fileName = `${lessonId}_full_${lang}.wav`;

  results.push({
    json: {
      lang,
      lesson_id:         lessonId,
      file_name:         fileName,
      total_segments:    sortedRows.length,
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
