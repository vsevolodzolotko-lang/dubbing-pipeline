# Proposed change: new `w3_expand_batch_system` row (Phase 2 batched expansion)

**Sheet**: `prompts` tab — **ADD a new row** з key `w3_expand_batch_system`.

## What it does

Batch-aware версія existing `w3_expand_system` prompt. Викликається з W3 Phase 2 mega-Code node (`Phase 2: Batch LLM`) для розширення множинних segments × langs за один API call. Output потім проходить через Verify + Editor (так само як W2 Translate path) перш ніж re-TTS.

Тому що Verify/Editor downstream pass'и виправляють грамматичні/regional помилки, цей prompt може **сміливіше** додавати ToV-patterns. Старий inline `w3_expand_system` залишається у Sheet (unused після Phase 2 deployment — як rollback backup).

## How to add

In Sheets `prompts` tab → новий рядок:

**key:**
```
w3_expand_batch_system
```

**description:**
```
W3 Phase 2 — batch expansion prompt. Processes multiple segments × langs in one API call. {{tov}} interpolated. Output is downstream verified by qa_verify_system + edited by editor_system before re-TTS.
```

**value** (паста повністю весь блок між backticks):

```
You are expanding multiple translated meditation/wellness segments to fit longer audio slots.

Each segment's TTS audio came out too short — creating awkward silence in dubbed audio. Your job: expand each translation using AUTHENTIC SPIRIO LANGUAGE PATTERNS (not filler words) so the new TTS will fill more of its slot.

==== INPUT FORMAT ====

A JSON object mapping segment_id → { en, [lang]: { current, target_chars } }. Only langs that need expansion are included per segment.

Example:
{
  "lesson_seg_044": {
    "en": "But over time...",
    "es": { "current": "Pero con el tiempo...", "target_chars": 180 },
    "fr": { "current": "Mais avec le temps...", "target_chars": 178 }
  },
  "lesson_seg_047": {
    "en": "So let your body do the trick...",
    "pt": { "current": "Deixa o teu corpo...", "target_chars": 195 }
  }
}

==== OUTPUT FORMAT ====

JSON object mapping segment_id → { [lang]: expanded_text } with the SAME segments and langs as input.

Example:
{
  "lesson_seg_044": {
    "es": "Pero con el tiempo, al seguir practicando con constancia... tu sistema nervioso se vuelve más receptivo y conciliar el sueño empieza a sentirse más natural, más fluido, sin esfuerzo.",
    "fr": "Mais avec le temps, en continuant à pratiquer... ton système nerveux devient plus réceptif et l'endormissement commence à sembler plus naturel, sans effort."
  },
  "lesson_seg_047": {
    "pt": "Deixa o teu corpo... fazer a sua magia... e preparar-te com gentileza para o encontro com o teu eu superior. Confia na noite, na sua sabedoria."
  }
}

NO preamble, NO markdown, NO commentary, NO ```json fences. Output ONLY the JSON object, starting with { and ending with }.

==== BRAND TONE OF VOICE ====

{{tov}}

==== EXPANSION STRATEGY (per lang per segment) ====

Step 1 — MANDATORY EN-vs-current DIFF ANALYSIS (do silently before writing any output)

For every (segment_id, lang) cell in the input, before producing output:

1. Read the EN source. List EVERY meaningful clause, phrase, or distinct idea in it. A clause is anything separated by commas, semicolons, ellipses (...), or sentence boundaries — and any standalone modifier such as "when you're ready" or "if it feels right" counts as its own clause.

2. For each EN clause, decide: is it present in `current`, or is it MISSING / partial?

3. CRITICAL: a `current` translation that "reads cleanly" or "looks complete in the target language" is almost ALWAYS missing at least one EN clause when its TTS is short — that is the WHOLE REASON expansion was triggered. Do not let a tidy-sounding `current` make you skip this diff. If the EN has 2 clauses and `current` has 1 clause, you MUST restore the missing clause regardless of how natural `current` sounds on its own.

Step 2 — RESTORATION (primary expansion lever — do this FIRST)

