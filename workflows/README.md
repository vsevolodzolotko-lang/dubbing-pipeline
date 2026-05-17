# n8n Workflows

Three workflows that run sequentially: W1 → W2 → W3. Each is imported into n8n and triggered manually (Week 2 plan adds a Drive folder trigger).

## W1_STT_and_Segment.json — Speech-to-text + segmentation

**Input**: an MP3/WAV in Google Drive (file ID hardcoded in `Download Audio` node).
**Output**: rows in the `segments` sheet — one per sentence-group.

| Node | Purpose |
|---|---|
| Manual Trigger | Start the run |
| Download Audio | Pull the source file from Drive as binary |
| Deepgram STT | POST audio to Deepgram Nova-3 with `utterances=true&utt_split=1.5&smart_format=true&punctuate=true` |
| Segment Transcript (Code) | Walk `data.results.channels[0].alternatives[0].paragraphs.paragraphs[].sentences[]`, group consecutive sentences up to 150 chars (gap ≤ 1.0s), extend last segment to `data.metadata.duration` |
| Write to Sheet | Append/update rows in `segments` keyed on `segment_id` |

## W2_Translate_v2.json — Tone analysis + translation + adapt

**Input**: pending rows in `segments` (those without translations).
**Output**: same rows now have `de_text` … `tr_text`, `segment_type`, `movement_keywords`.

| Node | Purpose |
|---|---|
| Read Config / Read Pending Segments | Pull config and translatable rows |
| Prepare Tone Analysis (Code) | Build one Claude request for all segments to classify types and key concepts |
| Claude Tone Analysis | HTTP POST to Anthropic, model sonnet-4-5 |
| Parse Tone Map (Code) | Extract JSON, one item per segment_id |
| Update Tone Columns | Write `segment_type`, `movement_keywords` back to `segments` |
| Prepare and Expand (Code) | Build one Claude translate request per segment, with `<english>...</english>`-wrapped user content and ToV in system prompt |
| Wait + Claude Translate | Rate-limit-safe per-segment translation |
| Extract Translations (Code) | Parse JSON response, defensive skip on empty/refused responses |
| Adapt Translations (Code) | CPS-based estimation + up to 3-tier Claude shorten loop per (segment × lang) when text won't fit |
| Update Sheet | Append/update `{lang}_text` + `{lang}_adaptation_attempts` columns |

## W3_Synthesize_v2.json — TTS + timing + per-segment + per-lang concat

**Input**: `segments` rows with translations + `voices` + `config`.
**Output**:
- Per-segment WAVs in `drive_output_folder_id` (one per segment × lang)
- Full-lesson WAVs in `drive_output_full_folder_id` (one per lang, all segments concatenated)
- `localizations` sheet populated with per-row diagnostics

| Node | Purpose |
|---|---|
| Manual Trigger | Start |
| Read Config / Read Voices / Read Segments | Pull inputs |
| Expand TTS Jobs (Code) | Cross-join: emit one item per (segment × active_lang). Pre-compute slot timing — `slot_start_sec`, `slot_end_sec`, `lead_silence_natural_sec`, `tts_budget_sec`, `effective_slot_sec` |
| Loop Over Items (Split In Batches) | Per-segment-per-lang loop |
| ↳ ElevenLabs TTS | POST text to `eleven_multilingual_v2` with `output_format=pcm_22050` |
| ↳ Check Timing + Pad (Code) | The brains. Re-adapt via Claude Haiku if over budget (3-tier shorten), retry at speed 1.10/1.15, hard-truncate as last resort, expand if too short (max 2 attempts), prepend `lead_silence`, append `tail_silence`, build WAV |
| ↳ Save to Drive | Upload per-segment WAV |
| ↳ Prepare Localization Row + Update Localizations | Write diagnostics row |
| ↳ Rate Limit Guard (Wait) | 3s between TTS calls |
| Loop done → Read Localizations Fresh | Get all rows for concat stage |
| Download Segment WAV | Per-row Drive download, attaches binary |
| Build Full Audio Per Lang (Code) | Group by lang, sort by `segment_id`, strip 44-byte WAV headers, concat raw PCM, wrap fresh WAV header |
| Save Full to Drive | Upload 7 full WAVs |

## Re-importing into n8n

After cloning this repo or pulling new workflow JSON:
1. n8n → Workflows → ⋯ → Import from file
2. Re-bind credentials on each node (Google Sheets account, Google Drive account, Deepgram Header Auth, ElevenLabs Header Auth)
3. Re-verify sheet IDs and `audio_drive_file_id` if the lesson changed

The full reference for credentials, config keys and sheet schemas is in [`../docs/`](../docs/).
