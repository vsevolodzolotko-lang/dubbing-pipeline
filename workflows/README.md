# n8n Workflows

Four workflows: **W_Master** (Drive folder trigger, optional) chains **W1 → W2 → W3** sequentially. W1/W2/W3 can also be run manually — useful for debugging or one-off lessons.

## W_Master.json — Drive folder trigger orchestrator

**Input**: any audio file dropped into the Drive `input/` folder (configured by `drive_input_folder_id`).
**Output**: triggers W1 → W2 → W3 in sequence, then posts a Slack notification with the link to the per-lang `full/` output folder.

| Node | Purpose |
|---|---|
| Drive Trigger (input/) | Polls the configured `drive_input_folder_id` for new files (every minute) |
| Parse Filename (Code) | Derives `lesson_id` from the filename (e.g. `sleep_002.mp3` → `sleep_002`); skips non-audio drops |
| Execute W1 (STT) | Calls W1 with `{file_id, lesson_id}`. Retry: 1 attempt on fail, then stop |
| Execute W2 (Translate) | Calls W2 with `{lesson_id}`. Retry: 1 attempt on fail, then stop |
| Execute W3 (Synthesize) | Calls W3 with `{lesson_id}`. Retry: 1 attempt on fail, then stop |
| Read Config | Pulls `drive_output_full_folder_id`, `slack_channel`, `active_langs` for the Slack message |
| Build Slack Message (Code) | Composes one Slack message per Parse Filename item using mrkdwn (`*bold*`, `:emoji:`, `<url|text>` for the Drive folder link). Reads `slack_channel` from config; throws if missing. |
| Slack Notify | Posts the message via Slack API (Bot User OAuth Token). |

**Setup checklist** (after importing):
1. Drive Trigger → confirm `folderToWatch` is your `input/` folder ID.
2. Execute W1 / W2 / W3 → re-bind to the workflow IDs assigned by your n8n instance after import.
3. Slack Notify → bind your Slack credential (Bot User OAuth Token `xoxb-...`). The credential ID in the JSON is a placeholder.
4. `config` sheet → add `slack_channel` = your channel ID (e.g. `C01234ABCDE`). The bot must be a member of that channel unless its scopes include `chat:write.public`.
5. Set `active = true` on the workflow only after manual smoke-test (otherwise polling starts immediately).

The Drive trigger watches *file-created* events only — moving an existing file into the folder also counts. Modifying an already-processed file does not retrigger.

