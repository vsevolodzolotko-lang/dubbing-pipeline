# Proposed change: new `w3_expand_batch_retry_shorter` row (Phase 2 retry — push less)

**Sheet**: `prompts` tab — **ADD a new row** з key `w3_expand_batch_retry_shorter`.

## What it does

Retry-варіант expansion prompt для cells де **attempt 1 produced TTS that overshoots the audio slot** (newRealDur > en_duration). Цей prompt інструктує LLM бути більш консервативним: target_chars × 0.85 (15% коротше), прибирати зайві adjectives і ellipsis, зберігати core meaning щільніше.

Викликається з W3 Phase 2 mega-Code node на retry pass. Output проходить через Editor (Gemini) перш ніж re-TTS — Verify пропускається.

## How to add

In Sheets `prompts` tab → новий рядок:

**key:**
```
w3_expand_batch_retry_shorter
```

**description:**
```
W3 Phase 2 retry pass (shorter) — for cells where attempt 1 produced TTS that overshoots en_duration. Pulls back expansion with target_chars × 0.85. {{tov}} interpolated.
```

**value** (паста повністю весь блок між backticks):

```
You are CONDENSING translated meditation segments on a SECOND attempt.

CONTEXT: Your previous attempt produced text that, when read aloud, EXCEEDED the audio slot. You must pull back this time — keep the meditative ToV but trim filler, shorten phrases, and target a slightly under-budget length so the TTS fits comfortably.

==== INPUT FORMAT ====

A JSON object mapping segment_id → { en, [lang]: { current, target_chars, previous_attempt } }.
- `current` is the Phase 1 translation (already shorter than slot — that's why expansion was tried)
- `previous_attempt` is what attempt 1 returned (TOO LONG — overshoot)
- `target_chars` is DECREASED by 15% below standard target — aim for comfortable fit, not maximal fill

Example:
{
  "lesson_seg_007": {
    "en": "Sleep is not a bank account.",
    "pt": {
      "current": "O sono não é uma conta bancária.",
      "previous_attempt": "O sono não funciona como uma conta bancária... com toda a sua complexidade financeira e regras complicadas.",
      "target_chars": 70
    }
  }
}

==== OUTPUT FORMAT ====

JSON object mapping segment_id → { [lang]: expanded_text }. Same structure as input.

NO preamble, NO markdown, NO commentary, NO ```json fences. Output ONLY the JSON object.

==== BRAND TONE OF VOICE ====

{{tov}}

==== CONSERVATIVE EXPANSION STRATEGY ====

Goal: enough expansion to feel less abrupt than `current`, but SHORT enough that TTS doesn't overshoot. Apply with restraint:

KEEP from ToV (sparingly):
- ONE inviting modifier per segment ("gently", "softly", or "when you're ready")
- ONE ellipsis at most per sentence — only at natural breathing points
- Light sensory anchoring if it fits without adding new meaning

REMOVE / TRIM aggressively if these were in `previous_attempt`:
- Stacked modifiers ("gently and softly and with care" → pick one)
- Multiple ellipsis chains (`... ... ...` → one `...` max)
- Elaborated body locations ("at the very base of the spine where the ribs meet" → "at the base of the spine")
- Permission layers that don't add ("you're welcome to stay here as long as you need")
- Bridging extensions that pad ("notice what happens when you bring curious attention to..." → "notice...")
- Verbose synonyms ("a quiet, gentle, peaceful state" → "a quiet state")

==== STRICT RULES ====

DO NOT:
- Drop core EN meaning
- Use formal address (always informal: du/tu/ty/sen)
- Mix languages
- Add new claims or instructions

DO:
- Stay within ±5% of target_chars (tight bound — overshoot was the problem)
- Keep ONE breath/ellipsis marker if natural
- Preserve negations and contrasts from EN
- Use efficient target-language constructions

==== HARD CONSTRAINTS ====

- LENGTH: target_chars × 0.90 ≤ output_chars ≤ target_chars × 1.00
  - **NEVER** exceed target_chars — this is a strict ceiling
- NEGATIONS: preserve "no"/"not"/"never"/"without" from EN
- CONTRASTS: preserve "A, not B" / "A but B" patterns
- NUMBERS, PROPER NOUNS, NAMED TECHNIQUES: never alter
- INFORMAL ADDRESS: never formal
- Every input (segment_id, lang) MUST appear in output. If genuinely impossible to shorten meaningfully — return `current` unchanged for that cell.

REMINDER: Output ONLY the JSON object. No preamble, no markdown, no commentary, no fences.
```

## Rollback

Якщо retry shorter pass погіршує quality — delete this row. Phase 2 детектує missing prompt і пропускає shorter retry phase, залишаючи overshoot cases як revert до Phase 1 audio (поточна behavior).
