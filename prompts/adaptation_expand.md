# Adaptation Expand Prompt

Single-segment translation expansion when TTS output is significantly shorter than the audio slot.

## When called

By Synthesize workflow when `real_duration_sec < en_duration_sec * expansion_threshold` (default 0.85).

## Inputs

- Original EN text
- Current translation (the one that turned out too short)
- Target character count = `round(en_duration_sec * cps_estimate_lang * 0.95)`
- Brand Tone of Voice (full ToV content from config sheet)
- Language code (`de`, `es`, `fr`, `pl`, `pt`, `it`, `tr`)

## Why current translation may be short

Two distinct cases:

- **Case A — Restoration**: Previous adaptation cut too aggressively (look for `adaptation_attempts > 0` in segments sheet).
- **Case B — Authentic expansion**: Target language is naturally more concise than English (typical for TR, sometimes PL, ES).

Both cases need expansion, but with different approaches.

## Prompt template

```
You are expanding a translated meditation/wellness script segment to fit a longer audio slot.

The current translation produces TTS audio that is too short — creating awkward silence in the dubbed audio. Your job: expand the translation to fit the time slot using AUTHENTIC SPIRIO LANGUAGE PATTERNS, not filler words.

==== INPUTS ====

ORIGINAL EN TEXT:
{original_en}

CURRENT (TOO-SHORT) TRANSLATION in {lang}:
{current_translation}

CURRENT LENGTH: {current_chars} characters
TARGET LENGTH: ~{target_chars} characters (need to add ~{chars_to_add} characters)

==== BRAND TONE OF VOICE ====

{tov_content}

==== EXPANSION STRATEGY ====

Step 1 — Identify the case:

- If ORIGINAL EN contains content that's missing from CURRENT translation → this is "restoration" case. Restore the cut content first.
- If ORIGINAL EN and CURRENT translation convey the same meaning but translation is just naturally shorter → this is "authentic expansion" case. Add Spirio-native phrasing.

Step 2 — Apply expansion techniques in this priority order:

PRIORITY 1: Inviting modifiers (Spirio ToV section 3 — "Inviting movement into sensation")
Add phrases like:
- "when you're ready"
- "if it feels comfortable"
- "if it feels right"
- "allowing yourself to"
- "without forcing"

These work especially well at sentence beginnings or before verbs.

Example transformation (EN reference):
- Before: "Take a breath."
- After: "When you're ready, take a slow breath in."

PRIORITY 2: Sensory anchoring
Add concrete sensory descriptors:
- "softly", "gently", "with care"
- "slowly", "naturally"
- specific body locations ("at the back of the throat", "between the shoulder blades")
- temperature, weight, texture references where relevant

Example:
- Before: "Feel your breath."
- After: "Feel your breath, soft and full, at the tip of the nose."

PRIORITY 3: Permission language
Make the listener's sovereignty explicit:
- "you don't need to change anything"
- "let it be exactly as it is"
- "there's no need to force"
- "you're allowed to"

Example:
- Before: "Notice the tension."
- After: "Notice the tension, without needing to release it just yet."

PRIORITY 4: Bridging awareness phrases
Make the noticing explicit:
- "notice what happens when…"
- "see what happens if…"
- "bringing attention to…"
- "feeling into…"

Example:
- Before: "Breathe in."
- After: "Breathe in, noticing how the breath fills you."

PRIORITY 5: Internal pauses via ellipsis (...)
If text is already richer but slot still has time, distribute breathing space INSIDE the text:
- Each `...` becomes ~0.5s of natural pause in TTS
- Place at natural breathing points (between phrases, before key words)
- Don't put more than 2-3 ellipsis per sentence

Example:
- Before: "Breathe in deeply and feel the air filling you."
- After: "Breathe in... deeply... and feel the air filling you... completely."

==== STRICT RULES ====

DO NOT use any of these filler patterns:
- "really", "very", "quite", "kind of", "sort of"
- "just" (in the sense of "just relax")
- "actually", "basically"
- artificial repetition of the same idea
- meaningless adverbs

DO NOT:
- Change the core meaning of the original
- Add new instructions or information not in the original
- Make the tone more grandiose or promising
- Lose the natural rhythm of the target language
- Switch to formal address (always informal: du/tu/ty/sen)

DO:
- Stay within ±10% of TARGET LENGTH
- Maintain the meditative/grounded tone throughout
- Use natural target-language constructions
- Preserve any existing `...` or `—` markers in original
- Add new `...` if it helps fill time naturally

==== OUTPUT ====

Output ONLY the expanded translation in {lang}. No commentary, no English, no quotation marks around the result.
```

## Implementation notes for Synthesize workflow

After receiving expansion output:

1. Re-call TTS with new translation.
2. Re-measure `real_duration_sec`.
3. If new `real_duration <= en_duration_sec` → accept, write to Sheet.
4. If new `real_duration > en_duration_sec` → REVERT to previous version (overshoot).
5. If new `real_duration` still `< en_duration_sec * expansion_threshold` → try ONE more expansion attempt with stronger emphasis on adding sensory/permission patterns.
6. After 2 attempts max, accept best version even if not perfect.

Log in Sheet `localizations`:
- `expansion_attempts`: how many times expansion ran
- `expansion_strategy`: `"restoration"` | `"authentic_expansion"` (from Step 1)
