# Dubbing Pipeline

Automated dubbing for wellness/meditation video courses. English audio in → 7 dubbed `.wav` tracks out (DE, ES, FR, IT, PL, PT, TR), aligned to the original timeline.

## Status

**Production-ready**. Drop a file into the Drive `01_input/` folder → W_Master archives the previous run into `05_archive/`, runs W1 → W2 → W3 on the new file, posts a Slack message with `needs_attention` rate and clickable links to per-segment audio, full audio, VTT subtitles, and a one-click Regen Segments launcher. End-to-end run (≈60-second lesson) takes ~2 minutes and costs ~$0.10–0.25 across all 7 languages.

## Stack

- **n8n** — orchestrates 3 workflows (W1 → W2 → W3), chained by W_Master (Drive folder trigger + archive rotation)
- **Deepgram Nova-3** — STT + sentence-level timestamps (W1)
- **Claude Sonnet 4.5** — translation, tone analysis (W2)
- **Gemini 3.5 Flash** — native-rhythm editor (W2) + single-segment shortener (W3)
- **Claude Opus 4.7** — Phase 2 batch expansion (W3)
- **ElevenLabs `eleven_multilingual_v2`** — TTS per language (W3)
- **Google Drive** — audio input/output, per-segment WAVs, full WAVs, VTT, plus archive snapshots
- **Google Sheets** — translation tracking, voice config, run-time diagnostics, externalized prompts

---

## Pipeline at a glance

```
[W_Master]  Drive Trigger (01_input/) → Parse Filename → Once Per Run
              ↓
              (branch) write run_token / clear abort_token → Slack "🚀 Localization started" + 🛑 Stop button
              ↓
              Archive chain (11 nodes): list 4 working folders → exclude just-dropped trigger files
                  → create 05_archive/{prev_basename}_{YYYY-MM-DD_HH-MM} (Kyiv tz)
                  → copy live Sheet as sheet_snapshot_{archive_name}
                  → move stale files via Drive PATCH addParents/removeParents
                  → clear segments+localizations tabs (voices/prompts/config untouched)
              ↓
              Execute W1 → W2 → W3 → Slack notification (with needs_attention rate + 4 folder links)

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
    → Claude Translate (Sonnet 4.5) → Verify (false-friend / semantic) → Gemini Editor (native-rhythm)
    → Formality Lint (deterministic informal address) → Extract Translations
    → Loop Adapt (SplitInBatches=15) → Adapt Translations (3-tier unified shorten)
    → Update segments sheet with 7 lang translations
    │
    ▼
[W3] Synthesize v2
    Read Config / Voices / Segments → Expand TTS Jobs (carries movement_keywords + segment_type)
    → Loop Phase 1 (SplitInBatches):
        ElevenLabs TTS → Check Timing + Pad (Gemini shorten + dynamic per-voice speed + permissive
        silence-borrow for non-movement segments) → Save to Drive (per-segment .wav)
        → Trim Lead For Sequence (concat-time alignment) → Update localizations sheet
    Loop Phase 1 done → Read Localizations Fresh → Phase 2 (slowdown-to-fill)
        → Batch LLM (Opus 4.7 expand via ToV patterns) + Verify + Editor + Formality Lint
        → reTtsOne speed-up retry on overshoot → refusal/false-friend safety nets
        → Update localizations sheet + per-segment WAVs
    Phase 2 done → Read Localizations Fresh 2 → Download Segment WAV
        → Build Full Audio Per Lang → Save Full to Drive (7 full .wav files)
        → Emit VTT per lang → Save VTT to Drive
```

**W_Regen** (atomic single-segment regenerate) is triggered TWO ways:
- **Slack link "Regen Segments"** in W_Master/W_Regen notifications opens a public Webhook Trigger (GET `…/webhook/w-regen`, responds immediately with "Regen started", workflow runs in background). No n8n login required.
- **Manual Trigger** in n8n UI for the editor-flow operator.

Both paths read `needs_retts=TRUE` rows from the `localizations` sheet — operator flags rows manually before triggering. W_Regen re-TTSes each flagged cell with Phase 1-style timing logic, overwrites the per-segment Drive WAV in place (no duplicates), rebuilds full WAV + VTT for affected lessons, and posts a Slack notification on completion. On successful regen, `needs_attention` becomes `REVIEW` (yellow) for human verification — operator listens and flips to `FALSE` (accept) or `TRUE` (still bad).

