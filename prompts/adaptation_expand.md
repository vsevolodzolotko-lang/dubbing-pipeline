# Adaptation Expand Prompt — Synthesize over-shortening recovery

**Version:** 1.0
**Used by:** W3 Check Timing + Pad (Synthesize), expansion loop

Companion to `prompts/adaptation_shorten.md`. While `shorten` fires when TTS is too long, this prompt fires when TTS came out too short — usually because W2 over-adapted the translation based on CPS estimate that turned out conservative.

---

## When called

After initial TTS (and any breath-borrow / shorten loop) settled the audio, when `real_duration_sec < en_duration_sec × expansion_threshold` (default 0.85). Called up to 2 times per segment × lang. Between each call: re-TTS at speed 1.0, re-measure.

If a call produces overshoot (`real > effective_slot`), revert to the previous (shorter, but in-budget) translation. No further expansion attempts for that segment.

## Inputs

- `original_en` — the EN source text for this segment
- `current_translation` — the over-shortened `{lang}` translation
- `target_chars` — calculated from `en_duration_sec × LANG_CPS[lang]`
- `lang` — target lang code
- `tov_content` — the full ToV text from config sheet

---

## System prompt

```
You are expanding a previously-shortened translation to fit a longer audio slot.

The current translation was shortened earlier, but TTS output is now too short — creating awkward silence in the dubbed audio. Your job: restore meaningful content while keeping the brand tone intact.

ORIGINAL EN: {original_en}
CURRENT (SHORTENED) TRANSLATION ({lang}): {current_translation}
TARGET LENGTH: ~{target_chars} characters

TONE OF VOICE:
{tov_content}

RULES:
1. Restore meaningful content that was likely cut, especially context-setting phrases or qualifiers
2. Do NOT add filler ("really", "very", "kind of") — those break meditative tone
3. Do NOT artificially repeat or rephrase the same idea
4. Stay close to target length (within ±10%)
5. Preserve ToV: warm, knowing-friend tone
6. Natural language structures for {lang}
7. Preserve negations and contrasts from the English source — if EN says "no extra tools, only fingertips" the translation must keep both halves of that idea
8. Preserve specific nouns, named techniques, numbers, proper names from the English source

OUTPUT: ONLY the expanded translation. No commentary, no explanation, no quotes.
```

---

## Length sanity

Code-side check: the expansion should produce text longer than `current_translation` but not absurdly long. If Claude returns text shorter than the input or longer than `target_chars × 1.5`, reject the output and stop the expansion loop for this segment.

---

## Output spec

Single line of `{lang}` text. No JSON, no markdown, no surrounding quotes, no commentary. The Code node consumes the raw output, re-runs TTS at speed 1.0, and re-checks. If overshoot → revert; otherwise → write the new translation back and continue.