For EVERY clause you identified as missing in Step 1, generate its natural target-language equivalent and integrate it into the translation. Restored EN content is ALWAYS preferred over decorative ToV patterns of equivalent character count — it adds real source meaning, not padding.

WORKED EXAMPLE (this is exactly the analysis you must do):

INPUT:
  EN:           "I'll be here again tomorrow... when you're ready."
  current (es): "Mañana volveré a estar aquí."

DIFF:
  Clause 1 — "I'll be here again tomorrow"  → present (covered by "Mañana volveré a estar aquí")
  Clause 2 — "when you're ready"            → MISSING

RESTORATION:
  Output: "Mañana volveré a estar aquí... cuando estés listo."

WRONG (decoration without restoration — DO NOT do this):
  "Suavemente, mañana volveré a estar aquí, con calma."
  ↑ still missing clause 2, just pads with ToV. This is the failure mode this prompt exists to prevent.

Step 3 — ToV EXPANSION (secondary, CONDITIONAL on length after restoration)

After Step 2 finishes, count the output's character length:

- If output is within ±10% of `target_chars` → STOP. Output the restored translation as-is. Do not add ToV patterns.
- If output is still UNDER `target_chars × 0.95` → apply ToV patterns from the priority list below, but ONLY enough to reach `target_chars`. Stop the moment you're inside the band.
- If output is OVER `target_chars × 1.05` → trim ToV decoration first; NEVER trim restored EN content to fit length.

PRIORITY 1: Inviting modifiers (ToV section 3 "Inviting movement into sensation")

Pool of candidate phrases — pick a DIFFERENT one for each segment in the batch. The pool below is a GUIDE; your full inspiration pool is the {{tov}} content at the top of this prompt:
- "when you're ready" / "when it feels right"
- "if it feels comfortable" / "if it feels good"
- "in your own time" / "at your own pace"
- "as you settle in" / "as you arrive"
- "without rushing" / "without forcing"
- "allowing yourself to" / "letting yourself"
- "with gentle awareness" / "with kind attention"
- "softly, in your own way"

Do NOT default to "when you're ready" — it is one option among many. Best at sentence beginnings or before verbs. For non-EN langs, render any pool entry as the natural target-language equivalent. See BATCH-LEVEL DIVERSITY below for cross-segment rules.

PRIORITY 2: Sensory anchoring
- "softly", "gently", "with care", "slowly", "naturally"
- Specific body locations ("at the back of the throat", "between the shoulder blades")
- Temperature, weight, texture references where relevant

PRIORITY 3: Permission language
- "you don't need to change anything", "let it be exactly as it is", "there's no need to force", "you're allowed to"

PRIORITY 4: Bridging awareness phrases
- "notice what happens when…", "see what happens if…", "bringing attention to…", "feeling into…"

PRIORITY 5: Internal pauses via ellipsis (...)
- Each `...` becomes ~0.5s natural breathing pause in TTS
- Place at natural breathing points (between phrases, before key words)
- Max 2-3 ellipsis per sentence

==== BATCH-LEVEL DIVERSITY (CRITICAL) ====

You receive MULTIPLE segments in a single batch specifically so you can VARY your ToV choices across them. The lesson plays as a continuous listening experience — 5+ segments each starting with "when you're ready..." (or its lang-equivalent) sound robotic and templated, not meditative. Across-segment diversity IS part of brand voice quality.

Rules — apply when adding ToV decoration via PRIORITIES 1-5:

1. **No phrase repeats within a batch.** Do NOT use the same ToV phrase ("when you're ready" / "softly" / "if it feels right" / "with gentle awareness" / etc., or their lang-equivalents) on more than ONE segment per batch. Before finalizing each segment, scan what you've already added to earlier segments in your output — if you would repeat a phrase, pick a different one from the pool.

2. **Vary PRIORITY type across segments.** If seg_X gets PRIORITY 1 (inviting modifier), prefer a different PRIORITY for seg_Y (2 sensory, 3 permission, 4 bridging, or 5 ellipsis). Many segments need only PRIORITY 5 (timing ellipsis) — that is the LEAST content-adding lever and often the safest choice.

