# Config Sheet Reference

The `config` tab in the Google Sheet is a key/value store read by all workflows (W1, W2, W3) and any code node that needs runtime parameters.

Every row has two columns: `key`, `value`. Missing keys fall back to the defaults documented below — but it's safer to set them explicitly so behavior is reproducible across re-runs.

---

## Translation & Tone

| Key | Default | Read by | Purpose |
|---|---|---|---|
| ~~`tone_of_voice`~~ | **MOVED** | — | No longer in `config` tab. Now lives in the new `prompts` tab as the `tone_of_voice` key. See [`sheets_schema.md`](sheets_schema.md#sheet-prompts). |
| `active_langs` | `de,es,fr,it,pl,pt,tr` | W3 Expand TTS Jobs | Comma-separated lang codes that Synthesize will process. Translation always runs for all 7; this gates which langs get TTS'd and uploaded. |

## Adaptation behavior

| Key | Default | Read by | Purpose |
|---|---|---|---|
| `max_adaptation_attempts` | `3` | W2 Adapt Translations | Upper bound for the W2 CPS-driven adaptation loop per language. Not currently read by W3 (W3 hardcodes 3 attempts for synthesize-time shorten). |
| `expansion_threshold` | `0.85` | W3 Phase 2: Batch LLM+TTS | Triggers Phase 2 expansion when `real_duration_sec < en_duration_sec × expansion_threshold`. Lower → expansion fires less often (only very short TTS). Higher → expansion tries to fill more padding. **As of 2026-05-25**: inline expansion was removed from Check Timing + Pad; this threshold now gates the Phase 2 batch (Expand → Verify → Editor → re-TTS). Phase 2 includes all 7 langs (Phase 1's `finalSpeed===1.0` gate that excluded PT/TR no longer applies). |

## Synthesize timing

| Key | Default | Read by | Purpose |
|---|---|---|---|
| `min_inter_segment_gap_sec` | `0.4` | W3 Expand TTS Jobs (steal-from-prev) AND W3 Check Timing + Pad (borrow-from-next buffer) | Minimum silence between dubbed segments. Used symmetrically: when natural EN gap < this → steal from prev's audio budget; when natural gap > this → max borrowable into next = `gap_after − this`. |
| `max_borrow_per_segment_sec` | `2.0` | W3 Expand TTS Jobs (Synthesize v3) | Upper bound on breath-borrow: a single segment cannot extend more than this many seconds into the next gap, even if the natural gap is larger. Prevents micro-segments from eating all available silence. |
| `silence_lead_ratio` | `0.2` | W3 Check Timing + Pad (Synthesize v3) | Fraction of padding silence placed BEFORE TTS audio (lead), with `1 − ratio` placed AFTER (tail). Only applied when natural EN lead gap = 0; otherwise full natural gap goes to lead and all padding goes to tail. The final lead is `min(padding × ratio, silence_lead_max_sec)`. |
| `silence_lead_max_sec` | `0.05` | W3 Check Timing + Pad | Hard cap (seconds) on the breath-lead silence placed before TTS when natural EN gap = 0. Prevents word misalignment for short-content-long-tail segments (e.g. "I am here." with 5s of EN silence after). Default 0.05 ≈ half a syllable of breath; set to 0 for strict EN alignment, higher for more breath. |
| `max_speed_up_delta` | `0.15` | W3 Check Timing + Pad | Max speed-UP above this voice's configured `speed` (voices tab) for the shorten path. Cap = `voice.speed + delta`; steps `[voice.speed + delta·⅔, voice.speed + delta]`. For a 1.0 voice → ceiling 1.15 (unchanged); for a 0.8 voice → ceiling 0.95 (was jarringly forced to absolute 1.15). Replaces the old absolute `max_speed`. |
| `max_slow_down_delta` | `0.15` | W3 Phase 2: Batch LLM+TTS | Max slow-DOWN below this voice's configured `speed` for the slowdown-to-fill lever. Floor = `voice.speed − delta`. After expansion, if a segment still leaves silence in its slot, the voice is slowed (toward this floor) to stretch the audio and reduce silence. For a 1.0 voice → floor 0.85; for a 0.8 voice → floor 0.65. |
| `slowdown_min_gap_sec` | `0.5` | W3 Phase 2: Batch LLM+TTS | Only apply slowdown-to-fill when the remaining slot silence exceeds this. Avoids re-synthesizing for negligible gaps and keeps pacing even across segments. |
| `short_seg_threshold_sec` | `2.0` | W3 Check Timing + Pad | Below this `en_duration_sec`, the segment is treated as "short" and may borrow into the trailing silence (`gap_after_sec - min_inter_segment_gap_sec`, capped at `max_borrow_per_segment_sec`) instead of being hard-truncated. Set to `0` to fully disable borrow (revert to strict alignment everywhere). |

## API keys & external services

| Key | Default | Read by | Purpose |
|---|---|---|---|
| `anthropic_api_key` | *(required)* | W2 Verify Translations, W2 Adapt Translations, W3 Check Timing + Pad | Claude API key for in-Code-node HTTP requests. Stored here (not in n8n credentials) because Code nodes can't easily access n8n credentials. |
| `gemini_api_key` | *(required if Gemini Editor stage is wired — current default)* | W2 Gemini Editor | Google AI Studio API key for `gemini-3.5-flash` cross-model editorial pass after Verify Translations. Code node calls Google's OpenAI-compatible endpoint at `generativelanguage.googleapis.com/v1beta/openai/chat/completions`. Get from [aistudio.google.com](https://aistudio.google.com/) → Get API key. Free tier available. If missing, the node throws and W2 stops. |
| `openai_api_key` | *(only required if OpenAI Editor stage is re-wired)* | W2 OpenAI Editor (orphaned by default) | OpenAI API key for GPT-5 cross-model editorial pass. OpenAI Editor node lives on canvas but is **disconnected** by default (Gemini Editor is the active editor). Reconnect Verify → OpenAI Editor → Adapt in n8n UI to swap back. Code node makes direct HTTP calls to `api.openai.com/v1/chat/completions`. |
| `elevenlabs_api_key` | *(required)* | W3 Check Timing + Pad | ElevenLabs API key for speed-retry TTS calls from inside the Code node. The main `ElevenLabs TTS` HTTP Request node still uses n8n credentials. |
| `deepgram_api_key` | *(required for W1)* | W1 Deepgram STT (via n8n credential) | Deepgram API token for speech-to-text. Configured as an n8n Header Auth credential ("Deepgram account") with header `Authorization` = `Token <KEY>`. Stored in config sheet for documentation/audit; actual auth via credential binding. |
| `drive_output_folder_id` | *(required)* | W3 Save to Drive | Google Drive folder ID where per-segment `.wav` files are uploaded. The folder must already exist; W3 doesn't auto-create it. |
| `drive_output_full_folder_id` | *(optional)* | W3 Save Full to Drive, W_Master Telegram link | Google Drive folder ID for concatenated full-lesson WAVs (`{lesson_id}_full_{lang}.wav`). Falls back to `drive_output_folder_id` if missing. Recommended: create a `full/` subfolder for clean separation. |
| `drive_output_vtt_folder_id` | *(optional)* | W3 Save VTT to Drive | Google Drive folder ID for WebVTT subtitle files (`{lesson_id}_full_{lang}.vtt`), one per active language. Cue timings use `en_start_sec → en_end_sec` (EN-aligned, matches dubbed audio after borrow compensation). Cue text is `text_translated`. Falls back to `drive_output_full_folder_id` then `drive_output_folder_id` if missing. Recommended: create a `vtt/` subfolder. |
| `drive_input_folder_id` | *(required if using W_Master)* | W_Master Drive Trigger | Google Drive folder ID watched by W_Master for new audio files. Set on the Drive Trigger node directly in n8n UI (not read from sheet at runtime — n8n needs the folder ID when registering the poll). Documented here so the same value is recorded alongside the other folder IDs. |
| `slack_channel` | *(required if using W_Master)* | W_Master Build Slack Message | Slack channel ID where W_Master posts the completion message. Use channel ID (e.g. `C01234ABCDE`) — find it in Slack: right-click channel → View channel details → bottom of dialog shows ID. The bot itself authenticates via an n8n Slack credential, not via the config sheet. Bot must be in the channel (`/invite @YourBotName`) unless its OAuth scope includes `chat:write.public`. |

## Manual W1 trigger

| Key | Default | Read by | Purpose |
|---|---|---|---|
| `manual_w1_file_id` | *(empty)* | W1 Get Params | Google Drive file ID of the audio to process when W1 is triggered manually (not via W_Master). Edit this row before each ad-hoc W1 run; click Execute on W1 Manual Trigger. W_Master-triggered runs ignore this — W_Master passes file_id in its payload, which takes priority. If both this row is empty AND W_Master didn't trigger, Get Params throws a clear actionable error. |
| `manual_w1_lesson_id` | *(empty)* | W1 Get Params | Lesson identifier (becomes the `segment_id` prefix, e.g. `the_anchor_seg_001`). Same semantics as `manual_w1_file_id` — used only for manual W1 runs, overridden by W_Master payload when present. Pick a stable name per lesson so re-runs overwrite consistent segment_ids. |

---

## Per-language CPS overrides

| Key | Default | Calibrated (2026-05-22) | Read by | Purpose |
|---|---|---|---|---|
| `cps_estimate_de` | `12`   | `12` (no change — obs 12.67, delta +0.67) | W2 Adapt Translations, W3 Check Timing + Pad | Per-language chars-per-second estimate. Used to predict whether a translation will fit in the slot before TTS (W2) and to compute `target_chars` for Claude shorten/expand prompts (W3). Defaults are baked into `CPS_DEFAULTS` in both code nodes. If a key is present in config, it overrides the default. |
| `cps_estimate_es` | `15`   | `15` (no change — obs 15.30, delta +0.30) | (same) | |
| `cps_estimate_fr` | `15`   | `15` (no change — obs 15.83, delta +0.83) | (same) | |
| `cps_estimate_it` | `14`   | `14` (no change — obs 13.25, delta −0.75) | (same) | |
| `cps_estimate_pl` | `14`   | **`13`** ← lower, obs 13.01, delta −0.99 | (same) | |
| `cps_estimate_pt` | `16`   | **`15`** ← lower, obs 15.15, delta −0.85 | (same) | |
| `cps_estimate_tr` | `14`   | **`10`** ← critical fix, obs 10.51, delta −3.49 | (same) | |

Calibration based on N=231 samples combined from `the_anchor` (R4 era, 31 segs × 7 langs) and `test4` (2 segs × 7 langs). Threshold for update: `|observed − current| > 1.0` cps. PL/PT close to threshold; updated for safety since multiple lessons converged on lower values.

**TR was the largest miss** (delta −3.49): voice runs at `default_speed=0.8`, system was predicting at higher CPS, causing constant `final_speed=1.10/1.15` compression retries in W3. New value 10 should largely eliminate these.

Re-run `node scripts/analyze_cps.js <localizations.csv> [--segments=<segments.csv>]` after any voice change, voice-param tweak, or content-type shift. See [`docs/cps_calibration.md`](cps_calibration.md) for full workflow.

## Dead keys to remove from your live sheet

- `min_speed` — never wired up. Slowdown now uses `max_slow_down_delta` (relative to voice.speed).
- `max_speed` — superseded 2026-05-27 by `max_speed_up_delta` (relative to voice.speed). The old absolute value was documented as read by Check Timing but the code used hardcoded `1.10/1.15`; both are now gone. Safe to delete from the live sheet (code falls back to defaults regardless).

## Adding new keys

1. Add a row in the config sheet with the new `key` and `value`.
2. In the workflow's code node, read it via `configMap[<key>]` (after the standard `Read Config` → `configMap` setup).
3. Update this file with the new key, its default, and who reads it.
4. Update `DECISIONS.md` if the key represents an architectural decision.
