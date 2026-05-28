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
    → Claude Translate → Extract Translations → Adapt Translations (3-tier shorten)
    → Update segments sheet with 7 lang translations
    │
    ▼
[W3] Synthesize v2
    Read Config / Voices / Segments → Expand TTS Jobs → Loop:
        ElevenLabs TTS → Check Timing + Pad (Claude shorten/expand + speed retry)
        → Save to Drive (per-segment .wav) → Update localizations sheet
    Loop done → Read Localizations Fresh → Download Segment WAV
        → Build Full Audio Per Lang → Save Full to Drive (7 full .wav files)
```

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
5. **Import workflows** — `workflows/W1_STT_and_Segment.json`, `workflows/W2_Translate_v2.json`, `workflows/W3_Synthesize_v2.json`, then `workflows/W_Master.json` into n8n. Re-bind credentials on each node after import. In W_Master: re-bind the three Execute Workflow nodes to the IDs n8n assigned to W1/W2/W3.
6. **Run**:
    - **Auto**: drop an EN audio file (named `{lesson_id}.mp3`, e.g. `sleep_002.mp3`) into the Drive `input/` folder. W_Master picks it up within ~1 min and runs the whole pipeline.
    - **Manual** (debug): execute W1's Manual Trigger (uses hardcoded defaults baked into the `Get Params` node), then run W2 and W3.

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
| **Timing** | `min_inter_segment_gap_sec` (0.3), `max_borrow_per_segment_sec` (2.0 — currently unused), `silence_lead_ratio` (0.2), `silence_lead_max_sec` (0.05), `expansion_threshold` (0.75) | W3 |
| **Speed/retry** | `max_speed` (1.15), `max_adaptation_attempts` (3) | W2, W3 |

> **Optional CPS tuning**: `cps_estimate_de`, …, `cps_estimate_tr` — per-lang chars-per-second overrides. If present, override `CPS_DEFAULTS` in the W2/W3 code. Run `node scripts/analyze_cps.js <localizations.csv>` after a W3 run to derive recommended values from real TTS output. Useful after voice changes.
>
> **Dead key**: `min_speed` — never wired up, safe to delete.

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
- `borrowed_sec` — should be 0 (we disabled borrow for strict alignment)
- `needs_attention=TRUE` — segment hit max speed and still didn't fit; review the translation
- `shorten_retries_in_synthesize` ≥ 3 — Claude tried max-aggressive shorten; check quality
- `expansion_attempts` > 0 — W3 expanded an over-shortened W2 translation
- `audio_drive_file_id` — Drive file ID of the per-segment WAV

Full schema (every column explained): [`docs/sheets_schema.md#sheet-localizations`](docs/sheets_schema.md).

---

## File structure

```
.
├── README.md                            # this file
├── PLAN.md                              # 2-week MVP roadmap (Week 1 done, Week 2 pending)
├── DECISIONS.md                         # architecture decisions log
├── workflows/                           # n8n workflow exports
│   ├── W_Master.json                    # Drive folder trigger → W1 → W2 → W3 → Slack
│   ├── W1_STT_and_Segment.json          # Deepgram STT → segments sheet
│   ├── W2_Translate_v2.json             # Tone + Translate + Adapt → segments sheet
│   └── W3_Synthesize_v2.json            # TTS + Timing + Concat → Drive + localizations
├── code_nodes/                          # JS for n8n Code-node bodies (reference copies)
│   ├── prepare_tone_analysis.js
│   ├── parse_tone_analysis.js
│   ├── prepare_and_expand.js
│   ├── adapt_translations.js
│   ├── check_timing_and_pad.js
│   └── build_full_audio_per_lang.js
├── prompts/                             # Claude prompt templates (reference)
│   ├── tone_analysis.md
│   ├── adaptation.md                    # W2 main adapt prompt
│   ├── adaptation_shorten.md            # W3 single-segment shorten (3 attempts)
│   └── adaptation_expand.md             # W3 single-segment expand
├── docs/                                # detailed schema docs
│   ├── config_keys.md
│   ├── sheets_schema.md
│   ├── drive_structure.md
│   ├── localization_rules.md
│   ├── tone_of_voice.md
│   └── day1_verification_checklist.md
├── scripts/
│   └── test_apis.js                     # smoke test for Anthropic + ElevenLabs API keys
└── tests/
    └── (audio fixtures)
```

---

## Common tasks

- **Add a new language** → add row to `voices` tab + add code to `active_langs` config key
- **Regenerate one segment** → manually clear that row's `{lang}_text` in `segments`, re-run W2 then W3
- **Tune translation tone** → edit `tone_of_voice` config value
- **Tune shortening aggressiveness / calibrate after a voice swap** → set `cps_estimate_{lang}` in the `config` sheet (per-language chars/sec). Full 5-step runbook with example output is in [`scripts/README.md`](scripts/README.md#cps-calibration-runbook). Falls back to `CPS_DEFAULTS` in `code_nodes/check_timing_and_pad.js` / `code_nodes/adapt_translations.js` when a config row is missing.
- **Tune inter-segment gap** → change `min_inter_segment_gap_sec` in config

---

## Cost estimate

For a ~60-second lesson with 7-9 segments × 7 languages:
- Deepgram Nova-3 (W1): ~$0.005
- Claude (W2 + W3): ~$0.05–0.10 (Sonnet for translate, Haiku for shorten/expand, prompt caching)
- ElevenLabs TTS: ~$0.05–0.10 (depends on plan, ~100 chars per segment × 49 calls + speed retries)

**Total: ~$0.10–0.25 per lesson** for all 7 languages.

---

## More

- Roadmap & status: [PLAN.md](PLAN.md)
- Why decisions were made the way they were: [DECISIONS.md](DECISIONS.md)
- Deep schema reference: [docs/sheets_schema.md](docs/sheets_schema.md), [docs/config_keys.md](docs/config_keys.md)