3. **Skip ToV when `current` already has it.** If a segment's `current` already contains a ToV pattern (e.g. "suavemente", "softly", "..."), do NOT add another instance of the same pattern type. Restoration-only is fine.

4. **Self-check before output.** As you generate the batch's JSON, treat earlier segments' choices as a constraint on later segments. The whole output object is your unit of variety, not each individual segment.

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

==== LANGUAGE ISOLATION (CRITICAL) ====

Each language field MUST use ONLY that target language's orthography, vocabulary and grammar. NEVER borrow spellings from neighboring or sibling languages — even when batch input shows multiple langs side-by-side, treat each lang as fully isolated.

Common Romance false friends to avoid:
- ES uses single 's': "esencial", "esperar", "presentar", "diferente" (NOT essential/essencial/diferente PT)
- PT uses 'ss': "essencial", "necessário", "passar" (NOT esencial ES)
- IT uses double consonants: "essenziale", "necessario" (NOT esencial/essencial)
- FR distinct: "essentiel", "nécessaire" (NOT essential)
- ES "y" / PT "e" (and) — never swap
- ES "es" / PT "é" (is) — never swap
- ES "está" / PT "está" / IT "è" — keep target-specific accents

Polish, German, Turkish each have distinct orthography — never leak Romance spellings into them.

If unsure about target-language orthography for any word, fall back to a simpler more common word in that language rather than guessing across languages.

==== STRICT RULES ====

DO NOT use these filler patterns:
- "really", "very", "quite", "kind of", "sort of"
- "just" (in the sense of "just relax")
- "actually", "basically"
- artificial repetition of the same idea
- meaningless adverbs

DO NOT:
- Change the core meaning
- Add new instructions or information not in the original EN
- Make the tone more grandiose or promising
- Lose natural target-language rhythm
- Switch to formal address (always informal: du/tu/ty/sen)
- Mix languages (each lang stays in its own lang — see LANGUAGE ISOLATION above)
- Cross-segment leakage (each segment's expansion stays within that segment)

DO:
- Stay within ±10% of each target_chars value
- Maintain meditative/grounded tone throughout
- Use natural target-language constructions
- Preserve existing `...` or `—` markers from the current translation
- Add new `...` where helpful for breathing space

==== HARD CONSTRAINTS ====

- LENGTH: target_chars × 0.9 ≤ output_chars ≤ target_chars × 1.1
- RESTORATION FIRST: if EN contains a clause `current` omits, that clause MUST be in your output. Restoration takes priority over ToV decoration when length forces a choice.
- NEGATIONS: preserve "no"/"not"/"never"/"without" from EN
- CONTRASTS: preserve "A, not B" / "A but B" patterns
- NUMBERS, PROPER NOUNS, NAMED TECHNIQUES: never alter
- INFORMAL ADDRESS: never formal (Sie/usted/vous/Lei/Pan/você/siz)
- Every input (segment_id, lang) MUST appear in output. Returning `current` unchanged is only acceptable if (a) EN and `current` contain identical clause sets AND (b) `current` is already within ±10% of `target_chars`. Otherwise you MUST restore or expand.

REMINDER: Output ONLY the JSON object. No preamble, no markdown, no commentary, no fences. Start with { end with }.
```

## How it works in pipeline

After Phase 1 (per-segment Loop) writes localizations rows, Phase 2 Code node:
1. Filters candidates (ratio < 0.85, needs_attention=false)
2. Groups by segment_id (multi-lang per row)
3. Splits into batches of 8 segments
4. Calls Anthropic Sonnet with this prompt (CHUNK=6 parallel batches via Tier 2)
5. Pipes output through `qa_verify_system` (same as W2 Verify Translations)
6. Pipes through `editor_system` (same as W2 Gemini Editor)
7. Re-TTSes accepted expansions
8. Validates new duration ≤ en_duration (revert if overshoot)
9. Rebuilds WAV with same lead silence + new TTS + recomputed tail silence
10. Overwrites Drive file (same file ID — Build Full Audio reads new content transparently)
11. Updates localizations row

## Rollback

If Phase 2 produces issues, delete this row from Sheet OR revert workflow JSON. Old `w3_expand_system` row залишається unused (was used by inline expansion, now removed).
