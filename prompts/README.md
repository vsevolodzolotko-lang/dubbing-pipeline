# prompts/

Claude API prompt templates used across the pipeline.

| File | Purpose |
|------|---------|
| `tone-analysis.md` | Analyzes the source transcript for tone, register, and emotional cues. Output is a structured JSON used to condition translation prompts. |
| `translation.md` | Translates a single transcript segment into the target language, injecting tone context from the analysis step. |
| `adaptation.md` | Post-translation cultural adaptation pass — rewrites idioms, adjusts phrasing for naturalness, flags segments that may need human review. |

Prompts are versioned manually: bump the version comment at the top of each file when making breaking changes, and log the reason in DECISIONS.md.
