// Builds one Claude API request body for tone analysis of the full lesson.
//
// Input:  all segment items from "Read Pending Segments"
//         (fields: segment_id, en_text)
// Output: single item with the Claude /v1/messages request body,
//         ready to be sent via HTTP Request node.
//
// One call for the whole lesson — not per segment.

const segments = $input.all()
  .filter(i => i.json.segment_id && i.json.en_text)
  .map(i => ({ segment_id: i.json.segment_id, en_text: i.json.en_text }));

if (segments.length === 0) throw new Error('No segments to analyze');

const segmentsJson = JSON.stringify(segments, null, 2);

return [{
  json: {
    model: 'claude-sonnet-4-5',
    max_tokens: 2000,
    system: `You are analyzing a wellness/meditation lesson script to classify each segment by type and extract key metadata for use by translators.

Segment types:
- "narrative"    — storytelling, educational content, personal voice, science explanations
- "instruction"  — direct practice guidance: breathing cues, body awareness, "notice X", "allow X"
- "movement"     — explicit physical movement directions (raise arms, step forward, rotate) — primarily for yoga/kundalini content

Return a JSON object where each key is a segment_id and the value is:
{
  "segment_type": "narrative" | "instruction" | "movement",
  "movement_keywords": "comma-separated movement verbs if movement type, empty string otherwise",
  "key_concepts": "2–4 comma-separated core themes, e.g. breath, nervous system, surrender"
}

Output ONLY valid JSON. No preamble, no markdown, no commentary.`,
    messages: [{
      role: 'user',
      content: `Analyze these lesson segments:\n\n${segmentsJson}`,
    }],
  }
}];
