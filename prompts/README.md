# prompts/

Reference copies of the Claude prompt templates used in the pipeline. The authoritative source is the system-prompt strings embedded in the workflow JSON / Code nodes — these `.md` files exist for review and version-tracking.

| File | Used by | What it does |
|---|---|---|
| `tone_analysis.md` | W2 — Prepare Tone Analysis | One call per lesson. Classifies each segment as `narrative` / `instruction` / `movement` and extracts `movement_keywords` + `key_concepts`. Output is a single JSON keyed on `segment_id`. |
| `adaptation.md` | W2 — Adapt Translations | Bulk multi-language shorten when W2's CPS estimate predicts overflow. 3-tier progression (light → medium → max), preserves negations / contrasts / proper nouns, length floor 60% of input. |
| `adaptation_shorten.md` | W3 — Check Timing + Pad (claudeShorten) | Single-segment shorten when initial TTS exceeded the slot. 3 attempts (light / medium / max), uses Claude Haiku, prompt-cached static prefix, char-length floor enforced in code. |
| `adaptation_expand.md` | W3 — Check Timing + Pad (claudeExpand) | Single-segment expand when initial TTS was significantly shorter than `en_duration × expansion_threshold` (0.75). Max 2 attempts, revert if overshoot. Uses Claude Haiku. |

## Editing

Most prompts are inlined into n8n Code nodes for runtime use. If you update one of these `.md` files, also update the matching template inside the workflow JSON (or the `code_nodes/*.js` source-of-truth file that gets pasted into the node).

Hard rules embedded in every prompt:
- Output ONLY the target text — no commentary, no character counts, no markdown, no multiple drafts (these patterns are also filtered out by `sanitizeClaudeOutput()` defensively).
- Preserve negations (`no`, `not`, `without`, `never`) exactly.
- Preserve contrasts and named entities (numbers, proper nouns, techniques).
- Keep informal address (`du`, `tu`, `ty`, `sen`).
