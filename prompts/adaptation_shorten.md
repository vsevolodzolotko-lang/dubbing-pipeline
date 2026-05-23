# Adaptation Shorten Prompt

Single-segment text shortening when TTS output exceeds the available time slot AFTER initial Translate has already adapted.

## When called

By Synthesize workflow when `real_duration_sec > effective_slot_sec` (en_duration + max_borrowable). Called as fallback before speed adjustment.

## Prompt template

```
You are shortening a translated meditation/wellness script segment to fit a tight audio time slot.

The current translation produces TTS audio that exceeds the available slot. Your job: shorten just enough to fit, while preserving meaning, tone, and ToV authenticity.

==== INPUTS ====

ORIGINAL EN TEXT:
{original_en}

CURRENT TRANSLATION in {lang}:
{current_translation}

CURRENT LENGTH: {current_chars} characters
TARGET LENGTH: ~{target_chars} characters (need to remove ~{chars_to_remove} characters)
ATTEMPT LEVEL: {attempt_level}

- Level 1 (light): Remove redundant qualifiers. Keep all meaning.
- Level 2 (medium): Compress complex sentences into simpler ones. Drop secondary context.
- Level 3 (max): Preserve only core message. May drop one full clause if needed.

==== BRAND TONE OF VOICE ====

{tov_content}

==== SHORTENING STRATEGY (ToV section 12.4) ====

Remove in this order:

1. Redundant qualifiers and adverbs ("very", "really", "quite", "naturally", "gently" — but only when not essential)
2. Compound sentences → split into simpler shorter ones
3. Secondary context phrases ("which means…", "as we know…", "in other words…")
4. Optional sensory descriptors if essential meaning carries
5. ONLY at Level 3: drop one full subordinate clause if needed

==== STRICT RULES ====

NEVER REMOVE:
- Ellipsis (`...`) or em-dash (`—`) markers — those control audio pacing
- Core directive ("breathe in", "notice your shoulders")
- Permission language ("if it feels comfortable") — this IS Spirio voice
- Inviting modifiers — see ToV section 3

NEVER ADD:
- New content not in original
- Filler words
- Formal address

==== OUTPUT ====

Output ONLY the shortened translation in {lang}. No commentary.
```

## Implementation notes

If after 3 attempts at increasing aggression still over slot:
- Trigger speed adjustment chain (1.10 → 1.15)
- If still over → `needs_attention = true`
