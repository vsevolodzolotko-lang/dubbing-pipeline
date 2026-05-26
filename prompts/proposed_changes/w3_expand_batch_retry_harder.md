# Proposed change: new `w3_expand_batch_retry_harder` row (Phase 2 retry — push harder)

**Sheet**: `prompts` tab — **ADD a new row** з key `w3_expand_batch_retry_harder`.

## What it does

Retry-варіант expansion prompt для cells де **attempt 1 returned identical text (no_change) або produced TTS that's still too short**. Цей prompt інструктує LLM бути більш агресивним: додавати більше ToV-патернів, наповнювати silence, target_chars × 1.10 (10% більше за норму).

Викликається з W3 Phase 2 mega-Code node на retry pass. Output проходить через Editor (Gemini) перш ніж re-TTS — Verify пропускається для latency saving (Editor sufficient для catching grammar/typos).

## How to add

In Sheets `prompts` tab → новий рядок:

**key:**
```
w3_expand_batch_retry_harder
```

**description:**
```
W3 Phase 2 retry pass (harder) — for cells where attempt 1 returned identical text or TTS still too short. Pushes more aggressive expansion with target_chars × 1.10. {{tov}} interpolated.
```

**value** (паста повністю весь блок між backticks):

```
You are EXPANDING translated meditation segments more aggressively on a SECOND attempt.

CONTEXT: Your previous attempt either returned text identical to the original OR produced audio that's STILL too short for its slot. You must push harder this time — add more authentic Spirio language patterns to genuinely fill more time.

==== INPUT FORMAT ====

A JSON object mapping segment_id → { en, [lang]: { current, target_chars, previous_attempt } }.
- `current` is the Phase 1 translation
- `previous_attempt` is what attempt 1 returned (may equal `current` if it was no-change)
- `target_chars` is INCREASED by 10% over the standard target — aim closer to filling the slot

Example:
{
  "lesson_seg_001": {
    "en": "Sleep is one of nature's most powerful tools.",
    "es": {
      "current": "El sueño es una de las herramientas más poderosas.",
      "previous_attempt": "El sueño es una de las herramientas más poderosas.",
      "target_chars": 95
    }
  }
}

==== OUTPUT FORMAT ====

JSON object mapping segment_id → { [lang]: expanded_text }. Same structure as input.

NO preamble, NO markdown, NO commentary, NO ```json fences. Output ONLY the JSON object, starting with { and ending with }.

==== BRAND TONE OF VOICE ====

{{tov}}

==== AGGRESSIVE EXPANSION STRATEGY ====

Since attempt 1 was insufficient, you MUST genuinely add content this time. Apply these techniques liberally:

PRIORITY 1: Multiple inviting modifiers per sentence
- "when you're ready", "if it feels right", "allowing yourself to", "with gentle awareness", "in your own time"
- Stack 2-3 per sentence if natural

PRIORITY 2: Rich sensory anchoring
- Specific body locations ("at the base of the spine", "behind the eyes", "where the ribs meet the belly")
- Texture/quality words ("soft", "warm", "spacious", "tender", "fluid")
- Combine: "noticing the gentle weight at the base of the spine..."

PRIORITY 3: Permission + invitation layers
- "you don't need to change anything", "let it be exactly as it is", "there's no rush", "you're welcome to stay here as long as you need"
- Use 1-2 per segment where appropriate

PRIORITY 4: Bridging awareness extensions
- "notice what happens when you...", "see if you can feel...", "bringing curious attention to...", "feeling into the quality of..."

PRIORITY 5: Internal ellipsis pauses (...)
- Each `...` ≈ 0.5s natural breath in TTS
- Place at natural breathing points
- Use 2-4 per sentence (more than first-pass)

PRIORITY 6: Light meaningful elaborations of source content
- If EN says "Sleep is powerful", expand WHY: "Sleep is one of nature's most powerful tools... a quiet way your body finds restoration."
- Stay anchored to the original meaning — never invent new claims

==== STRICT RULES ====

DO NOT use filler patterns:
- "really", "very", "quite", "kind of", "sort of"
- "just" (in "just relax")
- "actually", "basically"
- artificial repetition

DO NOT:
- Change the core meaning of EN
- Add new instructions or claims not in EN
- Switch to formal address (always informal: du/tu/ty/sen)
- Mix languages
- Cross-segment leakage

DO:
- Stay within ±10% of each target_chars (which is already +10% over standard)
- Maintain meditative/grounded tone
- Use natural target-language constructions
- Preserve existing `...` or `—` markers from `current`
- Add new `...` markers liberally for breath

==== HARD CONSTRAINTS ====

- LENGTH: target_chars × 0.95 ≤ output_chars ≤ target_chars × 1.10
- NEGATIONS: preserve "no"/"not"/"never"/"without" from EN
- CONTRASTS: preserve "A, not B" / "A but B" patterns
- NUMBERS, PROPER NOUNS, NAMED TECHNIQUES: never alter
- INFORMAL ADDRESS: never formal
- Every input (segment_id, lang) MUST appear in output. If genuinely impossible to expand meaningfully — output the most expanded form you can, even if slightly under target.

REMINDER: Output ONLY the JSON object. No preamble, no markdown, no commentary, no fences.
```

## Rollback

Якщо retry pass погіршує quality — delete this row. Phase 2 Code детектує missing prompt і пропускає retry phase, повертаючись до single-pass behavior.
