# n8n Workflows

Four workflows: **W_Master** (Drive folder trigger, optional) chains **W1 → W2 → W3** sequentially. W1/W2/W3 can also be run manually — useful for debugging or one-off lessons.

## W_Master.json — Drive folder trigger orchestrator

**Input**: any audio file dropped into the Drive `input/` folder (configured by `drive_input_folder_id`).
**Output**: archives the previous run's artifacts into `05_archive/{prev_basename}_{date}/`, then triggers W1 → W2 → W3 in sequence on the new file, then posts a Slack notification with per-lesson `needs_attention` stats and clickable links to both output folders + a one-click W_Regen launcher.

| Node | Purpose |
|---|---|
| Drive Trigger (input/) | Polls the configured `drive_input_folder_id` for new files (every minute) |
| Parse Filename (Code) | Derives `lesson_id` from the filename (e.g. `sleep_002.mp3` → `sleep_002`); skips non-audio drops |
| Once Per Run (Code) | Collapses N Parse Filename items into a single sentinel item so the archive chain fires exactly once per trigger activation, regardless of multi-file drops. Carries the just-dropped `file_id`s so the archive step can exclude them. |
| Read Config (Archive) | Pulls all `drive_*_folder_id` keys + `drive_archive_folder_id` (must be set before W_Master can run). Separate from the existing post-W3 `Read Config` because the archive runs at the head of the workflow. |
| **Archive chain (11 nodes)** | Replaces the previous single-Code-node implementation (which relied on `helpers.httpRequestWithAuthentication`, blocked in some n8n Code Node sandboxes). All Drive + Sheets API calls go through HTTP Request nodes with `predefinedCredentialType` against `googleDriveOAuth2Api` / `googleSheetsOAuth2Api` — guaranteed to work in every n8n version. Chain runs at the start of each W_Master execution, before W1: `Plan Sources` (Code: emits 1 item per source folder, validates `drive_archive_folder_id` upfront) → `List Files` (HTTP GET `/drive/v3/files`, fires per source) → `Plan Archive` (Code: aggregates lists, excludes just-dropped trigger files, derives `archive_name` from previous-input basename or segments/full prefix + `YYYY-MM-DD_HH-MM` timestamp; emits `{skip:true}` if nothing to archive) → `Has Files To Archive?` (IF: routes around the destructive chain on first-run / pre-cleaned folders) → `Create Archive Root` (HTTP POST `/drive/v3/files` with `mimeType=folder`) → `Copy Sheet Snapshot` (HTTP POST `/drive/v3/files/{sheet_id}/copy` into archive root as `sheet_snapshot_{archive_name}`; **throws BEFORE any destructive op if snapshot fails** so previous data can't be lost) → `Plan Subfolders` (Code: emits 1 item per subfolder with files to move) → `Create Subfolder` (HTTP POST, fires per item) → `Plan Moves` (Code: pairs each file with its destination subfolder id) → `Move File` (HTTP PATCH `/drive/v3/files/{id}?addParents=&removeParents=`, fires N times, retryOnFail=3 with continueRegularOutput so partial failures don't kill the workflow) → `Clear Sheet Tabs` (HTTP POST `/spreadsheets/{id}/values:batchClear` with ranges `['segments!A2:ZZ','localizations!A2:ZZ']`, `executeOnce=true`; headers stay, `voices`/`prompts`/`config` NOT touched; failure logged but doesn't throw — moves already done) → `Pass Lessons (after Archive)` (Code: re-emits Parse Filename items so Execute W1 fan-out works as before). The IF false-branch also flows directly into Pass Lessons (after Archive), so first-run executions still proceed to W1. |
| Execute W1 (STT) | Calls W1 with `{file_id, lesson_id}`. Retry: 1 attempt on fail, then stop |
| Execute W2 (Translate) | Calls W2 with `{lesson_id}`. Retry: 1 attempt on fail, then stop |
| Execute W3 (Synthesize) | Calls W3 with `{lesson_id}`. Retry: 1 attempt on fail, then stop |
| Read Config | Pulls `drive_output_folder_id` (per-segment), `drive_output_full_folder_id` (full audio), `drive_output_vtt_folder_id` (VTT), `slack_channel`, `active_langs`, `w_regen_workflow_url` for the Slack message |
| Read Localizations | Pulls the `localizations` sheet so Build Slack Message can compute the per-lesson `needs_attention` rate (`flagged / total`, counting only `TRUE`) |
| Build Slack Message (Code) | Composes one Slack message per Parse Filename item using mrkdwn. Filters `localizations` rows by `segment_id.startsWith(lesson_id + '_')` to compute `needs_attention` % + count for the lesson. Renders **four clickable mrkdwn links**: `:file_folder: Full audio (per-lang)` → `drive_output_full_folder_id`, `:musical_note: Per-segment audio` → `drive_output_folder_id`, `:closed_book: VTT subtitles` → `drive_output_vtt_folder_id`, `:wrench: Regen Segments` → `w_regen_workflow_url`. Each link is omitted if its source config key is missing. Throws if `slack_channel` is missing. |
| Slack Notify | Posts the message via Slack API (Bot User OAuth Token). Configured with `unfurl_links: false`, `unfurl_media: false`, `includeLinkToWorkflow: false` — prevents Slack's link-preview bot from accidentally hitting the W_Regen webhook URL on message arrival (self-trigger loop) and removes the default "Automated with this n8n workflow" footer. |

**Setup checklist** (after importing):
1. Drive Trigger → confirm `folderToWatch` is your `input/` folder ID.
2. Execute W1 / W2 / W3 → re-bind to the workflow IDs assigned by your n8n instance after import.
3. Archive chain → check that each HTTP Request node (`List Files`, `Create Archive Root`, `Copy Sheet Snapshot`, `Create Subfolder`, `Move File`, `Clear Sheet Tabs`) has its `predefinedCredentialType` credential bound correctly (Drive ones use `googleDriveOAuth2Api`, the Clear node uses `googleSheetsOAuth2Api`). After import n8n usually keeps the binding, but verify on first opening.
4. Slack Notify → bind your Slack credential (Bot User OAuth Token `xoxb-...`). The credential ID in the JSON is a placeholder.
5. `config` sheet → add `slack_channel` = your channel ID (e.g. `C01234ABCDE`) + `drive_archive_folder_id` = the Drive folder ID of `05_archive`. The bot must be a member of the Slack channel unless its scopes include `chat:write.public`.
6. Set `active = true` on the workflow only after manual smoke-test (otherwise polling starts immediately).

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
| Gemini Editor (Code) | **Gemini 3.5 Flash cross-model second-pass** (active editor by default): in-Code-node HTTP calls to Google's OpenAI-compatible endpoint (`generativelanguage.googleapis.com/v1beta/openai/chat/completions`) with same Class 1/2/3 rules as Verify. Strict editor (returns clean translations unchanged). Chunked-parallel batches (CHUNK=3). Reads `gemini_api_key` from config. ~5-10x faster + ~10x cheaper than GPT-5 with comparable EU-multilingual quality. |
| OpenAI Editor (Code) | **GPT-5 alternative editor** (orphaned on canvas, not wired by default). Same input/output schema as Gemini Editor — swap by re-wiring Verify → OpenAI Editor → Adapt in n8n UI. Useful if Gemini quality drops on a specific lesson; otherwise stays on canvas as backup/A-B option. Reads `openai_api_key` from config. |
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
| ↳ Check Timing + Pad (Code) | The brains. Re-adapt via Gemini 3.5 Flash if over budget (3-tier shorten — switched from Claude Haiku 2026-05-31), retry at dynamic per-voice speed-up (`voice.speed + max_speed_up_delta` ceiling), hard-truncate as last resort. Permissive silence-borrow (2026-06-04): any non-movement segment may extend past `en_duration` into trailing silence, bounded by `effective_slot_sec`. Movement-locked segments (`movement_keywords` non-empty OR `segment_type == 'movement'`) stay strict at `en_duration`. Reads `movement_keywords` and `segment_type` from the Expand TTS Jobs payload. Prepend `lead_silence`, append `tail_silence`, build WAV. |
| ↳ Save to Drive | Upload per-segment WAV |
| ↳ Prepare Localization Row + Update Localizations | Write diagnostics row |
| ↳ Rate Limit Guard (Wait) | 0.5s between batched iterations (ElevenLabs Scale tier has plenty of RPM headroom) |
| Loop done → Read Localizations Fresh | Get all rows for concat + VTT stages (fan-out to two branches) |
| ↳ Download Segment WAV | Per-row Drive download, attaches binary |
| ↳ Build Full Audio Per Lang (Code) | Iterates `active_langs` sequentially, lazy-filters items per lang (no pre-grouping), strips 44-byte WAV headers, concats raw PCM, wraps fresh WAV header. Trims `borrowed_sec` from next segment's lead silence (drift-fix). Filters by `lesson_id` prefix. Explicit `pcmChunks.length = 0` after concat to help GC reclaim per-segment buffers between langs. |
| ↳ Save Full to Drive | Upload N full WAVs (one per active_lang) |
| ↳ Build VTT Per Lang (Code) | Parallel branch to Download Segment WAV. Generates one WebVTT file per active_lang. Cue text = `text_translated`; cue timings = `en_start_sec → en_end_sec` (EN-aligned, matches dubbed audio after borrow compensation). |
| ↳ Save VTT to Drive | Upload N `.vtt` files into `drive_output_vtt_folder_id` (falls back to `drive_output_full_folder_id` then `drive_output_folder_id`). |

## W_Regen.json — Manual cell regeneration

**Input**: rows in `localizations` flagged with `needs_retts=TRUE`. Two ways to launch:
1. **Manual Trigger** — open the workflow in n8n UI, click Execute. The editor-facing path documented in [`../docs/sheets_schema.md`](../docs/sheets_schema.md#L70-L84).
2. **Webhook Trigger** (added 2026-06-03) — public GET URL exposed by n8n. Slack messages from W_Master / W_Regen include an "Open W_Regen" link pointing at this URL. Clicking the link in Slack starts a fresh regen run without requiring an n8n login. Copy the production URL from the Webhook Trigger node and put it into the `w_regen_workflow_url` config key.

**Output**: per-segment WAVs overwritten in `drive_output_folder_id`; affected lessons' full WAVs rebuilt in `drive_output_full_folder_id`; matching VTT files rebuilt in `drive_output_vtt_folder_id`; the `needs_retts` flag cleared and `last_regen_at` set on each processed row; one Slack message per affected lesson with post-regen `needs_attention` rate.

| Node | Purpose |
|---|---|
| Manual Trigger | UI launch (editor flow) |
| Webhook Trigger | Public-URL launch (the "Open W_Regen" Slack link). `httpMethod=GET`, `responseMode=onReceived` so the browser gets an instant "Regen started" message and the workflow runs in the background. |
| Read Config / Read Voices / Read Localizations Initial | Pull inputs |
| Get Params (Code) | Reads `lesson_id` from incoming payload if present; null otherwise. Both Manual + Webhook triggers leave it null today (Regen Engine processes all flagged rows across lessons). |
| Regen Engine (Code) | The brains. Reads rows with `needs_retts=TRUE`, re-TTSes each via ElevenLabs, applies the same Phase 1-style timing logic (speed-up on overshoot, slowdown to fill on undershoot, hard-truncate as last resort). Bounded concurrency via `regen_concurrency` config (default 5). On successful regen, writes `needs_attention=REVIEW` (yellow — human must verify); writes `TRUE` only if regen STILL couldn't fit. Uses Kyiv-local time for `last_regen_at`. **Returns `[]` (empty) if no rows are flagged** — workflow ends silently with success status, no Slack notification, no sheet writes. Makes spurious triggers (Slack link unfurl, accidental webhook GET) harmless. |
| Has Audio? (IF) | Splits the success branch (has_audio=true) from the error/sentinel branch |
| Drive PATCH | Overwrites the per-segment WAV in place using `audio_drive_file_id` from the row |
| Merge Branches | Re-merges success + sentinel/error branches before updating the sheet |
| Update Localizations Row | Writes back per-row metrics (`final_speed`, `needs_attention`, `last_regen_at`, etc.) and clears `needs_retts` |
| Coalesce Updates | One-item pass-through to synchronize before the full-audio rebuild |
| Read Localizations Fresh | Re-read the sheet so the rebuild uses post-regen text/diagnostics |
| Build Full Audio Per Lang / Save Full to Drive / Search Same Name Full / Plan Old Deletes Full / Delete Old Full | Rebuild + upload + cleanup of duplicate full-lesson WAVs |
| Build VTT Per Lang / Save VTT to Drive / Search Same Name VTT / Plan Old Deletes VTT / Delete Old VTT | Same pattern for the per-lang VTT files |
| Wait For Saves (Merge) | Waits for both Save Full to Drive and Save VTT to Drive to complete before notifying Slack — so the operator clicking the folder link sees the new files |
| Build Regen Slack Message (Code) | Composes one Slack message per affected lesson with `Cells regenerated: N (M failed)` line and the same four clickable links (Full audio / Per-segment audio / VTT subtitles / Regen Segments). Reads regen stats from `$('Regen Engine').all()`. Skips notification when 0 cells were regenerated. Per-lesson `needs_attention` rate intentionally NOT shown (regen-successful cells move from `TRUE` → `REVIEW`, not `FALSE` — so the count of `TRUE` after regen would mislead; operator should look at the REVIEW state visually in the sheet). |
| Slack Notify (Regen) | Posts the message via Slack API. Same `unfurl_links: false`, `unfurl_media: false`, `includeLinkToWorkflow: false` as W_Master Slack Notify — prevents Slack from re-triggering W_Regen via link-preview bot. |

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
