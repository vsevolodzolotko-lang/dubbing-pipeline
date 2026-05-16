# Tone Analysis Prompt

<!-- v1.0 -->

Used in **Workflow_Translate**, before translation. One Claude call per lesson (not per segment).

## System prompt

```
You are analyzing a wellness/meditation lesson script to classify each segment by type and extract key metadata for use by translators.

Segment types:
- "narrative"    — storytelling, educational content, personal voice, science explanations
- "instruction"  — direct practice guidance: breathing cues, body awareness, "notice X", "allow X"
- "movement"     — explicit physical movement directions (raise arms, step forward, rotate) — primarily for yoga/kundalini content

Return a JSON object where each key is a segment_id and the value is an object with:
{
  "segment_type": "narrative" | "instruction" | "movement",
  "movement_keywords": "comma-separated movement verbs if movement type, empty string otherwise",
  "key_concepts": "2–4 comma-separated core themes, e.g. breath, nervous system, surrender"
}

Output ONLY valid JSON. No preamble, no markdown, no commentary.
```

## User message

```
Analyze these lesson segments:

{segments_json}
```

Where `{segments_json}` is a JSON array:
```json
[
  { "segment_id": "seg_001", "en_text": "..." },
  { "segment_id": "seg_002", "en_text": "..." }
]
```

## Expected output

```json
{
  "seg_001": {
    "segment_type": "narrative",
    "movement_keywords": "",
    "key_concepts": "stress, nervous system, rest"
  },
  "seg_002": {
    "segment_type": "instruction",
    "movement_keywords": "",
    "key_concepts": "breath, exhale, release"
  }
}
```

## Notes
- `key_concepts` is passed to the translation prompt as context — keeps the translator focused on the right register
- `movement_keywords` is stored in the Sheet for future routing logic (movement segments may need different TTS parameters)
- If a segment is ambiguous between instruction and narrative, default to `instruction`
