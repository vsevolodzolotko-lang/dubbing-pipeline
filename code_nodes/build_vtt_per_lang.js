// Build WebVTT subtitles per active language. One .vtt per lang, matching the
// full-lesson WAV positions. Runs in parallel with Download Segment WAV (both read
// the same Read Localizations Fresh output).
//
// Cue timings: en_start_sec → en_end_sec. After the borrow-compensation fix in
// Build Full Audio Per Lang, each segment in the full WAV starts exactly at
// en_start_sec — so EN-aligned cues match the dubbed audio for every language.
// Cue text: text_translated (final version after Verify + Adapt + W3 shorten).

const lesson_id = $('Get Params').first().json.lesson_id;

const configMap = {};
$('Read Config').all().forEach(i => { if (i.json.key) configMap[i.json.key] = i.json.value; });
const activeLangs = (configMap.active_langs || 'de,es,fr,it,pl,pt,tr')
  .split(',').map(s => s.trim()).filter(Boolean);

const items = $input.all();
if (!items.length) throw new Error('No items — Read Localizations Fresh must run first');

function fmtTime(sec) {
  // VTT timestamp: HH:MM:SS.mmm
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec - h * 3600 - m * 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`;
}

const results = [];
for (const lang of activeLangs) {
  const segs = items
    .filter(i => i.json && i.json.lang === lang)
    .filter(i => !lesson_id || (i.json.segment_id || '').startsWith(lesson_id + '_'))
    .sort((a, b) => String(a.json.segment_id).localeCompare(String(b.json.segment_id)));
  if (!segs.length) continue;

  const lines = ['WEBVTT', ''];
  let cueIdx = 0;
  for (const e of segs) {
    const s = e.json;
    const start = parseFloat(s.en_start_sec) || 0;
    const dur   = parseFloat(s.en_duration_sec) || 0;
    const end   = start + dur;
    const text  = (s.text_translated || '').toString().trim().replace(/\r?\n/g, ' ');
    if (!text) continue;
    cueIdx++;
    lines.push(String(cueIdx));
    lines.push(`${fmtTime(start)} --> ${fmtTime(end)}`);
    lines.push(text);
    lines.push('');
  }
  if (cueIdx === 0) continue;
  const vtt = lines.join('\n');

  const lessonId = String(segs[0].json.segment_id).split('_seg_')[0] || 'lesson';
  const fileName = `${lessonId}_full_${lang}.vtt`;
  results.push({
    json: {
      lang,
      lesson_id: lessonId,
      file_name: fileName,
      total_cues: cueIdx,
      vtt_bytes:  Buffer.byteLength(vtt, 'utf8'),
    },
    binary: {
      data: {
        data: Buffer.from(vtt, 'utf8').toString('base64'),
        mimeType: 'text/vtt',
        fileName,
      },
    },
  });
}

if (!results.length) throw new Error('No localizations for VTT' + (lesson_id ? ' for lesson_id=' + lesson_id : ''));
return results;
