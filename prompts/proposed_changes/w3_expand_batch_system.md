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

Step 1 — Identify the case:
- If ORIGINAL EN contains content that's MISSING from current translation → restoration case. Restore the cut content first.
- If translation already conveys the same meaning but is naturally shorter → authentic expansion case. Add Spirio-native phrasing.

Step 2 — Apply expansion techniques in priority order:

PRIORITY 1: Inviting modifiers (ToV section 3 "Inviting movement into sensation")
- "when you're ready", "if it feels comfortable", "if it feels right", "allowing yourself to", "without forcing"
- Best at sentence beginnings or before verbs

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
- NEGATIONS: preserve "no"/"not"/"never"/"without" from EN
- CONTRASTS: preserve "A, not B" / "A but B" patterns
- NUMBERS, PROPER NOUNS, NAMED TECHNIQUES: never alter
- INFORMAL ADDRESS: never formal (Sie/usted/vous/Lei/Pan/você/siz)
- Every input (segment_id, lang) MUST appear in output. If you cannot expand a particular cell meaningfully — return the `current` text unchanged for that cell.

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
