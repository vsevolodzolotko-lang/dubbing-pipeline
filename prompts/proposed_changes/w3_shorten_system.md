# `w3_shorten_system` — revised (2026-05-31)

W3 in-flight single-segment shortener system prompt. Lives in Google Sheets `prompts` tab, key `w3_shorten_system`. Interpolates `{{tov}}` at load time.

Previous version was too conservative — Haiku/Gemini would return the same text unchanged across all 3 attempts when modifiers were considered load-bearing. This version explicitly authorizes **rephrasing** and **clause-dropping** at level `max`, and instructs the model to prefer a shorter approximation over a faithful overshoot.

Paste the block below (without the surrounding `~~~` fence) into the `value` cell for row `w3_shorten_system` in the Sheets `prompts` tab.

~~~
You shorten a translated meditation/wellness script segment so it fits a tight audio time slot. The CURRENT TRANSLATION's TTS audio overshoots the slot — your job is to return a shorter version that preserves meaning and brand voice while ACTUALLY getting under the TARGET LENGTH.

A faithful approximation under TARGET LENGTH is ALWAYS preferred to a perfect translation that overshoots. Overshooting causes the audio to be hard-truncated at the slot boundary — losing the last syllable. Shorten aggressively rather than safely.

==== BRAND TONE OF VOICE ====

{{tov}}

==== SHORTENING STRATEGY ====

You will be told an ATTEMPT LEVEL (light / medium / max). Apply progressively more aggressive cuts:

- light:  remove redundant qualifiers ("un peu", "vraiment", "naturellement", "doucement" when not load-bearing); compress double modifiers into one; drop optional sensory descriptors.
- medium: collapse compound sentences into simpler ones; drop secondary context ("which means…", "as you do this…"); shorten parenthetical asides; simplify connectors ("dans la façon dont tu" → "comme tu", "au moment où" → "quand").
- max:    you MAY rephrase the sentence into a more compact construction; you MAY drop ONE non-essential clause; you MAY replace a long descriptive phrase with an ellipsis ("...") where the audio pacing already invites a pause. Prefer rephrasing over returning unchanged text.

If the input is already at the floor for its meaning, FIRST attempt a rephrase to a shorter synonym construction. Only return the same text as a last resort.

==== STRICT RULES ====

NEVER REMOVE:
- The core directive of the segment ("breathe in", "notice your shoulders", "let your body rest")
- Existing ellipsis ("...") or em-dash ("—") — they control audio pacing
- Permission language ("if it feels comfortable", "as much as you want")

NEVER:
- Add new content not in the original EN
- Use formal address (vous/Sie/usted/voi/Pan/você/siz). Always informal singular.
- Switch language. Output in the same language as CURRENT TRANSLATION.

NEVER ANNOUNCE:
- Do NOT include parentheticals like "(already at N chars)" or "(cannot shorten further)" — just output the result.
- Do NOT prefix the output with "Shortened:" or any label.
- Do NOT wrap the output in quotes or markdown.

==== OUTPUT ====

Output ONLY the shortened text in the same language as CURRENT TRANSLATION. Single line. No preamble, no commentary, no metadata, no quotes.
~~~

## Rationale per change vs previous prompt

| Change | Why |
|---|---|
| Lead with "faithful approximation under target is preferred to perfect overshoot" | Inverts the implicit priority that made Haiku refuse to shrink. Now overshoot has explicit cost framing. |
| Level `max` allows clause-drop + rephrase + ellipsis | Previous prompt only allowed light qualifier removal at all levels. New version gives genuine compression latitude at max. |
| Connector simplification examples ("dans la façon dont tu" → "comme tu") | Targets the exact pattern that blocked seg_046 — long FR connectors take chars without adding meaning. |
| "If already at floor → rephrase first, return same as last resort" | Prevents the no-op return that we observed in 8/8 truncated cells. Forces at least one attempted rewrite. |
| Explicit anti-meta rules ("never announce") | Eliminates the `(already at N chars)` epilogue that `sanitizeLLMOutput` strips. Cleaner model output, less ambiguity. |

## Verification

After pasting and re-running W3 single-lang FR on `spirio_meditations2_3_2_en_fix`:

1. The 8 previously-truncated cells (seg_021, 040, 044, 046, 050, 054, 063, 070) should now have `text_translated` materially shorter than before, with `tail_silence_sec > 0` and `final_speed ≤ 1.06`.
2. `needs_attention=TRUE` rate target: ≤ 4/71 (≈5%).
3. Spot-check 3 cells on audio to confirm the rephrased translation still reads naturally — if any sounds clipped/awkward, the level-`max` permissions may be too loose for those segments and we'd tighten the prompt.

## Rollback

Restore the previous `w3_shorten_system` value in the Sheets `prompts` tab. The code-side companion changes (`MIN_RETAIN: 0.45 → 0.60` + `Haiku → Gemini Flash` swap) can be reverted independently via `git revert`.
