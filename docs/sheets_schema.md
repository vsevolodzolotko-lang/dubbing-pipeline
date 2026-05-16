# Google Sheets Schema

All sheets live in a single Google Spreadsheet linked to n8n via credentials.

---

## Sheet: segments

Primary data table. One row per EN segment.

| Column | Type | Description |
|--------|------|-------------|
| segment_id | text | e.g. `seg_001` |
| en_text | text | Original English text |
| en_start_sec | number | Start time in EN audio |
| en_end_sec | number | End time in EN audio |
| en_duration_sec | number | `en_end_sec - en_start_sec` — timing budget for all langs |
| segment_type | text | `narrative` / `movement` / `instruction` — from Tone Analysis |
| movement_keywords | text | Comma-separated movement cues, e.g. `inhale, raise arms` — from Tone Analysis |
| de_text | text | Final DE translation (after adaptation if needed) |
| es_text | text | Final ES translation |
| fr_text | text | Final FR translation |
| it_text | text | Final IT translation |
| pl_text | text | Final PL translation |
| pt_text | text | Final PT translation |
| tr_text | text | Final TR translation |
| de_adaptation_attempts | number | How many adaptation loops ran for DE (0 = first pass fit) |
| es_adaptation_attempts | number | Same for ES |
| fr_adaptation_attempts | number | Same for FR |
| it_adaptation_attempts | number | Same for IT |
| pl_adaptation_attempts | number | Same for PL |
| pt_adaptation_attempts | number | Same for PT |
| tr_adaptation_attempts | number | Same for TR |
| status | text | `pending` / `translated` / `synthesized` / `needs_attention` |

---

## Sheet: localizations

Run-time table. Populated by Workflow_Synthesize. One row per segment × language combination.

| Column | Type | Description |
|--------|------|-------------|
| row_key | text | `{segment_id}_{lang}`, e.g. `seg_001_de` |
| segment_id | text | FK to segments |
| lang | text | Language code, e.g. `de` |
| text_translated | text | Final text used for TTS (copy from segments after adaptation) |
| en_start_sec | number | Copy from segments for convenience |
| en_duration_sec | number | Copy from segments — `en_end_sec - en_start_sec` |
| slot_start_sec | number | Position of this file's start in the concatenated dubbing timeline = `prev_en_end_sec` (or 0 for first). Diagnostic. |
| slot_end_sec | number | Position of this file's end in the concatenated dubbing timeline = `en_end_sec`. Diagnostic. |
| lead_silence_sec | number | Silence prepended at start = `en_start_sec - prev_en_end_sec` (or `en_start_sec` for first). Captures inter-segment EN pause. |
| tts_budget_sec | number | Effective audio budget for TTS = `en_duration_sec - trailing_silence_sec`. Used by Claude adapt + speed retries + hard truncate. |
| trailing_silence_sec | number | Silence appended at end = `max(0, MIN_GAP - natural_gap_to_next)`. Steals time from TTS to ensure ≥`min_inter_segment_gap_sec` between dubbed words. |
| real_duration_sec | number | Actual TTS output duration (no silence). |
| final_duration_sec | number | Total file duration = `lead_silence_sec + en_duration_sec`. Files concat end-to-end reproduce original EN timeline. |
| final_speed | number | Speed used for TTS: `1.0` / `1.1` / `1.15` |
| needs_attention | boolean | `true` if audio was hard-truncated (TTS still over `tts_budget_sec` after speed 1.15). |
| audio_drive_file_id | text | Google Drive file ID of the output wav |

> **Note on Scribe accuracy**: `en_start_sec[0]` (and other timestamps) are auto-detected by ElevenLabs Scribe from the audio file in W1. Scribe can overshoot word boundaries by up to ~0.25s on some recordings. If after running W3 the seg_001 lead silence sounds too long, manually edit `en_start_sec` for that segment in the `segments` sheet and re-run W3.

---

## Sheet: voices

Voice configuration per language. One row per language.

| Column | Type | Description |
|--------|------|-------------|
| lang | text | Language code |
| voice_id | text | ElevenLabs voice ID |
| voice_name | text | Human-readable name |
| model | text | ElevenLabs model, e.g. `eleven_multilingual_v2` |
| stability | number | 0–1 |
| similarity_boost | number | 0–1 |
| style | number | 0–1 |
| speed | number | Default playback speed (1.0 = natural) |
| notes | text | Calibration notes |

---

## Sheet: config

Key-value store for pipeline-wide settings.

| key | value | Notes |
|-----|-------|-------|
| tone_of_voice | *(full ToV text)* | Injected into translation prompts |
| active_langs | `de,es,fr,it,pl,pt,tr` | Comma-separated list processed by Synthesize |
| max_adaptation_attempts | `3` | Adaptation loop upper bound |
| max_speed | `1.15` | Speed ceiling before flagging needs_attention |
| min_inter_segment_gap_sec | `0.4` | Minimum silence between dubbed segments. When natural EN gap is smaller, time is "stolen" from the prev segment's TTS budget. Default 0.4 if missing. |
| anthropic_api_key | `sk-ant-...` | Used by Adapt Translations (W2) and Check Timing + Pad (W3) for re-adaptation |
| elevenlabs_api_key | `sk_...` | Used by Check Timing + Pad (W3) for speed retry TTS calls |
| drive_output_folder_id | *(folder ID)* | Where W3 uploads `.wav` files |
