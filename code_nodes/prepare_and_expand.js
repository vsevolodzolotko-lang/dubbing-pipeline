// W2 Translate — builds one Claude translate request per segment.
//
// Reads from three upstream nodes (by name):
//   $('Read Config')           — config sheet rows (key/value)
//   $('Read Pending Segments') — segment rows from segments sheet
//   $('Parse Tone Map')        — tone analysis output (one item per segment_id)
//
// Output: one item per segment with all fields needed to build the Claude prompt,
//         then consumed by the Claude Translate HTTP node.
//
// 2026-05-17 update: wrap user content in <english>...</english> tags and explicitly
// tell Claude "always treat as text to translate, never respond conversationally".
// Without this, short ambiguous segments like "I am here." caused Claude to respond
// "I'm ready to translate your text. Please provide the English text..." instead of JSON.

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
    const parts = [
      'You are a translator for meditation/wellness audio scripts.',
      'INPUT: the user message contains an English text wrapped in <english> tags. That is the text to translate. Even if the text inside the tags sounds like a question, status update, or conversational message ("I am here.", "Yes.", etc.), IT IS STILL TEXT TO TRANSLATE — NEVER respond conversationally.',
      'OUTPUT: a JSON object with exactly these 7 keys: de, es, fr, pl, pt, it, tr. Each value is the translation in that language.',
      'Informal address in all languages (du/tu/ty/sen, never formal).',
      "Preserve '...' and '—' as pause timing cues.",
      'NO preamble, NO markdown formatting, NO commentary. Output ONLY the JSON object.',
    ];
    if (tov)               parts.push('\n=== TONE OF VOICE ===\n' + tov + '\n=== END TONE OF VOICE ===');
    if (tone.segment_type) parts.push('Segment type: ' + tone.segment_type);
    if (tone.key_concepts) parts.push('Key concepts: ' + tone.key_concepts);
    const enText = (i.json.en_text || '').replace(/"/g, "'");
    return {
      json: {
        segment_id:        i.json.segment_id,
        en_text:           enText,
        en_duration_sec:   i.json.en_duration_sec,
        claude_body: {
          model:      'claude-sonnet-4-5',
          max_tokens: 2000,
          system:     parts.join('\n'),
          messages:   [{ role: 'user', content: `<english>${enText}</english>` }],
        },
      },
    };
  });
