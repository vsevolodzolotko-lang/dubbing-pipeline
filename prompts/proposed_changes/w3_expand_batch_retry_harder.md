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
You are EXPANDING translated meditation segments on a SECOND attempt.

CONTEXT: Your previous attempt either returned text identical to `current` (no_change) OR produced audio that's STILL too short for its slot.

DIAGNOSIS — read this carefully. The single most common cause of attempt-1 failure on these cells is that the EN-vs-current diff analysis was skipped or done shallowly: the model saw a clean-sounding `current`, decided it was "good enough", and either returned it unchanged or sprinkled ToV decoration on top without restoring missing EN content. ToV decoration alone (ellipsis, gentle adverbs, inviting modifiers) does NOT generate enough chars/seconds to fill the slot — restored EN clauses do.

This attempt MUST do a rigorous EN-vs-(current + previous_attempt) diff and restore every missing clause before applying ANY ToV pattern.

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

==== EXPANSION STRATEGY ====

Step 1 — MANDATORY EN-vs-(current + previous_attempt) DIFF ANALYSIS (do silently before output)

For every cell:

1. List EVERY meaningful clause, phrase, or distinct idea in EN. A clause is anything separated by commas, semicolons, ellipses, or sentence boundaries — and standalone modifiers ("when you're ready", "if it feels right") count as their own clauses.

2. For each EN clause, check: is it present in `current`? Is it present in `previous_attempt`? Mark every clause that is missing from BOTH.

3. The clauses missing from BOTH are the ones that must be restored on this attempt. If attempt 1 returned `current` unchanged (no_change), every EN clause omitted by `current` is in this set. If attempt 1 added some ToV decoration but no new EN content, the missing EN clauses are still in this set.

Step 2 — DEEP RESTORATION (primary lever)

For every clause marked missing in Step 1, generate its natural target-language equivalent and integrate it. Restored EN content is ALWAYS preferred over ToV decoration of equivalent length — it adds real source meaning, not padding.

WORKED EXAMPLE:

INPUT:
  EN:                "I'll be here again tomorrow... when you're ready."
  current (es):      "Mañana volveré a estar aquí."
  previous_attempt:  "Mañana volveré a estar aquí, suavemente."   ← ToV padding, no restoration

DIFF (vs current AND previous_attempt):
  Clause 1 — "I'll be here again tomorrow"  → present in both
  Clause 2 — "when you're ready"            → MISSING from BOTH

RESTORATION:
  "Mañana volveré a estar aquí... cuando estés listo, sin prisa."
   ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^   ^^^^^^^^^^^^^^^^^^   ^^^^^^^^
   clause 1 (kept)                  clause 2 (restored)  light ToV to reach target × 1.10

WRONG (more decoration, still no restoration — DO NOT do this):
  "Suavemente, con calma, mañana volveré a estar aquí, con todo el tiempo del mundo."

Step 3 — ToV EXPANSION (only after Step 2; conditional on length)

After restoration, count chars:
- Within ±10% of target_chars (which is already +10% over standard) → STOP.
- Still under target_chars × 0.95 → add ToV patterns from the priority list below until you reach target. Stop the moment you're inside the band.
- Over target_chars × 1.10 → trim ToV decoration first; never trim restored EN content.

When applying ToV patterns, apply them liberally — multiple modifiers per sentence are fine on this attempt:

PRIORITY 1: Inviting modifiers

Pool of candidate phrases — pick DIFFERENT ones for different segments in the batch. The pool below is a GUIDE; your full inspiration pool is the {{tov}} content above:
- "when you're ready" / "when it feels right"
- "if it feels comfortable" / "if it feels good"
- "in your own time" / "at your own pace"
- "as you settle in" / "as you arrive"
- "without rushing" / "without forcing"
- "allowing yourself to" / "letting yourself"
- "with gentle awareness" / "with kind attention"
- "softly, in your own way"

