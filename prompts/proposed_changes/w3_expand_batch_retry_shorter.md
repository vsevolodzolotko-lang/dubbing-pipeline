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

CONTEXT: Your previous attempt produced text that, when read aloud, EXCEEDED the audio slot. You must pull back this time — but ONLY by trimming ToV decoration, NEVER by removing content that was restored from the EN source.

DIAGNOSIS — read carefully. The previous attempt overshot for one of two reasons:
(a) it added too much ToV padding (stacked modifiers, multiple ellipsis, elaborated phrases) on top of correct EN content, OR
(b) the EN source itself is content-dense and the target language naturally needs more chars than the slot allows.

In case (a) you trim ToV.
In case (b) you trim verbose phrasing while keeping EVERY EN clause intact, and accept a slight chars overshoot rather than drop content.

Dropping a restored EN clause to fit the chars target is a FAILURE — it produces a clean-looking translation that silently omits source meaning. The downstream pipeline will accept the resulting audio but the listener loses content that was in the original. Overshoot is recoverable downstream (the pipeline can reject overshoot TTS and keep Phase 1 audio); clause-loss is invisible.

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

==== CONDENSATION STRATEGY ====

Step 1 — MANDATORY EN-vs-previous_attempt DIFF (do silently before output)

For every cell:

1. List EVERY meaningful clause, phrase, or distinct idea in EN. A clause is anything separated by commas, semicolons, ellipses, or sentence boundaries — and standalone modifiers ("when you're ready", "if it feels right") count as their own clauses.

2. For each EN clause, decide: is its meaning carried by some part of `previous_attempt`? Mark the set of clauses that ARE carried. **THIS IS THE PROTECTED SET.** These clauses MUST appear in your output — verbatim or in a minor stylistic variation. You may NOT drop any of them to fit length.

3. Everything in `previous_attempt` BEYOND the protected clauses is ToV decoration — adverbs, stacked modifiers, elaborations, bridging phrases, extra adjectives. THAT is what you trim.

Step 2 — TRIM ToV decoration ONLY

REMOVE / TRIM aggressively if these are in `previous_attempt` and are NOT carrying a protected EN clause:
- Stacked modifiers ("gently and softly and with care" → pick one or remove)
- Multiple ellipsis chains (`... ... ...` → one `...` max)
- Elaborated body locations ("at the very base of the spine where the ribs meet" → "at the base of the spine")
- Permission layers that don't add ("you're welcome to stay here as long as you need")
- Bridging extensions that pad ("notice what happens when you bring curious attention to..." → "notice...")
- Verbose synonyms ("a quiet, gentle, peaceful state" → "a quiet state")

KEEP from ToV (sparingly, only if length still allows after Step 2):
- ONE inviting modifier per segment ("gently", "softly", "when you're ready") — but only if it itself maps to an EN clause
- ONE ellipsis at most per sentence — only at natural breathing points
- Light sensory anchoring if it fits without adding new meaning

WORKED EXAMPLE — right vs WRONG trim:

INPUT:
  EN:                "I'll be here again tomorrow... when you're ready."
  current (de):      "Morgen bin ich wieder hier."
  previous_attempt:  "Morgen bin ich wieder hier... wenn du bereit bist."   ← already restored both clauses
  target_chars:      40

EN clause analysis:
  Clause 1 — "I'll be here again tomorrow"  → "Morgen bin ich wieder hier"  → PROTECTED (in previous_attempt)
  Clause 2 — "when you're ready"            → "wenn du bereit bist"          → PROTECTED (in previous_attempt)

The previous_attempt has NO ToV decoration to trim — every element maps to an EN clause. The "..." is timing punctuation, not decoration. Length is ~50 chars vs target 40 → 25% over.

RIGHT (minimal stylistic compression; both protected clauses kept):
  "Morgen bin ich wieder hier, wenn du bereit bist."
  (replaced "..." with ",", kept both clauses; ~48 chars — still over target, but no protected clause was sacrificed)

WRONG (drops a protected clause to hit target):
  "Ich bin morgen wieder genau hier."
  ↑ clause 2 "wenn du bereit bist" is gone. The target_chars goal was prioritized over content preservation. This is the failure mode this prompt exists to prevent.

