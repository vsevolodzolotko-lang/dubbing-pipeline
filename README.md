# Dubbing Pipeline

Automated dubbing for wellness/meditation video courses. English audio in → 7 dubbed `.wav` tracks out (DE, ES, FR, IT, PL, PT, TR), aligned to the original timeline.

## Status

**Production-ready** for the segment-level dub flow. End-to-end run (≈60-second lesson) takes ~2 minutes and costs ~$0.10–0.15 per language. Drop a file into a Drive `input/` folder and W_Master chains W1 → W2 → W3 automatically, then pings Slack on completion.

## Stack

- **n8n** — orchestrates 3 workflows (W1 → W2 → W3), optionally chained by W_Master (Drive folder trigger)
- **Deepgram Nova-3** — STT + sentence-level timestamps (W1)
- **Claude Sonnet 4.5** — translation, tone analysis, large adapt loop (W2)
- **Claude Haiku 4.5** — short-tail adapt + expansion inside synthesize (W3)
- **ElevenLabs `eleven_multilingual_v2`** — TTS per language (W3)
- **Google Drive** — audio input + output (per-segment WAVs + full-lesson WAVs)
- **Google Sheets** — translation tracking, voice config, run-time diagnostics

---

## Pipeline at a glance

```
[W_Master]  Drive Trigger (input/) → Parse Filename → Execute W1 → W2 → W3 → Slack
                                                              │
                                                              ▼  (file_id, lesson_id passed in)
EN audio (Drive)
    │
    ▼
[W1] STT_and_Segment
    Download Audio → Deepgram STT → Segment Transcript → Write to segments sheet
    Output: segments rows with en_text, en_start_sec, en_end_sec, en_duration_sec
    │
    ▼
[W2] Translate v2
    Read Config / Pending Segments → Tone Analysis (Claude) → Prepare and Expand
    → Claude Translate → Verify (false-friend / semantic) → Editor (native-rhythm)
    → Formality Lint (deterministic informal address) → Extract Translations
    → Loop Adapt (SplitInBatches=15) → Adapt Translations (3-tier unified shorten)
    → Update segments sheet with 7 lang translations
    │
    ▼
[W3] Synthesize v2
    Read Config / Voices / Segments → Expand TTS Jobs → Loop Phase 1 (SplitInBatches):
        ElevenLabs TTS → Check Timing + Pad (Claude shorten/expand + dynamic per-voice speed)
        → Save to Drive (per-segment .wav) → Update localizations sheet
    Loop Phase 1 done → Read Localizations Fresh → Phase 2 (slowdown-to-fill)
        → Batch LLM (Opus 4.7 expand via ToV patterns) + Verify + Editor + Formality Lint
        → reTtsOne speed-up retry on overshoot → refusal/false-friend safety nets
        → Update localizations sheet + per-segment WAVs
    Phase 2 done → Read Localizations Fresh 2 → Download Segment WAV
        → Build Full Audio Per Lang → Save Full to Drive (7 full .wav files)
        → Emit VTT per lang → Save VTT to Drive
```

**W_Regen** (atomic single-segment regenerate) runs out-of-band: webhook input `{segment_id, lang, optional new_text}` → TTS → Check Timing + Pad → overwrite the existing Drive WAV in place (no duplicate files, deterministic filename matching).

Output in Drive:
- **Per-segment files**: `{drive_output_folder_id}/{lesson_id}_seg_NNN_{lang}.wav`
- **Full per-lang files**: `{drive_output_full_folder_id}/{lesson_id}_full_{lang}.wav`

---

## Quick start

