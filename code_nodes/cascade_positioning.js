// Cascade timing positioning for multi-language audio segments.
//
// Input:  array of items with fields:
//           segment_id      — e.g. "seg_001"
//           lang            — e.g. "de"
//           real_duration_sec — actual TTS audio duration in seconds
//           en_start_sec    — start time of the corresponding EN segment
//
// Output: array of items with fields:
//           segment_id, lang
//           position_start_sec  — where to place this clip on the timeline
//           position_end_sec    — position_start_sec + real_duration_sec
//           drift_from_en_sec   — how far behind the EN start this segment has drifted
//           row_key             — "{segment_id}_{lang}", e.g. "seg_001_de"
//
// MIN_GAP = 0.4s minimum silence between consecutive segments of the same language.
// First segment of each language always starts at en_start (no gap applied).
// Formula: position[i] = (i === 0) ? en_start : max(en_start, prevEnd + MIN_GAP)

const MIN_GAP = 0.4;

const rows = $input.all().map(item => item.json);

if (rows.length === 0) {
  throw new Error('No rows from Sheet');
}

const requiredFields = ['segment_id', 'lang', 'real_duration_sec', 'en_start_sec'];
for (const field of requiredFields) {
  if (rows[0][field] === undefined) {
    throw new Error(`Column '${field}' missing in Sheet. Check schema.`);
  }
}

const byLang = {};
for (const row of rows) {
  if (!byLang[row.lang]) byLang[row.lang] = [];
  byLang[row.lang].push(row);
}

console.log(`Languages found: ${Object.keys(byLang).join(', ')}`);

const results = [];

for (const lang in byLang) {
  const sorted = byLang[lang].sort((a, b) =>
    String(a.segment_id).localeCompare(String(b.segment_id))
  );

  let prevEnd = null;

  for (const row of sorted) {
    const realDur = parseFloat(row.real_duration_sec);
    const enStart = parseFloat(row.en_start_sec);

    if (isNaN(realDur) || isNaN(enStart)) {
      console.log(`Skip ${row.segment_id} ${lang}: invalid numbers`);
      continue;
    }

    const positionStart = (prevEnd === null)
      ? enStart
      : Math.max(enStart, prevEnd + MIN_GAP);

    const positionEnd = positionStart + realDur;
    const driftFromEn = parseFloat((positionStart - enStart).toFixed(3));

    results.push({
      json: {
        segment_id: row.segment_id,
        lang: row.lang,
        position_start_sec: parseFloat(positionStart.toFixed(3)),
        position_end_sec: parseFloat(positionEnd.toFixed(3)),
        drift_from_en_sec: driftFromEn,
        row_key: `${row.segment_id}_${row.lang}`
      }
    });

    prevEnd = positionEnd;
  }

  const langResults = results.filter(r => r.json.lang === lang);
  const finalDrift = langResults[langResults.length - 1]?.json.drift_from_en_sec;
  console.log(`Lang ${lang}: ${langResults.length} segments, final drift ${finalDrift}s`);
}

return results;