If after Step 2 the output still exceeds target_chars × 1.00, that's acceptable — output it anyway. The downstream pipeline will TTS-test it; if the audio overshoots the slot, the pipeline keeps the Phase 1 audio. That outcome is RECOVERABLE. A silently-dropped clause is not.

==== GENDER NEUTRALITY (CRITICAL) ====

The listener's gender is unknown. When condensing, do NOT introduce masculine adjective/participle forms even if shorter than feminine/neutral equivalents. Defaults:

PREFERRED — gender-neutral phrasing:
- ES: "cuando quieras", "cuando lo sientas" — instead of "cuando estés listo/a"
- FR: "quand tu le souhaites" — instead of "quand tu seras prêt(e)"
- PL: "kiedy zechcesz", "kiedy poczujesz" — instead of "kiedy będziesz gotowy/a"
- PT: "quando quiseres", "quando sentires" — instead of "quando estiveres pronto/a"
- IT: "quando vorrai", "quando lo sentirai" — instead of "quando sarai pronto/a"

FALLBACK — feminine forms (never masculine):
- ES: "lista", "preparada", "tranquila", "cansada"
- FR: "prête", "détendue", "fatiguée"
- PL: "gotowa", "spokojna", "zmęczona"; verbs "byłaś", "siedziałaś", "leżałaś" not masculine variants
- PT: "pronta", "cansada", "tranquila"
- IT: "pronta", "stanca", "tranquilla"

DE and TR already neutral — no handling needed. If `previous_attempt` contained masculine forms, FIX them on the way through; do not preserve them just because rewriting feminine costs a few extra chars.

==== LANGUAGE ISOLATION (CRITICAL) ====

Each lang field MUST use ONLY that target language's orthography. Even when shortening, do not borrow vocabulary or spelling from neighboring Romance languages.

Romance false friends to AVOID:
- ES "esencial" (single 's') vs PT "essencial" (double 's')
- ES "y" (and) vs PT "e"
- ES "es" (is) vs PT "é"
- IT double consonants ("essenziale", "necessario") distinct from ES/PT
- FR distinct accents: "essentiel", "nécessaire"

When you see the same segment in multiple Romance langs side-by-side, do NOT let neighboring lang spelling bleed into the current cell's output.

==== STRICT RULES ====

DO NOT:
- Drop core EN meaning
- Use formal address (always informal: du/tu/ty/sen)
- Mix languages (see LANGUAGE ISOLATION above)
- Add new claims or instructions

DO:
- Stay within ±5% of target_chars (tight bound — overshoot was the problem)
- Keep ONE breath/ellipsis marker if natural
- Preserve negations and contrasts from EN
- Use efficient target-language constructions

==== HARD CONSTRAINTS ====

- **RESTORATION PROTECTED**: every EN clause whose meaning is carried by `previous_attempt` MUST appear in your output (verbatim or minor stylistic variation). Dropping a protected clause to fit length is a FAILURE. When RESTORATION conflicts with LENGTH, RESTORATION wins.
- LENGTH: aim for target_chars × 0.90 ≤ output_chars ≤ target_chars × 1.00. Going up to target × 1.10 is acceptable if needed to keep all protected clauses; the pipeline accepts overshoot at the audio stage and falls back to Phase 1 audio if needed.
- NEGATIONS: preserve "no"/"not"/"never"/"without" from EN
- CONTRASTS: preserve "A, not B" / "A but B" patterns
- NUMBERS, PROPER NOUNS, NAMED TECHNIQUES: never alter
- INFORMAL ADDRESS: never formal
- Every input (segment_id, lang) MUST appear in output. Returning `current` unchanged is acceptable only if (a) `current` already contains all EN clauses AND (b) `current` is at or under target_chars × 1.10.

REMINDER: Output ONLY the JSON object. No preamble, no markdown, no commentary, no fences.
```

## Rollback

Якщо retry shorter pass погіршує quality — delete this row. Phase 2 детектує missing prompt і пропускає shorter retry phase, залишаючи overshoot cases як revert до Phase 1 audio (поточна behavior).
