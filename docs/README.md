# docs/

Deep-dive reference for the pipeline. Casual overview lives in the root [`README.md`](../README.md); this folder is for when you need exact column names, exact decision rationales, or first-time setup checklists.

| File | When to open |
|---|---|
| `operator_manual.md` | **Localization manager day-to-day runbook** (Ukrainian). Drop file → archive happens automatically → wait → review `needs_attention` → W_Regen via Slack link for fixes, or ElevenLabs UI for crisis cases. Non-technical. Start here if you're operating the pipeline rather than building it. |
| `config_keys.md` | You need to add or change a row in the `config` sheet — full table of every key, default value, who reads it, and what behavior it controls. Includes the dead keys (`short_seg_threshold_sec`, old `max_speed`, `min_speed`). |
| `sheets_schema.md` | You need exact column meanings for `segments`, `localizations`, `voices`, `config`, `prompts` — all 5 tabs with fields explained, including the tri-state `needs_attention` lifecycle (TRUE→REVIEW→FALSE) and Scribe/Deepgram timestamp accuracy notes. |
| `drive_structure.md` | Layout of all 5 Drive folders (`01_input`, `02_output`, `03_full`, `04_vtt`, `05_archive`), file-name conventions, per-language WAV alignment invariants, and how the archive-rotation chain works on each W_Master run. |
| `localization_rules.md` | Per-language translation conventions (informal address, EU vs Latin variants, etc.). Source for the system prompt. |
| `tone_of_voice.md` | Spirio brand voice reference. The `tone_of_voice` config key is a copy of this (or shorter excerpt) — keep them aligned when editing. |
| `cps_calibration.md` | When `needs_attention` rate is suspiciously high on a single language: how to derive better `cps_estimate_{lang}` values from a recent localizations CSV. |
| `external_review_briefing.md` | Self-contained brief (~2800 words) for pasting into an external LLM (GPT-5 / Gemini / Opus) to evaluate prompt quality or suggest architecture changes. Snapshot of current state — re-generate manually after big pipeline edits. |
| `day1_verification_checklist.md` | One-time setup checklist used during initial pipeline bring-up. Useful when onboarding a new clone of the repo. |

Decisions log (why anything was designed the way it is) lives in the root [`DECISIONS.md`](../DECISIONS.md).
