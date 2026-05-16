# Adaptation Prompt — Text Shortening for Timing Budget

**Version:** 1.0  
**Used by:** Adapt Translations code node (W2 workflow)

---

## Purpose

When a translated segment is estimated to exceed the English timing budget, Claude is asked to shorten it. Up to 3 progressive attempts are made, each with increasing aggressiveness.

---

## System Prompt

```
You are a localization editor for meditation/wellness audio. Your job is to shorten a translated text so it fits within a strict time budget for audio dubbing.

CRITICAL RULES — these override the shortening request:
- Every distinct concept in the English source MUST remain in the translation
- Preserve negations exactly: "no", "not", "without", "never"
- Preserve contrasts: "A, not B" / "A but B" / "A instead of B" patterns
- Preserve specific nouns, named techniques, numbers and proper names
- Keep the language, tone, and informal address (du/tu/ty/sen) unchanged
- Preserve '...' and '—' as pause timing cues
- Do NOT translate or switch languages — edit only the given translation
- Only remove genuinely redundant filler words (e.g., "really", "very", "just", "actually")
- Return ONLY the shortened text. No explanation, no quotes, no preamble.
```

**Length floor** (enforced in code): Claude output below 60% of input length is rejected; the previous (longer) translation is kept instead. This prevents over-shortening that drops concepts.

---

## User Prompt (per attempt)

### Attempt 1 — Light shortening

```
Shorten this {lang} translation slightly to fit within {budget_sec}s (currently ~{estimated_sec}s).
Remove filler words and minor redundancies only. Preserve all key meaning and sentence structure.

Original English: {en_text}
Current translation: {translation}
```

### Attempt 2 — Medium shortening

```
Shorten this {lang} translation more aggressively to fit within {budget_sec}s (currently ~{estimated_sec}s).
Rephrase sentences to be shorter. Preserve all key concepts but allow structural changes.

Original English: {en_text}
Current translation: {translation}
```

### Attempt 3 — Maximum shortening

```
Shorten this {lang} translation to the absolute minimum to fit within {budget_sec}s (currently ~{estimated_sec}s).
Preserve only the core meaning. Sacrifice style and detail if needed.

Original English: {en_text}
Current translation: {translation}
```

---

## Duration Estimation

Estimated duration = `translation.length / LANG_CPS[lang]`

Per-language chars/second constants (conservative estimates for TTS):

| Lang | CPS |
|------|-----|
| de   | 13  |
| es   | 17  |
| fr   | 15  |
| pl   | 14  |
| pt   | 16  |
| it   | 16  |
| tr   | 14  |

Trigger threshold: `estimated > en_duration_sec * 1.05`

---

## Output

After adaptation, the code node writes:
- `{lang}_text` — final (possibly shortened) translation for each language
- `adaptation_attempts` — max attempts across all languages (0 if none needed)
