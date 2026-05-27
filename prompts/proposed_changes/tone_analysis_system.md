# Proposed change: `tone_analysis_system` (Round 1: R1.c)

**Sheet**: `prompts` tab, row where `key = tone_analysis_system`, column `value`.

## What changes

**R1.c** — Strengthen the output-purity guard. The current prompt is a single dense sentence that mentions "Return ONLY a JSON object" and "No markdown, no preamble" mid-sentence. Splitting the output instruction into its own paragraph (with explicit anchors: start with `{`, end with `}`, no ```json fences) makes it harder for the model to slip into preamble/markdown mode.

Defense-in-depth: the W2 `Parse Tone Map` Code node will get markdown-fence stripping in R2 anyway, but prompt-side enforcement reduces the chance we need to lean on the strip.

## Current value (for reference)

```
Classify each wellness/meditation segment. Return ONLY a JSON object where each key is segment_id and value has: segment_type (narrative|instruction|movement), movement_keywords (comma-sep if movement, else empty string), key_concepts (2-4 comma-sep themes). No markdown, no preamble. Every input segment_id MUST appear in the output.
```

## New value (copy this entire block into the Sheets `value` cell)

```
Classify each wellness/meditation segment. For every segment, output:
- segment_type: one of narrative | instruction | movement
- movement_keywords: comma-separated list of movement cues if segment_type is "movement", else empty string
- key_concepts: 2-4 comma-separated themes

Every input segment_id MUST appear in the output.

OUTPUT FORMAT: Output ONLY a JSON object mapping segment_id → { segment_type, movement_keywords, key_concepts }. No preamble, no markdown, no commentary, no ```json fences. Start your response with { and end with }.
```

## How to apply

1. Open the Google Spreadsheet → `prompts` tab.
2. Find the row where `key` = `tone_analysis_system`.
3. Click into the `value` cell.
4. Select all existing content and delete.
5. Paste the entire "New value" block above (between the triple-backtick fences, not including the backticks).
6. Press Enter to save.

No n8n re-import needed.

## Verification

After applying both R1 changes (this file + `translate_system.md`), re-run `test4` through the pipeline. The `segments` tab will get fresh `segment_type` / `movement_keywords` values. These should match the previous run's classification (or be obviously equivalent — e.g., "calm, breath" vs "breath, calm").

If `segment_type` flips between `narrative`/`instruction`/`movement` for the same EN text → investigate before committing.

## Rollback

Restore the "Current value" block above into the same `value` cell.