**Retry semantics**: Execute W1 and Execute W2 retry once with 5s backoff. Execute W3 is NOT retried (it's long + has Drive side effects — retrying duplicates work). On any sub-workflow failure W_Master stops without sending Slack; open the n8n execution log to see which sub-workflow failed.

## W1_STT_and_Segment.json — Speech-to-text + segmentation

**Input**: an MP3/WAV in Google Drive. Accepts either `{file_id, lesson_id}` from a parent Execute Workflow call, or falls back to hardcoded defaults when triggered manually (for debug).
**Output**: rows in the `segments` sheet — one per sentence-group.

| Node | Purpose |
|---|---|
| Manual Trigger | Debug entry point — uses fallback `file_id` / `lesson_id` defaults baked into `Get Params` |
| Execute Workflow Trigger | Production entry point — receives `{file_id, lesson_id}` from W_Master |
| Get Params (Code) | Normalizes the two trigger paths into a single `{file_id, lesson_id}` item |
| Download Audio | Pull the source file from Drive as binary (uses `={{ $json.file_id }}`) |
| Deepgram STT | POST audio to Deepgram Nova-3 with `utterances=true&utt_split=1.5&smart_format=true&punctuate=true` |
| Segment Transcript (Code) | Walk `data.results.channels[0].alternatives[0].paragraphs.paragraphs[].sentences[]`, group consecutive sentences up to 150 chars (gap ≤ 1.0s), extend last segment to `data.metadata.duration`. Reads `lesson_id` from `Get Params`. |
| Write to Sheet | Append/update rows in `segments` keyed on `segment_id` |

## W2_Translate_v2.json — Tone analysis + translation + adapt

**Input**: when called from W_Master → `{ lesson_id }` via Execute Workflow Trigger (filters segments to that lesson only). When run manually → no payload → operates on **all** rows in `segments` (legacy behavior, useful for debugging).
**Output**: same rows now have `de_text` … `tr_text`, `segment_type`, `movement_keywords`.

| Node | Purpose |
|---|---|
| Manual Trigger | Debug entry point (no payload → no lesson_id filter) |
| Execute Workflow Trigger | Production entry point — receives `{ lesson_id }` from W_Master |
| Get Params (Code) | Normalizes the two trigger paths into `{ lesson_id }`; null when manual |
| Read Config / Read Pending Segments | Pull config and translatable rows |
| Prepare Tone Analysis (Code) | Builds **batched** Claude requests (default 40 segments per batch) to classify types and key concepts. Filters by `lesson_id` prefix if provided. |
| Claude Tone Analysis | HTTP POST to Anthropic, model sonnet-4-5. Retries 4× with 5s backoff. |
| Parse Tone Map (Code) | Merges JSON responses from all batches, emits one item per segment_id. Defensive — skips broken batches with error log. |
| Update Tone Columns | Write `segment_type`, `movement_keywords` back to `segments` |
| Prepare and Expand (Code) | Builds **batched** Claude translate requests (default 8 segments per batch). System prompt cached via `cache_control: ephemeral`; user content is a JSON map `{segment_id: {text, type?, key_concepts?}}`. Filters by `lesson_id` prefix. |
| Wait + Claude Translate | Rate-limit-safe per-batch translation. Retries up to 4× with 5s backoff on HTTP errors. |
| Extract Translations (Code) | Parses batched JSON response (`{segment_id: {de, es, fr, pl, pt, it, tr}}`), emits one item per segment. Defensive skip on empty/missing segment in batch. |
| Verify Translations (Code) | **Sonnet self-QA**: in-Code-node HTTP calls to Claude Sonnet 4.5 with anti-pattern rules (false friends, formality drift, ToV violations). QA_SYSTEM ≥1024 tokens with `cache_control: ephemeral` → batches 2-4 hit cache. Returns text unchanged when clean. Reads `anthropic_api_key` from config. |
| OpenAI Editor (Code) | **GPT-5 cross-model second-pass**: in-Code-node HTTP calls to OpenAI `chat/completions` with same Class 1/2/3 rules as Verify. Strict editor (returns clean translations unchanged). EDITOR_SYSTEM ≥1024 tokens → OpenAI auto-cache. Reads `openai_api_key` from config; throws if missing. Disable in n8n UI to skip the stage without removing the node. |
| Adapt Translations (Code) | CPS-based estimation + up to 3-tier Claude shorten loop per (segment × lang) when text won't fit. |
| Update Sheet | Append/update `{lang}_text` + `{lang}_adaptation_attempts` columns |

## W3_Synthesize_v2.json — TTS + timing + per-segment + per-lang concat

**Input**: when called from W_Master → `{ lesson_id }` via Execute Workflow Trigger (filters segments + localizations to that lesson only). When run manually → no payload → operates on all rows.
**Output**:
- Per-segment WAVs in `drive_output_folder_id` (one per segment × lang)
- Full-lesson WAVs in `drive_output_full_folder_id` (one per lang, all segments of that lesson concatenated)
- `localizations` sheet populated with per-row diagnostics

| Node | Purpose |
|---|---|
| Manual Trigger | Debug entry point (no payload → no lesson_id filter) |
| Execute Workflow Trigger | Production entry point — receives `{ lesson_id }` from W_Master |
| Get Params (Code) | Normalizes the two trigger paths into `{ lesson_id }`; null when manual |
| Read Config / Read Voices / Read Segments | Pull inputs |
| Expand TTS Jobs (Code) | Cross-join: emit one item per (segment × active_lang). Pre-compute slot timing — `slot_start_sec`, `slot_end_sec`, `lead_silence_natural_sec`, `tts_budget_sec`, `effective_slot_sec`. Filters by `lesson_id` prefix. |
| Loop Over Items (Split In Batches) | Per-segment-per-lang loop. `batchSize=1` (one item per iteration) — required because Check Timing + Pad uses singular `.item` accessors. Parallel-TTS optimization removed due to data-loss bug (see DECISIONS.md `W3_LOOP_BATCHING_REVERTED_DATA_LOSS_BUG`). |
| ↳ ElevenLabs TTS | POST text to `eleven_multilingual_v2` with `output_format=pcm_22050`. One request per item (sequential). |
| ↳ Check Timing + Pad (Code) | The brains. Re-adapt via Claude Haiku if over budget (3-tier shorten), retry at speed 1.10/1.15, hard-truncate as last resort, expand if too short (max 2 attempts), prepend `lead_silence`, append `tail_silence`, build WAV |
| ↳ Save to Drive | Upload per-segment WAV |
| ↳ Prepare Localization Row + Update Localizations | Write diagnostics row |
| ↳ Rate Limit Guard (Wait) | 0.5s between batched iterations (ElevenLabs Scale tier has plenty of RPM headroom) |
| Loop done → Read Localizations Fresh | Get all rows for concat + VTT stages (fan-out to two branches) |
| ↳ Download Segment WAV | Per-row Drive download, attaches binary |
| ↳ Build Full Audio Per Lang (Code) | Iterates `active_langs` sequentially, lazy-filters items per lang (no pre-grouping), strips 44-byte WAV headers, concats raw PCM, wraps fresh WAV header. Trims `borrowed_sec` from next segment's lead silence (drift-fix). Filters by `lesson_id` prefix. Explicit `pcmChunks.length = 0` after concat to help GC reclaim per-segment buffers between langs. |
| ↳ Save Full to Drive | Upload N full WAVs (one per active_lang) |
| ↳ Build VTT Per Lang (Code) | Parallel branch to Download Segment WAV. Generates one WebVTT file per active_lang. Cue text = `text_translated`; cue timings = `en_start_sec → en_end_sec` (EN-aligned, matches dubbed audio after borrow compensation). |
| ↳ Save VTT to Drive | Upload N `.vtt` files into `drive_output_vtt_folder_id` (falls back to `drive_output_full_folder_id` then `drive_output_folder_id`). |

## n8n deployment env vars (required for production)

Set these on the n8n process to keep memory usage safe during long-form W3 runs (12+ min lessons). Without `N8N_BINARY_DATA_MODE=filesystem` the n8n process holds all per-segment PCM buffers in JS heap during the concat stage — a 12-min lesson can spike to 500-800 MB and OOM-kill on a 1 GB container (we hit this in production on 2026-05-18).

```bash
# Store binary data on disk, not in RAM/DB. Biggest single memory win.
N8N_BINARY_DATA_MODE=filesystem

# Auto-prune old executions so the DB doesn't grow unbounded.
EXECUTIONS_DATA_PRUNE=true
EXECUTIONS_DATA_MAX_AGE=168                      # hours (7 days)
EXECUTIONS_DATA_PRUNE_TIMEOUT=3600

# Don't store intermediate node-by-node data for successful runs (only errors).
EXECUTIONS_DATA_SAVE_ON_SUCCESS=none
EXECUTIONS_DATA_SAVE_ON_ERROR=all
EXECUTIONS_DATA_SAVE_DATA_ON_PROGRESS=false
```

For Docker-based deployments add them under `environment:` in `docker-compose.yml`. Restart n8n after changes. Verify by opening any execution → binary outputs should show "filesystem reference" instead of base64 strings.

Also recommended:
- **Postgres instead of SQLite** for the n8n DB (`DB_TYPE=postgresdb`). Postgres is far more resilient to abrupt termination; SQLite corrupted during the 2026-05-18 OOM kill and wiped workflows/credentials.
- **≥4 GB RAM** on the n8n host for 12-min lessons. ~8 GB if you plan to run multiple long lessons concurrently.

## Re-importing into n8n

After cloning this repo or pulling new workflow JSON:
1. n8n → Workflows → ⋯ → Import from file (import W1, W2, W3 first, then W_Master)
2. Re-bind credentials on each node (Google Sheets account, Google Drive account, Deepgram Header Auth, ElevenLabs Header Auth, Slack account if using W_Master)
3. In `W_Master.json`: re-bind the three Execute Workflow nodes to the IDs n8n assigned to W1/W2/W3 after import
4. Re-verify sheet IDs and Drive folder IDs in the config sheet

The full reference for credentials, config keys and sheet schemas is in [`../docs/`](../docs/).