1. **Google Sheet** — create a sheet with 4 tabs: `config`, `segments`, `voices`, `localizations`. Schema details in [`docs/sheets_schema.md`](docs/sheets_schema.md). Required config keys: `anthropic_api_key`, `elevenlabs_api_key`, `tone_of_voice`, `drive_output_folder_id`, `drive_output_full_folder_id`. Optional (for W_Master): `drive_input_folder_id`, `slack_channel`. See [`docs/config_keys.md`](docs/config_keys.md) for the full list.
2. **n8n credentials** — bind:
    - Google Sheets account (for all Sheets nodes)
    - Google Drive account (for all Drive nodes, including W_Master's Drive Trigger)
    - Deepgram Header Auth (`Authorization: Token <key>`) — for W1 STT
    - ElevenLabs Header Auth (`xi-api-key: <key>`) — for W3 TTS
    - Slack account (Bot User OAuth Token `xoxb-...`) — for W_Master completion notification
3. **Drive folders** — create `input/`, `output/`, and `output/full/` folders, copy their IDs into config.
4. **Voices tab** — fill in voice IDs from ElevenLabs Studio for the 7 langs.
5. **Prompts tab** — populate a fifth `prompts` tab with 11 prompts + ToV (keys, templates, placeholders). See [`docs/external_review_briefing.md`](docs/external_review_briefing.md) for the index of prompt keys and roles. Missing-key → fail-fast at runtime.
6. **Import workflows** — `workflows/W1_STT_and_Segment.json`, `workflows/W2_Translate_v2.json`, `workflows/W3_Synthesize_v2.json`, then `workflows/W_Master.json` and (optional) `workflows/W_Regen.json` into n8n. Re-bind credentials on each node after import. In W_Master: re-bind the three Execute Workflow nodes to the IDs n8n assigned to W1/W2/W3.
7. **Run**:
    - **Auto**: drop an EN audio file (named `{lesson_id}.mp3`, e.g. `sleep_002.mp3`) into the Drive `input/` folder. W_Master picks it up within ~1 min and runs the whole pipeline.
    - **Manual** (debug): execute W1's Manual Trigger (reads `file_id`/`lesson_id` from the `config` sheet — see commits `582fbe8` / `eb4a115`), then run W2 and W3.
    - **Single-segment regen**: POST to W_Regen webhook with `{segment_id, lang, new_text?}` — see "Common tasks" below.

---

## Google Sheets cheatsheet

The sheet has **4 tabs**. Each row of the pipeline reads from / writes to specific tabs:

### `config` — key/value runtime parameters

One row = one key. Read by all workflows. **Edit manually** when you need to tweak behavior.

| Group | Keys | Used by |
|---|---|---|
| **API auth** | `anthropic_api_key`, `elevenlabs_api_key`, `deepgram_api_key` (optional — actual auth via n8n credentials) | W1, W2, W3 |
| **Drive output** | `drive_output_folder_id`, `drive_output_full_folder_id` | W3 |
| **Translation** | `tone_of_voice` (long ToV doc), `active_langs` (default `de,es,fr,it,pl,pt,tr` — gates every stage of W2 and W3; set to e.g. `de` for a single-lang dry-run) | W2, W3 |
| **Timing** | `min_inter_segment_gap_sec` (0.3), `max_borrow_per_segment_sec` (2.0), `short_seg_threshold_sec` (2.0), `silence_lead_ratio` (0.2), `silence_lead_max_sec` (0.05), `expansion_threshold` (0.75) | W3 |
| **Speed/retry** | `max_speed_up_delta` (0.20), `max_slow_down_delta`, `max_adaptation_attempts` (3) | W2, W3 |

> **Optional CPS tuning**: `cps_estimate_de`, …, `cps_estimate_tr` — per-lang chars-per-second overrides. If present, override `CPS_DEFAULTS` in the W2/W3 code. Run `node scripts/analyze_cps.js <localizations.csv>` after a W3 run to derive recommended values from real TTS output. Useful after voice changes.
>
> **Borrow behavior**: `max_borrow_per_segment_sec` is **active**, but only for short segments. When `en_duration_sec < short_seg_threshold_sec` (default 2.0s) AND there's trailing silence, the TTS audio may extend up to `max_borrow_per_segment_sec` seconds into the next gap (capped by `gap_after_sec - min_inter_segment_gap_sec`). Normal-length segments stay strict-aligned. Concat-time compensation in Build Full Audio trims the borrowed amount from the next segment's lead silence — so the **full WAV stays aligned with EN despite per-segment overshoot**. Set `short_seg_threshold_sec=0` to fully disable borrow. See DECISIONS `CONDITIONAL_BREATH_BORROW_FOR_SHORT_SEGMENTS` (2026-05-19) and `BORROW_DRIFT_FIX_AT_CONCAT_TIME` (2026-05-19).
>
> **Dead keys**: `min_speed` (never wired up) and old absolute `max_speed` (superseded 2026-05-27 by `max_speed_up_delta` / `max_slow_down_delta` — both relative to per-voice `speed`). Safe to delete from the sheet.

### `segments` — source data, one row per EN sentence-group

Written by **W1**, then updated by **W2** (translations) and **W3** (none — read-only). Manual edits OK if Deepgram timestamps need correction.

Key columns:
- `segment_id` — `{lesson_id}_seg_NNN` zero-padded
- `en_text`, `en_start_sec`, `en_end_sec`, `en_duration_sec` — from W1
- `segment_type`, `movement_keywords` — from W2 tone analysis
- `{lang}_text` × 7 — translations from W2
- `{lang}_adaptation_attempts` × 7 — how many shorten retries W2 used per lang
- `status` — currently legacy (always `pending`); not updated by W2/W3

Full schema: [`docs/sheets_schema.md#sheet-segments`](docs/sheets_schema.md).

### `voices` — voice configuration per language

One row per lang. Read by **W3** during TTS. Set up once, rarely touched.

| Column | Example | Notes |
|---|---|---|
| `lang` | `de` | Must match codes in `active_langs` |
| `voice_id` | `a0CA83xXpwCwAaIpZXae` | From ElevenLabs Studio |
| `voice_name` | (optional) | Human-readable, not used by code |
| `model` | `eleven_multilingual_v2` | Currently fixed |
| `stability` | `0.5` | 0–1, ElevenLabs voice setting |
| `similarity_boost` | `0.75` | 0–1 |
| `style` | `0` | 0–1, generally keep 0 for meditation |
| `speed` | `1.0` | Default playback speed |

### `localizations` — run-time per-segment-per-lang diagnostics

Written by **W3** during synthesize loop. One row per `(segment_id × lang)` combo. **Never edit manually** — it's the system's log of what actually got generated.

Columns to watch when debugging:
- `final_duration_sec` — should be identical across all 7 langs for one segment (cross-lang alignment)
- `borrowed_sec` — 0 for normal-length segments (strict alignment). Non-zero (up to `max_borrow_per_segment_sec`) is **expected and intentional** for short segments (`en_duration_sec < short_seg_threshold_sec`) — see DECISIONS `CONDITIONAL_BREATH_BORROW_FOR_SHORT_SEGMENTS`. Concat-time compensation neutralizes drift in the full WAV.
- `needs_attention=TRUE` — segment hit max speed and still didn't fit; review the translation
- `shorten_retries_in_synthesize` ≥ 3 — Claude tried max-aggressive shorten; check quality
- `expansion_attempts` > 0 — W3 expanded an over-shortened W2 translation
- `phase2_outcome` — Phase 2 verdict per cell: `accepted` / `rejected_*` / `llm_refusal` / `llm_dropped`. Anything other than `accepted` means Phase 2 reverted to Phase 1 audio
- `phase2_diag` — JSON with per-attempt diagnostics (refusalsAttempt1, retryCoverage, etc.); inspect when `phase2_outcome != accepted`
- `final_speed` — actual ElevenLabs `speed` used (dynamic per-voice + Phase 1 shorten retries + Phase 2 reTtsOne speed-up)
- `audio_drive_file_id` — Drive file ID of the per-segment WAV

Full schema (every column explained): [`docs/sheets_schema.md#sheet-localizations`](docs/sheets_schema.md).

---

## File structure

```
.
├── README.md                            # this file
├── PLAN.md                              # MVP done; post-MVP R1-R7+Phase 2 done; open ship items
├── DECISIONS.md                         # architecture decisions log (chronological)
├── workflows/                           # n8n workflow exports
│   ├── W_Master.json                    # Drive folder trigger → W1 → W2 → W3 → Slack
│   ├── W1_STT_and_Segment.json          # Deepgram STT → segments sheet
│   ├── W2_Translate_v2.json             # Tone + Translate + Verify + Editor + Formality + Adapt
│   ├── W3_Synthesize_v2.json            # TTS + Phase 1 timing + Phase 2 slowdown-to-fill + Concat + VTT
│   └── W_Regen.json                     # webhook: atomic single-segment regenerate (in-place overwrite)
├── code_nodes/                          # JS for n8n Code-node bodies (reference copies)
│   ├── prepare_tone_analysis.js
│   ├── parse_tone_analysis.js
│   ├── prepare_and_expand.js
│   ├── extract_translations.js
│   ├── adapt_translations.js
│   ├── formality_lint.js
│   ├── gemini_editor.js                 # native-rhythm Editor (default)
│   ├── openai_editor.js                 # cross-model Editor (alt)
│   ├── check_timing_and_pad.js
│   ├── phase2_batch_llm_tts.js          # Phase 2: Opus 4.7 expand via ToV patterns + reTTS
│   ├── build_full_audio_per_lang.js
│   ├── build_vtt_per_lang.js
│   ├── regen_synthesize.js              # W_Regen synthesize body
│   └── predelete_drive_files.js         # W_Regen overwrite helper
├── prompts/                             # local reference; runtime source-of-truth is Sheets `prompts` tab
│   ├── tone_analysis.md
│   ├── adaptation.md
│   ├── adaptation_shorten.md
│   ├── adaptation_expand.md
│   └── proposed_changes/                # staged prompt edits (e.g. Phase 2 retry templates)
├── docs/
│   ├── config_keys.md
│   ├── sheets_schema.md
│   ├── drive_structure.md
│   ├── localization_rules.md
│   ├── tone_of_voice.md                 # ToV v3 (universal + per-content-type + translation considerations)
│   ├── cps_calibration.md
│   ├── external_review_briefing.md      # self-contained brief for external LLM prompt/architecture review
│   └── day1_verification_checklist.md
├── scripts/
│   ├── test_apis.js                     # smoke test for Anthropic + ElevenLabs API keys
│   ├── analyze_cps.js                   # CPS calibration from localizations CSV (see scripts/README.md)
│   ├── verify_borrow_compensation.js    # post-run alignment audit
│   └── sync_w2_jscode.js                # sync code_nodes/*.js back into W2 JSON
└── tests/
    └── (audio fixtures)
```

---

## Common tasks

- **Add a new language** → add row to `voices` tab + add code to `active_langs` config key
- **Regenerate one segment** → POST to W_Regen webhook with `{segment_id, lang, new_text?}`. W_Regen re-TTSes, runs Check Timing + Pad, and overwrites the existing Drive WAV in place (no duplicate files). If `new_text` is provided, W2 is skipped — the supplied text is used directly.
- **Edit a prompt** → edit the row in the Sheets `prompts` tab. Runtime reads from sheet via `loadPrompt(key, vars)` — typo in a key throws `Missing prompt "X"` (fail-fast). Local `prompts/*.md` are reference-only.
- **Tune ToV** → edit `tone_of_voice` config value (long-form ToV doc). Current canonical version is mirrored in [`docs/tone_of_voice.md`](docs/tone_of_voice.md) (ToV v3).
- **Tune shortening aggressiveness / calibrate after a voice swap** → set `cps_estimate_{lang}` in the `config` sheet (per-language chars/sec). Full 5-step runbook with example output is in [`scripts/README.md`](scripts/README.md#cps-calibration-runbook). Falls back to `CPS_DEFAULTS` in `code_nodes/check_timing_and_pad.js` / `code_nodes/adapt_translations.js` when a config row is missing.
- **Tune inter-segment gap** → change `min_inter_segment_gap_sec` in config
- **Audit a run for QA** → after a W3 prog, filter `localizations` by `needs_attention=TRUE` OR `phase2_outcome != 'accepted'` OR `shorten_retries_in_synthesize >= 3` — those are the rows worth listening to.

---

## Cost estimate

Baseline (~60-second lesson, 7-9 segments × 7 languages):
- Deepgram Nova-3 (W1): ~$0.005
- Claude (W2 + W3): ~$0.05–0.10 (Sonnet 4.5 for translate/verify/editor, Haiku 4.5 for W3 shorten/expand, Opus 4.7 for Phase 2 expand, prompt caching)
- ElevenLabs TTS: ~$0.05–0.10 (~100 chars per segment × 49 calls + speed retries + Phase 2 re-TTS)

**Total: ~$0.10–0.25 per lesson** for all 7 languages at the 60-sec baseline. Longer lessons scale ~linearly (sleep1_full @ 11 min ≈ 47 segments × 7 langs = 329 cells); per-lesson real-cost telemetry on long-form is in PLAN's Open items (nice-to-have).

---

## More

- Roadmap & status: [PLAN.md](PLAN.md)
- Why decisions were made the way they were: [DECISIONS.md](DECISIONS.md)
- Deep schema reference: [docs/sheets_schema.md](docs/sheets_schema.md), [docs/config_keys.md](docs/config_keys.md)
- External LLM review brief: [docs/external_review_briefing.md](docs/external_review_briefing.md)
