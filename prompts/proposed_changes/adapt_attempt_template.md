# Proposed change: new `adapt_attempt_template` row (Round 6.a — DRY merge)

**Sheet**: `prompts` tab — **ADD a new row** with key `adapt_attempt_template`. The 3 existing rows (`adapt_attempt_light`, `adapt_attempt_medium`, `adapt_attempt_max`) become dead code after this round; keep them as rollback backups for 1-2 weeks, then optionally delete.

## What changes — and why

The 3 current `adapt_attempt_*` rows differ in only ONE sentence (the shortening-strategy descriptor). The rest — slot/budget/text frame — is identical:

```
Shorten this {{lang}} translation [DIFFERENT WORDS] to fit within {{budget}}s (currently ~{{est}}s).
[DIFFERENT STRATEGY SENTENCE].
Minimum allowed length: {{min_chars}} characters.

Original English (preserve all concepts): {{en}}
Current translation: {{trans}}
```

Maintaining 3 copies of essentially the same template is a maintenance hazard — change one, forget the other two. R6.a merges them into a single `adapt_attempt_template` with a new `{{aggression}}` placeholder. The 3 attempt-level strategy descriptors move into the Adapt Translations Code node as a 3-element array indexed by attempt counter.

Pure refactor — no behavioral change. Each attempt loop iteration produces the same prompt text it did before, just rendered from a unified template.

## How to apply

### Step 1 — add new row to `prompts` sheet

In Google Sheets → `prompts` tab → at the bottom (or anywhere), add a NEW row with these 3 columns:

**key:**
```
adapt_attempt_template
```

**description:**
```
W2 Adapt Translations — user-message template (R6.a unified). Single template replaces adapt_attempt_{light,medium,max}. Placeholders: {{lang}} {{budget}} {{est}} {{en}} {{trans}} {{min_chars}} {{aggression}}. The aggression descriptor is supplied by the Code node based on attempt level (0=light, 1=medium, 2=max).
```

**value:** (copy this entire block between the triple-backticks)
```
Shorten this {{lang}} translation to fit within {{budget}}s (currently ~{{est}}s).
{{aggression}}
Minimum allowed length: {{min_chars}} characters.

Original English (preserve all concepts): {{en}}
Current translation: {{trans}}
```

### Step 2 — re-import W2_Translate_v2.json into n8n

The Adapt Translations Code node has been updated to use the new template. Re-import the workflow so n8n picks up the new code.

### Step 3 — keep old rows for rollback

DO NOT delete `adapt_attempt_light`, `adapt_attempt_medium`, `adapt_attempt_max` rows yet. They're dead data after R6.a (no code calls them) but serve as rollback backup. Delete after 1-2 weeks of stable operation if you want a clean sheet.

## Verification

Same `test_r6c` mini-lesson works (or just run `test4` through W2 only). Adapt only fires if translations are over budget — so the easiest check is:

1. Run W2 on any lesson with at least one tight slot (e.g. test4_seg_001 or the_anchor mantras).
2. Check `segments` sheet for `*_adaptation_attempts > 0` rows.
3. Translations there should be reasonable shortenings, no different from pre-R6.a behavior.
4. Visually inspect for any meta-commentary leak (`(N chars)`, "Wait", etc.) — should be absent (same as before).

## What stays the same

- `adapt_shorten_system` (R6.c CRITICAL TRAPS section preserved as system prompt).
- All 7 langs, all attempt counts (still 3 attempts max per lang per segment).
- Shortening behavior at each level (Code node passes same strategy descriptors).

## Rollback

If R6.a regresses anything:
1. Revert `Adapt Translations` Code node to use `loadPrompt('adapt_attempt_light/medium/max', ...)` (git checkout the pre-R6.a version of `workflows/W2_Translate_v2.json`).
2. Re-import workflow.
3. The 3 old `adapt_attempt_*` sheet rows are still there (untouched) — no sheet action needed.
