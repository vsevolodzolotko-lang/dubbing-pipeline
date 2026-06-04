# prompts/

**Reference copies** of the LLM prompt templates. The **authoritative source is the Google Sheets `prompts` tab** — all workflows read from there at runtime via `loadPrompt(key, vars)`. These `.md` files exist for review, version-tracking via git, and as starter content when setting up a fresh Sheet. See [`docs/external_review_briefing.md`](../docs/external_review_briefing.md) for the full index of 11 prompt keys with their consumers, models, and placeholders.

| File | Used by | What it does |
|---|---|---|
| `tone_analysis.md` | W2 — Prepare Tone Analysis | One call per lesson. Classifies each segment as `narrative` / `instruction` / `movement` and extracts `movement_keywords` + `key_concepts`. These two signals feed W3 — they decide whether a segment is allowed to borrow from trailing silence (movement-locked segments stay strict). Output is a single JSON keyed on `segment_id`. |
| `adaptation.md` | W2 — Adapt Translations | Bulk multi-language shorten when W2's CPS estimate predicts overflow. 3-tier progression (light → medium → max), preserves negations / contrasts / proper nouns, length floor 60% of input. |
| `adaptation_shorten.md` | W3 — Check Timing + Pad (`geminiShorten`) | Single-segment shorten when initial TTS exceeded the slot. 3 attempts (light / medium / max). Uses **Gemini 3.5 Flash** (switched from Claude Haiku on 2026-05-31 — Haiku hit a "cannot shorten further" wall on tight FR slots; Gemini Flash is also ~5-10× faster + ~10× cheaper). Char-length floor enforced in code. |
| `adaptation_expand.md` | W3 — Phase 2 (`phase2_batch_llm_tts`) | Reference doc only. Inline expansion was REMOVED from Check Timing + Pad in favor of the Phase 2 batch (Opus 4.7) which handles all undershoot candidates after Phase 1 completes — see DECISIONS. |

## Editing

The live source-of-truth is the Sheets `prompts` tab. Workflow code reads from there via `loadPrompt(key, vars)` — typo in a key throws `Missing prompt "X"` (fail-fast). If you update one of these `.md` files, ALSO paste the new content into the matching row of the Sheets `prompts` tab — otherwise runtime won't see your edits.

Hard rules embedded in every prompt:
- Output ONLY the target text — no commentary, no character counts, no markdown, no multiple drafts (these patterns are also filtered out by `sanitizeClaudeOutput()` defensively).
- Preserve negations (`no`, `not`, `without`, `never`) exactly.
- Preserve contrasts and named entities (numbers, proper nouns, techniques).
- Keep informal address (`du`, `tu`, `ty`, `sen`).
