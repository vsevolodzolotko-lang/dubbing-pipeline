# sheets/

Descriptions of the Google Sheets structure used by the pipeline. Actual sheet data lives in Google Drive — this folder documents the schema so the n8n workflows and scripts can be understood without opening the spreadsheet.

| File | Describes |
|------|-----------|
| `transcripts-schema.md` | Main input sheet. Columns: `lesson_id`, `segment_id`, `start_time`, `end_time`, `source_text` (EN), then one column per language (DE, ES, FR, IT, PL, PT, TR) for translated text and status. |
| `voice-mapping-schema.md` | Lookup table: `language_code` → `elevenlabs_voice_id` → `voice_name`. Used by `build-tts-payload.js` to select the correct voice per language. |
| `cost-log-schema.md` | Append-only log written by the pipeline after each batch: `run_id`, `timestamp`, `segment_count`, `claude_tokens`, `elevenlabs_chars`, `estimated_usd`. |

When the actual sheet structure changes, update the schema file here and add a note in DECISIONS.md.
