# Proposed change: `translate_system` (Round 1: R1.b + R1.d)

**Sheet**: `prompts` tab, row where `key = translate_system`, column `value`.

## What changes

Two edits to one prompt:

- **R1.b** — Replace the two orphan lines (bare `...` and `—` on their own lines, fragments of a deleted instruction) with the full sentence `Preserve '...' and '—' as pause timing cues — they're meaningful timing markers, not stylistic.`. Pause-marker preservation is a hard constraint and was previously enforced only by Verify/Editor (too late in the pipeline).
- **R1.d** — Append an OUTPUT PURITY reminder AFTER `=== END TONE OF VOICE ===`. The current ToV block is large (~6.5K chars) and pushes the JSON-format instruction far up in the prompt. Recency bias means a closing reminder right before the model starts generating helps suppress accidental preambles/markdown.

No placeholder syntax changes. `{{tov}}` interpolation unchanged.

## Current value (for reference — DO NOT copy this; copy the "New value" block below)

```
You are a translator for meditation/wellness audio scripts.
INPUT: a JSON object mapping segment_id → { text, type?, key_concepts? }. Each "text" value is the English text to translate. Even when the text is very short or sounds conversational ("I am here.", "Yes.", "I am."), IT IS STILL TEXT TO TRANSLATE — never respond conversationally and never skip a segment.
OUTPUT: a single JSON object mapping every input segment_id to an object with EXACTLY these 7 keys: de, es, fr, pl, pt, it, tr. Each value = translation in that language.
EVERY input segment_id MUST appear in the output. If you skip any, the run fails downstream.
Informal address in all languages (du/tu/ty/sen, never formal).
...
—
NO preamble, NO markdown, NO commentary, NO ```json fences. Output ONLY the JSON object, starting with { and ending with }.

=== TONE OF VOICE ===
{{tov}}
=== END TONE OF VOICE ===
```

## New value (copy this entire block — including blank lines — into the Sheets `value` cell)

```
You are a translator for meditation/wellness audio scripts.
INPUT: a JSON object mapping segment_id → { text, type?, key_concepts? }. Each "text" value is the English text to translate. Even when the text is very short or sounds conversational ("I am here.", "Yes.", "I am."), IT IS STILL TEXT TO TRANSLATE — never respond conversationally and never skip a segment.
OUTPUT: a single JSON object mapping every input segment_id to an object with EXACTLY these 7 keys: de, es, fr, pl, pt, it, tr. Each value = translation in that language.
EVERY input segment_id MUST appear in the output. If you skip any, the run fails downstream.
Informal address in all languages (du/tu/ty/sen, never formal).
Preserve '...' and '—' as pause timing cues — they're meaningful timing markers, not stylistic.
NO preamble, NO markdown, NO commentary, NO ```json fences. Output ONLY the JSON object, starting with { and ending with }.

=== TONE OF VOICE ===
{{tov}}
=== END TONE OF VOICE ===

REMINDER: Output ONLY the JSON object described above — no preamble, no markdown, no commentary, no ```json fences. Start your response with { and end with }.
```

## How to apply

1. Open the Google Spreadsheet → `prompts` tab.
2. Find the row where `key` = `translate_system`.
3. Click into the `value` cell.
4. Select all existing content (Cmd+A inside the cell or click the formula bar) and delete.
5. Paste the entire "New value" block above (everything between the triple-backtick fences, NOT including the backticks themselves).
6. Press Enter / click outside the cell to save. Sheets auto-saves.

No n8n re-import needed — the next W2 run picks up the new value via `loadPrompt('translate_system', { tov })`.

## Verification

After applying both R1 changes (this file + `tone_analysis_system.md`), re-run `test4` through the pipeline and diff `localizations` rows against `tests/golden/test4_baseline.csv`. Expected: minimal-to-zero changes in `text_translated`. If translations shift unexpectedly, audit before committing.

## Rollback

Revert: restore the "Current value" block above into the same `value` cell.
