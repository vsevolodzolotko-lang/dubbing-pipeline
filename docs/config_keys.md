# Config Sheet Reference

The `config` tab in the Google Sheet is a key/value store read by all workflows (W1, W2, W3) and any code node that needs runtime parameters.

Every row has two columns: `key`, `value`. Missing keys fall back to the defaults documented below — but it's safer to set them explicitly so behavior is reproducible across re-runs.

---

## Translation & Tone

| Key | Default | Read by | Purpose |
|---|---|---|---|
| `tone_of_voice` | *(required, no default)* | W2 Prepare and Expand (Translate) | Full Brand ToV text. Injected into translation system prompt and into adaptation prompts. Plain text, multiple paragraphs allowed. |
| `active_langs` | `de,es,fr,it,pl,pt,tr` | W3 Expand TTS Jobs | Comma-separated lang codes that Synthesize will process. Translation always runs for all 7; this gates which langs get TTS'd and uploaded. |

## Adaptation behavior

| Key | Default | Read by | Purpose |
|---|---|---|---|
| `max_adaptation_attempts` | `3` | W2 Adapt Translations | Upper bound for the W2 CPS-driven adaptation loop per language. Not currently read by W3 (W3 hardcodes 3 attempts for synthesize-time shorten). |
| `expansion_threshold` | `0.75` | W3 Check Timing + Pad | Triggers expansion loop when `real_duration_sec < en_duration_sec × expansion_threshold`. Lower → expansion fires less often (only very short TTS). Higher → expansion tries to fill more padding. Default lowered from 0.85 to 0.75 after observing that ratio 0.75–0.85 sounded acceptable without expansion. |

## Synthesize timing

| Key | Default | Read by | Purpose |
|---|---|---|---|
| `min_inter_segment_gap_sec` | `0.4` | W3 Expand TTS Jobs (steal-from-prev) AND W3 Check Timing + Pad (borrow-from-next buffer) | Minimum silence between dubbed segments. Used symmetrically: when natural EN gap < this → steal from prev's audio budget; when natural gap > this → max borrowable into next = `gap_after − this`. |
| `max_borrow_per_segment_sec` | `2.0` | W3 Expand TTS Jobs (Synthesize v3) | Upper bound on breath-borrow: a single segment cannot extend more than this many seconds into the next gap, even if the natural gap is larger. Prevents micro-segments from eating all available silence. |
| `silence_lead_ratio` | `0.2` | W3 Check Timing + Pad (Synthesize v3) | Fraction of padding silence placed BEFORE TTS audio (lead), with `1 − ratio` placed AFTER (tail). Only applied when natural EN lead gap = 0; otherwise full natural gap goes to lead and all padding goes to tail. The final lead is `min(padding × ratio, silence_lead_max_sec)`. |
| `silence_lead_max_sec` | `0.05` | W3 Check Timing + Pad | Hard cap (seconds) on the breath-lead silence placed before TTS when natural EN gap = 0. Prevents word misalignment for short-content-long-tail segments (e.g. "I am here." with 5s of EN silence after). Default 0.05 ≈ half a syllable of breath; set to 0 for strict EN alignment, higher for more breath. |
| `max_speed` | `1.15` | W3 Check Timing + Pad | Hard ceiling on TTS speed adjustment. Speed retries go 1.10 → 1.15 (capped here). Higher values sound artificial for meditation content. |

## API keys & external services

| Key | Default | Read by | Purpose |
|---|---|---|---|
| `anthropic_api_key` | *(required)* | W2 Adapt Translations, W3 Check Timing + Pad | Claude API key for in-Code-node HTTP requests. Stored here (not in n8n credentials) because Code nodes can't easily access n8n credentials. |
| `elevenlabs_api_key` | *(required)* | W3 Check Timing + Pad | ElevenLabs API key for speed-retry TTS calls from inside the Code node. The main `ElevenLabs TTS` HTTP Request node still uses n8n credentials. |
| `deepgram_api_key` | *(required for W1)* | W1 Deepgram STT (via n8n credential) | Deepgram API token for speech-to-text. Configured as an n8n Header Auth credential ("Deepgram account") with header `Authorization` = `Token <KEY>`. Stored in config sheet for documentation/audit; actual auth via credential binding. |
| `drive_output_folder_id` | *(required)* | W3 Save to Drive | Google Drive folder ID where per-segment `.wav` files are uploaded. The folder must already exist; W3 doesn't auto-create it. |
| `drive_output_full_folder_id` | *(optional)* | W3 Save Full to Drive | Google Drive folder ID for concatenated full-lesson WAVs (`{lesson_id}_full_{lang}.wav`). Falls back to `drive_output_folder_id` if missing. Recommended: create a `full/` subfolder for clean separation. |

---

## Dead keys to remove from your live sheet

The following keys are NOT read by any current workflow. If your `config` tab has rows with these keys, you can safely delete them:

- `cps_estimate_de`, `cps_estimate_es`, `cps_estimate_fr`, `cps_estimate_it`, `cps_estimate_pl`, `cps_estimate_pt`, `cps_estimate_tr` — CPS values were briefly configurable, now hardcoded as `LANG_CPS` constants in `code_nodes/check_timing_and_pad.js` and `code_nodes/adapt_translations.js`. To change CPS, edit those files (and the matching jsCode inside the workflow JSON), not the sheet.
- `min_speed` — never wired up. Speed is always 1.0 baseline with 1.10 / 1.15 retry.

## Adding new keys

1. Add a row in the config sheet with the new `key` and `value`.
2. In the workflow's code node, read it via `configMap[<key>]` (after the standard `Read Config` → `configMap` setup).
3. Update this file with the new key, its default, and who reads it.
4. Update `DECISIONS.md` if the key represents an architectural decision.
