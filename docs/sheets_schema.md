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
| status | text | **Legacy / currently unused.** W1 always writes `pending`; W2/W3 don't update it. Kept in the sheet for future state-machine work — safe to leave or delete. |

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
| borrowed_sec | number | Seconds this segment's TTS audio extends past `en_duration_sec` into the trailing silence. Non-zero only for **short segments** (`en_duration_sec < short_seg_threshold_sec`, default 2.0s) where conditional breath-borrow kicked in. Bounded by `max_borrow_per_segment_sec` and available `gap_after_sec - min_inter_segment_gap_sec`. Normal segments stay at `borrowed_sec=0` (strict alignment). At concat time, `Build Full Audio Per Lang` trims `borrowed_sec[N]` from the head of segment N+1's lead silence — keeping the full WAV aligned with EN positions despite per-file overshoot. |
| expansion_attempts | number | How many Phase 2 LLM rounds the cell went through. `0` = not a candidate (Phase 1 ratio already ≥ `expansion_threshold`); `1` = Phase 2 attempt 1 ran (may be accepted or rejected — see `phase2_outcome`); `2` = Phase 2 attempt 2 (retry pass) ran. Final accept/skip status is carried by `phase2_outcome`, not by this column. |
| phase2_outcome | text | (Added 2026-05-26) Per-candidate outcome of Phase 2 expansion pipeline. Values: `accepted` (re-TTS fit within `en_duration` and replaced Phase 1 audio), `no_change` (LLM returned text identical to current — nothing to expand), `overshoot` (re-TTS exceeded `en_duration` — Phase 1 audio kept), `negative_tail` (lead + audio > `en_duration` — Phase 1 kept), `tts_empty` (ElevenLabs returned < 4410 bytes PCM), `llm_dropped` (LLM omitted this cell from its JSON response — no text to re-TTS), `error` (LLM/HTTP exception), empty/missing = `not_candidate` (Phase 1 ratio ≥ threshold OR `lead_silence_sec` ≥ `en_duration_sec × 0.5` structurally-impossible filter — Phase 2 never touched the row). For diagnosing why a cell didn't get expanded after a Phase 2 run. |
| shorten_retries_in_synthesize | number | (v3) How many of the 3 single-segment shorten attempts fired in W3 Check Timing + Pad. 0 = first TTS fit within `effective_slot`. |
| real_duration_sec | number | Actual TTS audio duration after all retries (no surrounding silence). |
| final_duration_sec | number | Total per-segment file duration = `lead_silence_sec + real_duration_sec + tail_silence_sec`. With borrow: the per-file value can exceed `en_duration_sec - prev_en_end_sec` (its slot) by up to `borrowed_sec`. **The concatenated full WAV is shorter than the sum of `final_duration_sec` because `Build Full Audio Per Lang` trims the borrow back out of the next segment's lead.** Net: full WAV length ≈ EN audio length. |
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

See [`config_keys.md`](config_keys.md) for the full reference (defaults, owners, purpose). Summary below.

