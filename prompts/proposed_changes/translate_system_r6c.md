# Proposed change: `translate_system` (Round 6: R6.c.2 — cross-segment consistency)

**Sheet**: `prompts` tab, row where `key = translate_system`, column `value`.

## What changes — and why

R4 evaluation on `the_anchor` revealed a NEW class of issue Gemini flagged:

- IT seg_019 (EN: "I am enough") → "**Vado bene così.**" (idiomatic, perfect)
- IT seg_020 (EN: "I am enough" — same EN) → "**Io sono sufficiente.**" (literal calque, breaks mantra pattern)
- IT seg_021 (EN: "I am enough" — same EN) → "**Vado bene così.**" (idiomatic again)

When the same English text appears in multiple segments — a mantra effect by design — the translations must be IDENTICAL per language. Currently neither `translate_system` nor `qa_verify_system` enforces this. The translator hits each segment with fresh context and picks whatever feels best, breaking pattern.

Adds one CONSISTENCY rule to `translate_system` so the first-pass translator self-enforces this. (Verify also gets a complementary rule in `qa_verify_system_r6c.md`.)

Caveat: this works reliably ONLY when all repeated segments land in the same batch (BATCH_SIZE=8 in `Prepare and Expand`). For very long lessons with mantras across batches, a deterministic post-pass would be needed — out of scope for R6.c.

## What stays the same

All R1 + R4 changes preserved (pause-marker rule, output-purity reminder, ToV interpolation). Only ONE new instruction line added near the existing CONSISTENCY-adjacent rules.

## New value (copy this entire block into the Sheets `value` cell)

```
You are a translator for meditation/wellness audio scripts.
INPUT: a JSON object mapping segment_id → { text, type?, key_concepts? }. Each "text" value is the English text to translate. Even when the text is very short or sounds conversational ("I am here.", "Yes.", "I am."), IT IS STILL TEXT TO TRANSLATE — never respond conversationally and never skip a segment.
OUTPUT: a single JSON object mapping every input segment_id to an object with EXACTLY these 7 keys: de, es, fr, pl, pt, it, tr. Each value = translation in that language.
EVERY input segment_id MUST appear in the output. If you skip any, the run fails downstream.
Informal address in all languages (du/tu/ty/sen, never formal).
Preserve '...' and '—' as pause timing cues — they're meaningful timing markers, not stylistic.
CONSISTENCY: When the same English text appears in multiple input segments (e.g. a repeated mantra "I am enough" across seg_019, seg_020, seg_021), produce the SAME translation in each target language for every occurrence. Mantras and repeated affirmations must be perfectly consistent across segments — varying the wording breaks the mantra effect.
NO preamble, NO markdown, NO commentary, NO ```json fences. Output ONLY the JSON object, starting with { and ending with }.

=== TONE OF VOICE ===
{{tov}}
=== END TONE OF VOICE ===

REMINDER: Output ONLY the JSON object described above — no preamble, no markdown, no commentary, no ```json fences. Start your response with { and end with }.
```

## How to apply

1. Open Google Spreadsheet → `prompts` tab → row `translate_system` → `value` cell.
2. Select all existing content, delete.
3. Paste the entire "New value" block.
4. Press Enter to save.

## Verification

Test on `test_r6c` mini-lesson. Create 3 test segments all with EN "I am enough" (test_r6c_seg_003/004/005). After W2 runs:
- IT translations for all 3 segments should be IDENTICAL.
- Same for PL, ES, DE, FR, PT, TR — each language consistent across the 3.

## Rollback

Restore prior R4-era value from `sheets/prompts.tsv` row `translate_system`.
