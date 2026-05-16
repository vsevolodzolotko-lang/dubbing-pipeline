// Parses the Claude tone analysis response into one item per segment.
//
// Input:  single Claude API response item
// Output: array of items, one per segment_id, with tone metadata fields:
//           segment_id, segment_type, movement_keywords, key_concepts
//
// These items are used two ways:
//   1. Written to Sheet via "Update Tone Columns" Sheets node
//   2. Referenced by "Prepare and Expand" via $('Parse Tone Map').all()

let toneMap = {};
try {
  let text = $input.first().json.content?.[0]?.text?.trim() || '{}';
  text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const match = text.match(/\{[\s\S]*\}/);
  if (match) toneMap = JSON.parse(match[0]);
} catch (e) {
  throw new Error('Failed to parse tone analysis JSON: ' + e.message);
}

if (Object.keys(toneMap).length === 0) {
  throw new Error('Tone analysis returned empty result — check Claude response');
}

return Object.entries(toneMap).map(([segment_id, meta]) => ({
  json: {
    segment_id,
    segment_type:      meta.segment_type      || 'narrative',
    movement_keywords: meta.movement_keywords || '',
    key_concepts:      meta.key_concepts      || '',
  },
}));