> **Optional CPS overrides**: `cps_estimate_de`, `cps_estimate_es`, `cps_estimate_fr`, `cps_estimate_it`, `cps_estimate_pl`, `cps_estimate_pt`, `cps_estimate_tr` — per-language characters-per-second estimates. If present, override the `CPS_DEFAULTS` baked into the W2/W3 code nodes. See [config_keys.md](config_keys.md#per-language-cps-overrides) and use `scripts/analyze_cps.js` after a W3 run to derive observed values from real data.
>
> **Dead keys**: `min_speed` (never wired) and `max_speed` (superseded 2026-05-27 by `max_speed_up_delta` / `max_slow_down_delta`, both relative to voice.speed) — safe to delete.
>
> **W3 TTS concurrency is NOT a config key**: it's the `batchSize` on W3's `Loop Over Items` node (default 7). The initial TTS now runs inside `Check Timing + Pad` (the `ElevenLabs TTS` HTTP node was removed), which synthesizes each batch in parallel. `Rate Limit Guard` wait is now 0.2s. See [config_keys.md](config_keys.md#w3-synthesis-concurrency-not-a-config-key).

| key | value | Notes |
|-----|-------|-------|
| active_langs | `de,es,fr,it,pl,pt,tr` | Comma-separated list processed by Synthesize |
| max_adaptation_attempts | `3` | W2 adaptation loop upper bound |
| w2_adapt_concurrency | `8` | (v4) Global concurrency cap for W2 Adapt across all (segment×lang) cells. Prevents 300s task-runner timeout on long lessons. |
| w2_llm_chunk | `6` | (v4) Parallel batch count for W2 Verify + Gemini Editor (was hardcoded 3). |
| max_speed_up_delta | `0.15` | (v4) Max speed-up above voice.speed for W3 shorten path. Replaces absolute `max_speed`. |
| max_slow_down_delta | `0.15` | (v4) Max slow-down below voice.speed for W3 Phase 2 slowdown-to-fill. |
| slowdown_min_gap_sec | `0.5` | (v4) Only slow-fill when remaining slot silence exceeds this. |
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

---

## Sheet: prompts

Editable text for all system prompts and the brand Tone of Voice. Edit any `value` cell to change what the LLMs see on the next workflow run — no n8n re-import needed.

Schema:

| Column | Type | Description |
|---|---|---|
| `key` | text | Stable identifier referenced from Code nodes via `loadPrompt(key, vars)`. Don't rename — code lookups will fail. |
| `description` | text | Human note about what this prompt does + which node uses it. Code ignores this column; it's there so future-you knows what each row is for. |
| `value` | text (multiline) | The actual prompt text. May contain `{{var}}` placeholders that are substituted at load time. Sheets cells hold up to 50K chars; the largest current prompt is ~6.5K. |

**Required keys** (each must have a non-empty `value` cell — code throws `Missing prompt "X" in prompts sheet` if any is empty/missing):

| key | placeholders | Read by |
|---|---|---|
| `tone_of_voice` | — | W2 Prepare and Expand, W3 Check Timing (interpolated as `{{tov}}`) |
| `tone_analysis_system` | — | W2 Prepare Tone Analysis |
| `translate_system` | `{{tov}}` | W2 Prepare and Expand |
| `qa_verify_system` | — | W2 Verify Translations |
| `editor_system` | — | W2 Gemini Editor (active), W2 OpenAI Editor (orphan/swap-back) |
| `adapt_shorten_system` | — | W2 Adapt Translations (system prompt) |
| `adapt_attempt_light` | `{{lang}}` `{{budget}}` `{{est}}` `{{en}}` `{{trans}}` `{{min_chars}}` | W2 Adapt Translations attempt 1 (user message template) |
| `adapt_attempt_medium` | same as `adapt_attempt_light` | Attempt 2 |
| `adapt_attempt_max` | same as `adapt_attempt_light` | Attempt 3 |
| `w3_shorten_system` | `{{tov}}` | W3 Check Timing + Pad (single-segment shorten) |
| `w3_expand_system` | `{{tov}}` | (Legacy) W3 inline expansion. Unused after 2026-05-25 — Phase 2 batch path superseded. Kept as rollback backup. |
| `w3_expand_batch_system` | `{{tov}}` | W3 Phase 2 Batch LLM+TTS — attempt 1 expansion |
| `w3_expand_batch_retry_harder` | `{{tov}}` | (Optional, added 2026-05-26) W3 Phase 2 retry pass for `no_change` + `still_short` cells. If missing, Phase 2 runs single-pass. |
| `w3_expand_batch_retry_shorter` | `{{tov}}` | (Optional, added 2026-05-26) W3 Phase 2 retry pass for `overshoot` cells. If missing, Phase 2 runs single-pass. |
| `formality_fix_system` | — | (Optional, added 2026-05-27) W2 Formality Lint — rewrites formal-address cells to informal singular. Built-in default in the node; add this row only to override. |

**Placeholder convention**: `{{name}}` — double curly braces, no spaces. If you accidentally write `{name}` or `{{ name }}`, substitution silently fails and the literal string appears in the rendered prompt. Always check via the `description` column which placeholders a row accepts.

**Editing flow**:
1. Edit any `value` cell directly in the sheet
2. Save (Sheets auto-saves)
3. Next W2/W3 run picks up the new value
4. If you need to revert, see `sheets/prompts.tsv` in the repo — it's the seed snapshot committed alongside this schema

**Adding a new prompt** (advanced): if you need a new prompt referenced from code, (1) add a row in the sheet with a new `key`, (2) add a `loadPrompt('your_key')` call in the relevant Code node, (3) re-import that workflow into n8n. The first two steps alone won't activate it — the code has to actually request the key by name.
