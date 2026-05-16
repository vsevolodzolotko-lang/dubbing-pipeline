# Adaptation Shorten Prompt — Synthesize fallback

**Version:** 1.0
**Used by:** W3 Check Timing + Pad (Synthesize), single-segment shorten loop

Not to be confused with `prompts/adaptation.md`, which is the W2 multi-language adapt during Translate. This prompt fires only inside Synthesize when the initial TTS for one segment × one language exceeded its `effective_slot`.

---

## When called

After initial TTS at speed 1.0, when `real_duration_sec > effective_slot` (i.e., breath-borrow couldn't absorb the overrun). Called up to 3 times per segment × lang with escalating attempt levels. Between each call: re-TTS at speed 1.0, re-measure, re-check.

## Inputs

- `original_en` — the EN source text for this segment
- `current_translation` — the current `{lang}` translation that produced TTS too long for `effective_slot`
- `target_chars` — calculated from `effective_slot × LANG_CPS[lang]`
- `attempt_level` — 1 (light), 2 (medium), 3 (max)
- `lang` — target lang code (e.g. `de`)
- `tov_content` — the full ToV text from config sheet

---

## System prompt

```
You are shortening a translated meditation/wellness script segment to fit a tight audio time slot.

The current translation produced TTS audio that exceeds the available slot by a small margin. Your job: shorten the translation just enough to fit, while preserving meaning and tone.

ORIGINAL EN: {original_en}
CURRENT TRANSLATION ({lang}): {current_translation}
TARGET LENGTH: ~{target_chars} characters
ATTEMPT LEVEL: {attempt_level} — {attempt_description}

ATTEMPT LEVEL DESCRIPTIONS:
- Level 1 (light): Remove filler words, contractions, redundancies. Keep all meaning.
- Level 2 (medium): Rephrase for compactness. May drop redundant qualifiers but keep all content.
- Level 3 (max): Compress to essential meaning only. May drop secondary context but preserve core message.

TONE OF VOICE:
{tov_content}

RULES:
1. Stay close to target length (within ±10%)
2. Maintain ToV warmth and rhythm
3. Preserve any ellipsis (...) or em-dash (—) timing markers
4. Never add new filler ("really", "very", etc.) — those break tone
5. Use natural language structures for {lang}
6. Preserve negations ("no", "not", "without", "never") and contrasts ("A, not B") exactly
7. Preserve specific nouns, named techniques, numbers, proper names

OUTPUT: ONLY the shortened translation text. No commentary, no explanation, no quotes.
```

---

## Length floor

Code-side check: if Claude returns text shorter than 60% of `current_translation.length`, reject the output and keep the previous (longer) version. Prevents over-aggressive compression that drops concepts despite the prompt instructions.

---

## Output spec

Single line of `{lang}` text. No JSON, no markdown, no surrounding quotes, no commentary. The Code node consumes the raw output, re-runs TTS at speed 1.0, and re-checks `real_duration_sec` vs `effective_slot`.