**W_Abort** (cooperative stop) backs the **🛑 Stop localization** button on W_Master's start message. The button is a real Block Kit action with a native confirm dialog; clicking + confirming sends a signed Slack interactivity POST to W_Abort's `…/webhook/slack-actions`. W_Abort verifies the Slack signature (`slack_signing_secret`, HMAC-SHA256 + 5-min replay guard) via an n8n Crypto node, then writes `localization_abort_token` = the run's token. The W3 Dispatch `Check Abort` node — re-entered once per language, where a long run actually spends its hours — halts the continuation chain as soon as `abort_token === run_token`. Stop is **cooperative**: the current language finishes, no further language synthesizes; in-flight W1/W2 complete but synthesis never starts. Each run's token is fresh (W_Master clears the abort flag at start), so a stale stop never blocks a new run.

Output in Drive (the operator's folder layout):
- `01_input/` (`drive_input_folder_id`) — source mp3s
- `02_output/` (`drive_output_folder_id`) — per-segment WAVs `{lesson_id}_seg_NNN_{lang}.wav`
- `03_full/` (`drive_output_full_folder_id`) — full-lesson WAVs `{lesson_id}_full_{lang}.wav`
- `04_vtt/` (`drive_output_vtt_folder_id`) — subtitle files `{lesson_id}_full_{lang}.vtt`
- `05_archive/` (`drive_archive_folder_id`) — dated snapshots of every previous run with sheet copy

---

## Quick start

1. **Google Sheet** — create a sheet with **5 tabs**: `config`, `segments`, `voices`, `localizations`, `prompts`. Schema details in [`docs/sheets_schema.md`](docs/sheets_schema.md). Required config keys: `anthropic_api_key`, `gemini_api_key`, `elevenlabs_api_key`, `tone_of_voice`, `drive_input_folder_id`, `drive_output_folder_id`, `drive_output_full_folder_id`, `drive_output_vtt_folder_id`, `drive_archive_folder_id`, `slack_channel`, `w_regen_workflow_url`, `slack_signing_secret` (for the Stop button). Full list (with defaults + dead keys): [`docs/config_keys.md`](docs/config_keys.md).
2. **n8n credentials** — bind:
    - Google Sheets account (for all Sheets nodes; ALSO bound on W_Master `Archive Previous Run`-step Sheets-clear HTTP node)
    - Google Drive account (for all Drive nodes, including W_Master's Drive Trigger and the 5 archive HTTP nodes)
    - Deepgram Header Auth (`Authorization: Token <key>`) — for W1 STT
    - ElevenLabs Header Auth (`xi-api-key: <key>`) — for W3 TTS
    - Slack account (Bot User OAuth Token `xoxb-...`) — for W_Master + W_Regen + W_Abort Slack notifications (scope `chat:write`)
3. **Drive folders** — create 5 folders: `01_input/`, `02_output/`, `03_full/`, `04_vtt/`, `05_archive/`. Copy their IDs into the config sheet (`drive_input_folder_id`, `drive_output_folder_id`, `drive_output_full_folder_id`, `drive_output_vtt_folder_id`, `drive_archive_folder_id`). See [`docs/drive_structure.md`](docs/drive_structure.md) for what each holds.
4. **Voices tab** — fill in voice IDs from ElevenLabs Studio for the 7 langs.
5. **Prompts tab** — populate the `prompts` tab with 11 prompts + ToV (keys, templates, placeholders). See [`docs/external_review_briefing.md`](docs/external_review_briefing.md) for the index of prompt keys and roles. Missing-key → fail-fast at runtime.
6. **Import workflows** — `workflows/W1_STT_and_Segment.json`, `workflows/W2_Translate_v2.json`, `workflows/W3_Synthesize_v2.json`, then `workflows/W_Master.json`, `workflows/W_Regen.json`, `workflows/W3_Dispatch.json`, `workflows/W_Abort.json`, and `workflows/W_Error.json` into n8n. Re-bind credentials on each node after import. In W_Master: re-bind the three Execute Workflow nodes to the IDs n8n assigned to W1/W2/W3.
6b. **Wire the failure notifier** — after importing `W_Error`, open **each** of W_Master / W3_Synthesize_v2 / W3_Dispatch / W_Abort → **Settings → Error Workflow → select "W_Error"** (UI dropdown by name — more reliable than the hardcoded id, which n8n may reassign on import). Now any uncaught crash posts `❌ Локалізація впала` to Slack with the failing workflow, step, error, and execution link. (W1/W2 are intentionally left unset — their failures bubble up to W_Master, so they're covered once without duplicate alerts.)
7. **Activate W_Regen** in n8n UI (top-right toggle) → open the `Webhook Trigger` node → copy the **Production URL** (e.g. `https://your-n8n/webhook/w-regen`) → paste into config sheet as `w_regen_workflow_url`. Without an active webhook + URL, the Slack "Regen Segments" link is omitted.
7b. **Activate W_Abort + wire the Slack Stop button** — (a) activate `W_Abort` in n8n, open its `Slack Actions Webhook` node, copy the **Production URL** (ends in `/webhook/slack-actions`); (b) in your Slack app → **Interactivity & Shortcuts** → toggle ON → set **Request URL** to that webhook URL; (c) copy the app's **Signing Secret** (Basic Information → App Credentials) into config sheet as `slack_signing_secret`. Now the "🛑 Stop localization" button on W_Master's start message works. Without this, the start message still posts but the button is inert (and any unsigned POST to the webhook is rejected).
8. **Sheets UI: conditional formatting** on `needs_attention` column — `TRUE` red / `FALSE` green / `REVIEW` yellow. On `needs_retts` — `TRUE` green / `FALSE` red. See [`docs/sheets_schema.md`](docs/sheets_schema.md) for setup steps.
9. **Run**:
    - **Auto**: drop an EN audio file (named `{lesson_id}.mp3`, e.g. `sleep_002.mp3`) into the Drive `01_input/` folder. W_Master picks it up within ~1 min, archives the previous run, then runs W1 → W2 → W3 and posts to Slack.
    - **Manual** (debug): execute W1's Manual Trigger (reads `file_id`/`lesson_id` from the `config` sheet), then run W2 and W3.
    - **Single-segment regen**: flag rows with `needs_retts=TRUE` in `localizations` → click "Regen Segments" link in Slack notification (or W_Regen's Manual Trigger). See "Common tasks" below.

---

## Google Sheets cheatsheet

The sheet has **5 tabs**. Each row of the pipeline reads from / writes to specific tabs:

### `config` — key/value runtime parameters

One row = one key. Read by all workflows. **Edit manually** when you need to tweak behavior.

| Group | Keys | Used by |
|---|---|---|
| **API auth** | `anthropic_api_key`, `gemini_api_key`, `elevenlabs_api_key`, `deepgram_api_key` (optional — actual auth via n8n credentials) | W1, W2, W3 |
| **Drive folders** | `drive_input_folder_id`, `drive_output_folder_id`, `drive_output_full_folder_id`, `drive_output_vtt_folder_id`, `drive_archive_folder_id`, `sheets_document_id` (optional) | W_Master archive, W3 |
| **Slack** | `slack_channel`, `w_regen_workflow_url` (optional — Slack link omitted if missing), `slack_signing_secret` (verifies the Stop button) | W_Master + W_Regen + W_Abort Slack messages |
| **Run state** *(managed by workflows — do not edit)* | `localization_run_token` (stamped at run start), `localization_abort_token` (set by Stop button) | W_Master, W_Abort, W3 Dispatch |
| **Translation** | `tone_of_voice` (long ToV doc), `active_langs` (default `de,es,fr,it,pl,pt,tr` — gates every stage of W2 and W3; set to e.g. `de` for a single-lang dry-run) | W2, W3 |
| **Timing** | `min_inter_segment_gap_sec` (0.4), `max_borrow_per_segment_sec` (2.0), `silence_lead_ratio` (0.2), `silence_lead_max_sec` (0.05), `expansion_threshold` (0.75) | W3 |
| **Speed/retry** | `max_speed_up_delta` (0.20), `max_slow_down_delta` (0.15), `regen_concurrency` (5) | W2, W3, W_Regen |

> **Optional CPS tuning**: `cps_estimate_de`, …, `cps_estimate_tr` — per-lang chars-per-second overrides. If present, override `CPS_DEFAULTS` in the W2/W3 code. Run `node scripts/analyze_cps.js <localizations.csv>` after a W3 run to derive recommended values from real TTS output. Useful after voice changes.
>
> **Borrow behavior** (revised 2026-06-04): `max_borrow_per_segment_sec` is **active for all non-movement segments**. Any segment with trailing silence available (`gap_after_sec > min_inter_segment_gap_sec`) may extend its TTS audio up to `max_borrow_per_segment_sec` seconds into the gap. EXCEPTION: movement-locked segments (where `movement_keywords` is non-empty OR `segment_type == 'movement'`) stay strict at `en_duration_sec` — these need to sync with video movement, so overshoot must hard-truncate + flag `needs_attention=TRUE`. Concat-time `Trim Lead For Sequence` trims the next segment's lead silence by the borrowed amount — so the **full WAV stays aligned with EN despite per-segment overshoot**, and per-segment durations sum to the full WAV per language. See DECISIONS `PERMISSIVE_BORROW_FOR_NONMOVEMENT_SEGMENTS_2026-06-04`.
>
> **Dead keys**: `min_speed` (never wired up), old absolute `max_speed` (superseded 2026-05-27 by `max_speed_up_delta` / `max_slow_down_delta`), and `short_seg_threshold_sec` (superseded 2026-06-04 by the movement-keyword gate). Safe to delete from the sheet.

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

Written by **W3** during synthesize loop. One row per `(segment_id × lang)` combo. **Wiped at the start of every W_Master run** (rows 2+ batch-cleared by Archive Previous Run; previous data preserved in `05_archive/{archive_name}/sheet_snapshot_{archive_name}`).

Columns to watch when debugging:
- `final_duration_sec` — per-language file duration. May differ across langs for non-movement segments (one lang borrowed into trailing silence, another didn't). Concat-time Trim Lead For Sequence keeps full WAVs EN-aligned.
- `borrowed_sec` — non-zero for non-movement segments that extended past `en_duration_sec` into trailing silence (bounded by `max_borrow_per_segment_sec` and `gap_after - min_inter_segment_gap_sec`). 0 for movement-locked segments (forced strict). 0 for any segment that fit naturally.
- `needs_attention` — tri-state text: `TRUE` (red) auto-detected problem, `FALSE` (green) clean or human-verified, `REVIEW` (yellow, written by W_Regen on successful regen — human must listen + flip).
- `needs_retts` — `TRUE` → operator flagged this cell for W_Regen pickup. W_Regen clears to `FALSE` after processing.
- `shorten_retries_in_synthesize` ≥ 3 — Gemini tried max-aggressive shorten; check quality
- `expansion_attempts` > 0 — Phase 2 expanded an over-shortened W2 translation
- `phase2_outcome` — Phase 2 verdict per cell: `accepted` / `rejected_*` / `llm_refusal` / `llm_dropped`. Anything other than `accepted` means Phase 2 reverted to Phase 1 audio
- `phase2_diag` — JSON with per-attempt diagnostics (refusalsAttempt1, retryCoverage, etc.); inspect when `phase2_outcome != accepted`
- `final_speed` — actual ElevenLabs `speed` used (dynamic per-voice + Phase 1 shorten retries + Phase 2 reTtsOne speed-up)
- `audio_drive_file_id` — Drive file ID of the per-segment WAV
- `last_regen_at` — Kyiv-local datetime of last W_Regen run on this row (e.g. `2026-06-04 10:53:47`)

Full schema (every column explained): [`docs/sheets_schema.md#sheet-localizations`](docs/sheets_schema.md).

### `prompts` — externalized LLM prompts

Read by W2/W3 at runtime. 11 prompts + ToV. Edit a row to re-tune any prompt without touching code. Missing key → fail-fast at runtime. See [`docs/external_review_briefing.md`](docs/external_review_briefing.md) for the full index.

---

## File structure

```
.
├── README.md                            # this file
├── PLAN.md                              # MVP done; post-MVP R1-R7+Phase 2 done; open ship items
├── DECISIONS.md                         # architecture decisions log (chronological)
├── workflows/                           # n8n workflow exports
│   ├── W_Master.json                    # Drive folder trigger → start Slack (🛑 Stop) → archive → W1 → W2 → W3
│   ├── W1_STT_and_Segment.json          # Deepgram STT → segments sheet
│   ├── W2_Translate_v2.json             # Tone + Translate + Verify + Editor + Formality + Adapt
│   ├── W3_Synthesize_v2.json            # TTS + Phase 1 timing + Phase 2 slowdown-to-fill + Concat + VTT
│   ├── W3_Dispatch.json                 # per-lang continuation chain + cooperative abort checkpoint
│   ├── W_Regen.json                     # webhook: atomic single-segment regenerate (in-place overwrite)
│   ├── W_Abort.json                     # Slack interactivity webhook: verify signature → set abort flag
│   └── W_Error.json                     # Error Trigger → Slack "❌ Локалізація впала" (failure notifier)
├── code_nodes/                          # JS for n8n Code-node bodies (reference copies)
│   ├── build_started_slack.js           # W_Master: "localization started" Block Kit msg + Stop button
│   ├── build_error_slack.js             # W_Error: failure notification message
│   ├── prepare_run_token.js             # W_Master: write run_token / clear abort_token
│   ├── check_abort_w3dispatch.js        # W3 Dispatch: halt chain if Stop was clicked for this run
│   ├── w_abort_prep_signature.js        # W_Abort: assemble Slack signature base + raw body
│   ├── w_abort_verify_parse.js          # W_Abort: verify HMAC + parse stop intent
│   ├── w_abort_prepare_row.js           # W_Abort: build abort-token config row
│   ├── w_abort_build_confirm.js         # W_Abort: confirmation Slack message
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
│   ├── README.md                        # index of all docs
│   ├── operator_manual.md               # Ukrainian daily-flow guide for the localization manager
│   ├── config_keys.md
│   ├── sheets_schema.md
│   ├── drive_structure.md               # Drive folder layout (01_input → 05_archive)
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
- **Regenerate one or more segments** → open `localizations`, flip `needs_retts=TRUE` on the problem rows (optionally edit `text_translated`, `regen_comment`). Then click "Regen Segments" link in the most recent Slack notification OR click Execute on W_Regen's Manual Trigger in n8n UI. W_Regen re-TTSes each flagged cell, overwrites Drive WAVs in place, rebuilds full WAV + VTT, clears `needs_retts`, sets `needs_attention=REVIEW` for human listen, and posts a Slack notification.
- **Override a movement classification** → if W2 marked a non-movement segment as `movement` (locking it to strict timing and forcing `needs_attention=TRUE` on overshoot), edit `segment_type` / `movement_keywords` in the `segments` sheet → flip `needs_retts=TRUE` on affected rows → trigger W_Regen. The cell will use permissive borrow on re-synth.
- **Edit a prompt** → edit the row in the Sheets `prompts` tab. Runtime reads from sheet via `loadPrompt(key, vars)` — typo in a key throws `Missing prompt "X"` (fail-fast). Local `prompts/*.md` are reference-only.
- **Tune ToV** → edit `tone_of_voice` config value (long-form ToV doc). Current canonical version is mirrored in [`docs/tone_of_voice.md`](docs/tone_of_voice.md) (ToV v3).
- **Tune shortening aggressiveness / calibrate after a voice swap** → set `cps_estimate_{lang}` in the `config` sheet (per-language chars/sec). Full 5-step runbook with example output is in [`scripts/README.md`](scripts/README.md#cps-calibration-runbook). Falls back to `CPS_DEFAULTS` in `code_nodes/check_timing_and_pad.js` / `code_nodes/adapt_translations.js` when a config row is missing.
- **Tune inter-segment gap** → change `min_inter_segment_gap_sec` in config
- **Restore a previous run** → open `05_archive/{archive_name}/` in Drive. Sheet snapshot is `sheet_snapshot_{archive_name}` (independent Google Sheet — point W_Master back at it via `sheets_document_id` config, or copy rows back into the live sheet). Audio + VTT are in `01_input/`, `02_output/`, `03_full/`, `04_vtt/` subfolders.
- **Audit a run for QA** → after a W3 run, filter `localizations` by `needs_attention=TRUE` OR `needs_attention=REVIEW` OR `phase2_outcome != 'accepted'` OR `shorten_retries_in_synthesize >= 3` — those are the rows worth listening to. The Slack message already shows `Needs attention: N% (k / total)` as a quick summary.

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
