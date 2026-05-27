// Merges tone analysis from one or more batched Claude responses — emits per-segment items.
const merged = {};
for (const item of $input.all()) {
  try {
    let raw = item.json.content?.[0]?.text?.trim() || '{}';
    raw = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) { console.error('Parse Tone Map: no JSON in batch response'); continue; }
    const batchMap = JSON.parse(match[0]);
    Object.assign(merged, batchMap);
  } catch (e) {
    console.error('Parse Tone Map: parse failed for one batch:', e.message);
  }
}
if (Object.keys(merged).length === 0) throw new Error('Tone analysis returned empty results across all batches');
return Object.entries(merged).map(([segment_id, meta]) => ({
  json: { segment_id, segment_type: meta.segment_type || 'narrative', movement_keywords: meta.movement_keywords || '', key_concepts: meta.key_concepts || '' }
}));
