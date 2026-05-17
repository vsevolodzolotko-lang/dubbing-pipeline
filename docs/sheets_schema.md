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
| lead_silence_sec | number | Silence prepended at start. Default: natural EN gap = `en_start_sec - prev_en_end_sec` (or `en_start_sec` for first). When EN gap = 0 and `real_duration < en_duration`, may also include `silence_lead_ratio × padding` to soften abrupt starts (v3). |
| tts_budget_sec | number | Effective audio budget for TTS = `en_duration_sec - trailing_silence_sec` (v2 carryover). v3 also uses `effective_slot = en_duration_sec + max_borrowable`. Used by Claude adapt + speed retries + hard truncate. |
| tail_silence_sec | number | Silence appended at end. Combines v2's MIN_GAP-steal (`max(0, MIN_GAP - natural_gap_to_next)`) with v3's 80% padding share when `real_duration < en_duration`. Was named `trailing_silence_sec` in v2 — rename one-time. |
| borrowed_sec | number | (v3) Seconds this segment extended into the next EN gap when TTS at speed 1.0 exceeded `en_duration_sec` but fit within `effective_slot`. 0 if no borrow. Always ≤ `max_borrow_per_segment_sec`. |
| expansion_attempts | number | (v3) How many times the Synthesize expansion loop fired for this segment × lang. 0 = TTS was already long enough (`real ≥ en_duration × expansion_threshold`). Max 2. |
| shorten_retries_in_synthesize | number | (v3) How many of the 3 single-segment shorten attempts fired in W3 Check Timing + Pad. 0 = first TTS fit within `effective_slot`. |
| real_duration_sec | number | Actual TTS audio duration after all retries (no surrounding silence). |
| final_duration_sec | number | Total file duration = `lead_silence_sec + real_duration_sec + tail_silence_sec`. With borrow: can exceed `en_duration_sec` by up to `borrowed_sec`. Files concat end-to-end reproduce EN timeline (extended by total borrowed). |
| final_speed | number | Speed used for TTS: `1.0` / `1.1` / `1.15`. v3 reaches `>1.0` only after all 3 shorten attempts fail. |
| needs_attention | boolean | `true` if audio was hard-truncated (TTS still over `effective_slot × 1.05` after all 3 adapt attempts and speed 1.15). |
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

See [`docs/config_keys.md`](config_keys.md) for the full reference (defaults, owners, purpose). Summary below:

| key | value | Notes |
|-----|-------|-------|
| tone_of_voice | *(full ToV text)* | Injected into translation prompts |
| active_langs | `de,es,fr,it,pl,pt,tr` | Comma-separated list processed by Synthesize |
| max_adaptation_attempts | `3` | W2 adaptation loop upper bound |
| max_speed | `1.15` | Speed ceiling before flagging needs_attention |
| min_inter_segment_gap_sec | `0.4` | Minimum silence between dubbed segments. Used symmetrically for steal-from-prev AND borrow-from-next buffer. |
| max_borrow_per_segment_sec | `2.0` | (v3) Upper bound on breath-borrow per segment. |
| expansion_threshold | `0.85` | (v3) Trigger expansion when `real_duration < en_duration × this`. |
| silence_lead_ratio | `0.2` | (v3) Fraction of padding placed before TTS (when EN lead gap = 0). |
| silence_lead_max_sec | `0.05` | (v3) Hard cap on breath-lead silence when EN gap = 0. Prevents word misalignment in short-content-long-tail segments. |
| anthropic_api_key | `sk-ant-...` | Used by Adapt Translations (W2) and Check Timing + Pad (W3) for adaptation calls |
| elevenlabs_api_key | `sk_...` | Used by Check Timing + Pad (W3) for re-TTS during shorten/expand and speed retry |
| deepgram_api_key | *(token)* | Used by W1 Deepgram STT via n8n Header Auth credential. Replaced ElevenLabs Scribe to fix long-silence timestamp drift. |
| drive_output_folder_id | *(folder ID)* | Where W3 uploads per-segment `.wav` files |
| drive_output_full_folder_id | *(folder ID, optional)* | Where W3 uploads concatenated full-lesson WAVs. Falls back to drive_output_folder_id if missing. |
