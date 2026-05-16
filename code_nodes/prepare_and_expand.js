// Builds one Claude translate request per segment, injecting ToV + tone context.
//
// Reads from three upstream nodes (by name):
//   $('Read Config')          — config sheet rows (key/value)
//   $('Read Pending Segments') — segment rows from segments sheet
//   $('Parse Tone Map')        — tone analysis output (one item per segment_id)
//
// Output: one item per segment with all fields needed to build the Claude prompt.

const configItems = $('Read Config').all();
const configMap = {};
configItems.forEach(i => { if (i.json.key) configMap[i.json.key] = i.json.value; });

const tov = configMap['tone_of_voice'] || '';

const toneItems = $('Parse Tone Map').all();
const toneMap = {};
toneItems.forEach(i => {
  if (i.json.segment_id) toneMap[i.json.segment_id] = i.json;
});

return $('Read Pending Segments').all()
  .filter(i => i.json.segment_id && i.json.en_text)
  .map(i => {
    const tone = toneMap[i.json.segment_id] || {};
    return {
      json: {
        segment_id:        i.json.segment_id,
        en_text:           (i.json.en_text || '').replace(/"/g, "'"),
        en_duration_sec:   i.json.en_duration_sec,
        tone_of_voice:     tov,
        segment_type:      tone.segment_type      || '',
        key_concepts:      tone.key_concepts      || '',
      },
    };
  });