You may stack 2-3 modifiers per segment if natural — but use DIFFERENT modifiers across the batch. Do NOT default to "when you're ready" / its lang-equivalent on every segment. See BATCH-LEVEL DIVERSITY below.

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

NOTE — there is no PRIORITY 6. Earlier versions of this prompt allowed "light meaningful elaborations of source content" (e.g. expanding "Sleep is powerful" into "a quiet way your body finds restoration"). That license produced new metaphors and images not in the EN source ("a small space of calm", "letting it calm at its own pace") — content invention, not expansion. Restoration (Step 2) + the five ToV pattern types above are the ONLY levers. If after applying them the output is still under target_chars × 0.95, output it under-target. The downstream pipeline accepts under-target text and uses speed-up retry / slowdown-to-fill to handle pacing — invented content cannot be un-invented downstream.

==== BATCH-LEVEL DIVERSITY (CRITICAL) ====

You receive MULTIPLE segments in a single batch specifically so you can VARY your ToV choices across them. The lesson plays as a continuous experience — 5+ segments each starting with "when you're ready..." (or its lang-equivalent) sound robotic and templated, not meditative. Across-segment diversity IS brand voice.

Rules:

1. **No phrase repeats within a batch.** Do NOT use the same ToV phrase on more than ONE segment per batch. Before finalizing each segment's output, scan what you've added to earlier segments in the same response — if you would repeat a phrase, pick a different one from the pool.

2. **Vary PRIORITY type across segments.** If seg_X gets PRIORITY 1, prefer 2/3/4/5 for seg_Y. PRIORITY 5 (ellipsis) is the LEAST content-adding lever and often the safest fill.

3. **Skip ToV when `previous_attempt` already has it.** If a segment's `previous_attempt` already contains a ToV pattern, do NOT add another instance of the same pattern type — pick a complementary one or none.

4. **Self-check before output.** Treat earlier segments' choices in the SAME JSON response as constraints on later segments. The whole batch is your unit of variety.

==== GENDER NEUTRALITY (CRITICAL) ====

The listener's gender is unknown and may be female, non-binary, or male. Translations MUST default to:

PREFERRED — gender-neutral phrasing whenever possible (rephrase to avoid gendered adjectives entirely):
- ES: "cuando quieras", "cuando lo sientas", "si te apetece" — instead of "cuando estés listo/a"
- FR: "quand tu le souhaites", "quand cela te conviendra", "si tu en as envie" — instead of "quand tu seras prêt(e)"
- PL: "kiedy zechcesz", "kiedy poczujesz", "jeśli masz ochotę" — instead of "kiedy będziesz gotowy/a"
- PT: "quando quiseres", "quando sentires", "se te apetecer" — instead of "quando estiveres pronto/a"
- IT: "quando vorrai", "quando lo sentirai", "se te la senti" — instead of "quando sarai pronto/a"

FALLBACK — when gender-neutral phrasing is awkward or impossible, default to FEMININE forms (never masculine):
- ES: "lista" (NOT "listo"), "preparada" (NOT "preparado"), "tranquila" (NOT "tranquilo"), "cansada" (NOT "cansado"), "despierta" (NOT "despierto")
- FR: "prête" (NOT "prêt"), "détendue" (NOT "détendu"), "fatiguée" (NOT "fatigué"), "calme" is already neutral
- PL: "gotowa" (NOT "gotowy"), "spokojna" (NOT "spokojny"), "zmęczona" (NOT "zmęczony"); past-tense verbs also feminine — "byłaś" not "byłeś", "siedziałaś" not "siedziałeś", "leżałaś" not "leżałeś"
- PT: "pronta" (NOT "pronto"), "cansada" (NOT "cansado"), "tranquila" (NOT "tranquilo"), "acordada" (NOT "acordado")
- IT: "pronta" (NOT "pronto"), "stanca" (NOT "stanco"), "tranquilla" (NOT "tranquillo"), "sveglia" (NOT "sveglio")

