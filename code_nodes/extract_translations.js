// Parses batched Claude response → emits one item per segment.
// Each batch's Claude reply is a JSON object: { segment_id: { de, es, fr, pl, pt, it, tr }, ... }.
//
// R3.a: dropped segments (translator silently missed them) cause a hard throw
// at end of processing with full segment_id list. This is the defense against
// the silent-drop bug class that bit us on test4_seg_002. Re-run W2 to recover.
const REQUIRED_LANGS = ['de', 'es', 'fr', 'pl', 'pt', 'it', 'tr'];
const preparedItems = $('Prepare and Expand').all();
const claudeItems = $input.all();
const results = [];
const dropped = [];
const partial = [];

for (let i = 0; i < claudeItems.length; i++) {
  const claudeResp = claudeItems[i].json;
  const batchSegments = preparedItems[i]?.json?.batch_segments || [];
  const batchIdx = preparedItems[i]?.json?.batch_index ?? i;

  let batchTranslations = {};
  try {
    let text = claudeResp.content?.[0]?.text?.trim() || '{}';
    text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const match = text.match(/\{[\s\S]*\}/);
    if (match) batchTranslations = JSON.parse(match[0]);
  } catch(e) {
    console.error(`Extract Translations: parse error on batch ${batchIdx}: ${e.message}`);
  }

  for (const seg of batchSegments) {
    const translations = batchTranslations[seg.segment_id] || {};
    const filled = REQUIRED_LANGS.filter(l => translations[l] && translations[l].trim());
    if (filled.length === 0) {
      console.error(`Extract Translations: ${seg.segment_id} — empty/missing in batch ${batchIdx}.`);
      dropped.push(seg.segment_id);
      continue;
    }
    if (filled.length < REQUIRED_LANGS.length) {
      const missing = REQUIRED_LANGS.filter(l => !filled.includes(l));
      console.warn(`Extract Translations: ${seg.segment_id} missing langs: ${missing.join(',')}`);
      partial.push({ segment_id: seg.segment_id, missing });
    }
    results.push({ json: {
      segment_id:      seg.segment_id,
      en_text:         seg.en_text || '',
      en_duration_sec: seg.en_duration_sec || 0,
      de_text: translations.de || '',
      es_text: translations.es || '',
      fr_text: translations.fr || '',
      pl_text: translations.pl || '',
      pt_text: translations.pt || '',
      it_text: translations.it || '',
      tr_text: translations.tr || '',
    }});
  }
}

if (dropped.length > 0) {
  const partialNote = partial.length ? ` Partial: ${partial.map(p => p.segment_id + '(' + p.missing.join(',') + ')').join('; ')}.` : '';
  throw new Error(`Translator dropped ${dropped.length} segment(s) from output: ${dropped.join(', ')}. Re-run W2 to recover.${partialNote}`);
}
return results;
