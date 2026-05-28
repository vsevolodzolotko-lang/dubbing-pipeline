# Proposed change: new `formality_fix_system` row (OPTIONAL — W2 Formality Lint)

**Sheet**: `prompts` tab — **OPTIONAL new row** with key `formality_fix_system`.

## What it does

Used by the new **W2 Formality Lint** Code node (between Adapt Translations and Update Sheet). The node deterministically scans each translation for formal-address markers (vous/Sie/usted/Lei/Pan/você/siz + FR formal imperatives) and sends ONLY the flagged cells to this prompt for a targeted informal-singular rewrite.

**This row is OPTIONAL.** The node ships with an identical built-in default prompt and uses it when this Sheet row is absent. Add the row only if you want to tweak the fix instructions without re-importing the workflow.

## Why it exists

The prompt-based guards (`translate_system` FORMALITY, `qa_verify_system` R6.c CLASS 2 + FR scan) are probabilistic and miss isolated slips — e.g. one FR segment came back `Faites confiance à la nuit` (vous) while every other segment used `tu`. R6.c documents the failure mode: when only one segment in a batch violates, the LLM scan misses it. The lint catches these deterministically (100% recall on known markers); this prompt does the linguistically-correct conversion. Since it returns text UNCHANGED when already informal, false-positive detections are harmless.

## How to add (optional)

In Sheets `prompts` tab → new row:

**key:**
```
formality_fix_system
```

**description:**
```
W2 Formality Lint — rewrites formal-address cells to informal singular. Only flagged cells are sent. Returns text unchanged if already informal. Changes ONLY address/formality, never meaning/length.
```

**value** (paste the block between backticks):

```
You convert formal-address meditation/wellness translations to INFORMAL SINGULAR.
INPUT: a JSON object mapping segment_id -> { en, <lang>: text } (only the langs that need fixing are present per segment).
For each cell, rewrite the text using informal singular address for THAT language, changing ONLY address/formality — pronouns, verb conjugation, possessives. Keep meaning, vocabulary, register, length and any "..." or "—" pause markers IDENTICAL. Do not translate across languages; each cell stays in its own language.
Informal targets:
- DE: du/dich/dein (never Sie/Ihnen/Ihr)
- ES: Castilian tú/te/tu (never usted/le/su, never vos/ustedes)
- FR: tu/te/ton/ta/tes; imperatives in TU form: Prends (not Prenez), Inspire (not Inspirez), Laisse (not Laissez), Fais (not Faites), Ferme (not Fermez), Ouvre (not Ouvrez), Commence (not Commencez), Respire (not Respirez) (never vous/votre/vos)
- IT: tu/ti/tuo/tua (never Lei/La/Suo/Voi)
- PL: ty-form verbs (jesteś, czujesz, weź) (never Pan/Pani/Państwo)
- PT: European tu/te/teu/tua with EU conjugation (tu fazes, tu sentes) (never Brazilian você/seu/sua)
- TR: sen/seni/senin (never siz/sizi/sizin)
GENDER NEUTRALITY: the listener's gender is unknown. When rewriting verbs/pronouns/adjectives toward informal singular, default to gender-neutral phrasing where possible; otherwise use FEMININE forms — never masculine. ES "lista/preparada/tranquila/cansada"; FR "prête/détendue/fatiguée"; PL "gotowa/spokojna/zmęczona" with feminine past tense "byłaś/siedziałaś/leżałaś" (not byłeś/siedziałeś/leżałeś); PT "pronta/cansada/tranquila/acordada"; IT "pronta/stanca/tranquilla/sveglia". DE and TR are already neutral. If the input already had a masculine listener-form, fix it on the way through — gender is part of address correction.
If a cell is ALREADY informal AND gender-correct, return it UNCHANGED.
OUTPUT ONLY a JSON object mapping segment_id -> { <lang>: corrected_text }, the SAME segment_ids and langs as input. No preamble, no markdown, no commentary, no ```json fences. Start with { and end with }.
```

## Rollback

Delete the row → the node falls back to its built-in default prompt (no behavior change). To disable the lint entirely, remove the `Formality Lint` node from W2 (Adapt Translations → Update Sheet direct).