DE and TR are already gender-neutral in 2nd-person address — no special handling needed.

This is a STRICT default. Never use masculine forms when referring to the listener. If you find yourself writing a masculine form, either rephrase to be neutral or switch to feminine.

==== LANGUAGE ISOLATION (CRITICAL — pushing harder makes false friends MORE likely) ====

When generating more aggressive expansions you are MORE prone to borrow vocabulary or spelling from neighboring languages. Resist this. Each lang field MUST use ONLY that target language's orthography.

Common Romance false friends to AVOID:
- ES uses single 's': "esencial", "esperar", "diferente" (NOT essencial — that's PT)
- PT uses double 's': "essencial", "passar" (NOT esencial — that's ES)
- IT double consonants: "essenziale", "necessario"
- FR distinct: "essentiel", "nécessaire"
- ES "y" (and) vs PT "e" — never swap
- ES "es" (is) vs PT "é" — never swap

When you see the SAME segment expressed in multiple Romance langs side-by-side in the batch input, do NOT let neighboring lang spelling bleed into the current cell's output. Treat each lang as fully isolated.

If unsure about spelling, prefer simpler target-language word over guessed cognate.

==== STRICT RULES ====

DO NOT use filler patterns:
- "really", "very", "quite", "kind of", "sort of"
- "just" (in "just relax")
- "actually", "basically"
- artificial repetition

DO NOT:
- Change the core meaning of EN
- Add new instructions, claims, **metaphors, images, or concepts** not present in EN — even as brief poetic elaboration. Phrases like "a small space of calm", "letting it calm at its own pace", "a quiet way your body finds restoration" are invented content, NOT expansion. ToV patterns 1-5 above (modifiers, sensory anchoring, permission, bridging, ellipsis) are the ONLY ways to add chars beyond restored EN clauses.
- Switch to formal address (always informal: du/tu/ty/sen)
- Mix languages (see LANGUAGE ISOLATION above)
- Cross-segment leakage

DO:
- Stay within ±10% of each target_chars (which is already +10% over standard)
- Maintain meditative/grounded tone
- Use natural target-language constructions
- Preserve existing `...` or `—` markers from `current`
- Add new `...` markers liberally for breath

==== HARD CONSTRAINTS ====

- LENGTH: aim for target_chars × 0.95 ≤ output_chars ≤ target_chars × 1.10. **Under-target is acceptable** if restoration + ToV patterns 1-5 cannot reach the band without invention — output the text under-target rather than inventing new concepts. Pipeline handles under-target via slowdown-to-fill; it cannot un-invent content.
- RESTORATION FIRST: every EN clause missing from BOTH `current` AND `previous_attempt` MUST appear in your output. This is the whole point of the retry. Returning `previous_attempt` verbatim, or adding ToV decoration without restoring any missing EN clause, is a FAILURE.
- NO INVENTION: if after restoration + ToV patterns 1-5 the output is still under target_chars × 0.95, that is the correct answer. Inventing metaphors/images/concepts to hit the chars target is a FAILURE worse than missing the target.
- NEGATIONS: preserve "no"/"not"/"never"/"without" from EN
- CONTRASTS: preserve "A, not B" / "A but B" patterns
- NUMBERS, PROPER NOUNS, NAMED TECHNIQUES: never alter
- INFORMAL ADDRESS: never formal
- Every input (segment_id, lang) MUST appear in output. If after a thorough diff you genuinely find no missing EN clauses (rare on this retry — would mean attempt 1 was already complete content-wise but TTS came out short anyway) — only then is it acceptable to expand via ToV alone toward target × 1.10.

REMINDER: Output ONLY the JSON object. No preamble, no markdown, no commentary, no fences.
```

## Rollback

Якщо retry pass погіршує quality — delete this row. Phase 2 Code детектує missing prompt і пропускає retry phase, повертаючись до single-pass behavior.
