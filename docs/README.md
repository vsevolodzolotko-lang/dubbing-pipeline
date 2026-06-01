# docs/

Deep-dive reference for the pipeline. Casual overview lives in the root [`README.md`](../README.md); this folder is for when you need exact column names, exact decision rationales, or first-time setup checklists.

| File | When to open |
|---|---|
| `operator_manual.md` | **Localization manager day-to-day runbook** (Ukrainian). Drop file → wait → review → W_Regen for ad-hoc fixes. Non-technical, no jargon. Start here if you're operating the pipeline rather than building it. |
| `config_keys.md` | You need to add or change a row in the `config` sheet — full table of every key, default value, who reads it, and what behavior it controls. |
| `sheets_schema.md` | You need exact column meanings for `segments`, `localizations`, `voices`, `config` — all fields explained, plus notes on Scribe/Deepgram timestamp accuracy. |
| `drive_structure.md` | Layout of input/output Drive folders and how the pipeline names files. |
| `localization_rules.md` | Per-language translation conventions (informal address, EU vs Latin variants, etc.). Source for the system prompt. |
| `tone_of_voice.md` | Spirio brand voice reference. The `tone_of_voice` config key is a copy of this (or shorter excerpt) — keep them aligned when editing. |
| `day1_verification_checklist.md` | One-time setup checklist used during initial pipeline bring-up. Useful when onboarding a new clone of the repo. |

Decisions log (why anything was designed the way it is) lives in the root [`DECISIONS.md`](../DECISIONS.md).
