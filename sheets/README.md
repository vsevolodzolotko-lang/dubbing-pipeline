# sheets/

Local **reference copies** of the Google Sheets data + schema. Actual runtime source-of-truth is the live Google Spreadsheet (one document, 5 tabs) that all workflows read via the Google Sheets API.

## Files

| File | What it is |
|------|------------|
| `voices.csv` | Snapshot of the live `voices` tab — `lang`, `voice_id`, `model`, `stability`, `similarity_boost`, `style`, `speed`. Use as starting point when setting up a fresh Sheet. |
| `prompts.tsv` | Snapshot of the live `prompts` tab — 11 prompts + ToV. Tab-separated to preserve multi-line prompt values. Use as starting point. |
| `dubbing-pipeline_bk_21:05.xlsx` | Excel backup of the whole 5-tab document, including a recent run's data. Reference-only — do NOT re-import into Sheets directly without rebuilding the IDs. |

## Live Sheet structure

The runtime sheet has **5 tabs**. Full column-level schema with types and write rules is in [../docs/sheets_schema.md](../docs/sheets_schema.md).

| Tab | Purpose | Written by | Read by |
|-----|---------|-----------|---------|
| `config` | One row per config key. API keys, Drive folder IDs, timing thresholds, Slack channel, ToV doc. | Operator (manual setup) | All workflows |
| `segments` | One row per EN segment. `segment_id`, `en_text`, timestamps, then per-lang translations + tone-analysis output (`segment_type`, `movement_keywords`). | W1 writes EN + timestamps; W2 writes translations + tone fields | W3, W_Regen |
| `voices` | One row per language. ElevenLabs voice ID + tuning params. | Operator (manual setup) | W3, W_Regen |
| `localizations` | One row per `(segment_id × lang)`. Run-time diagnostics: durations, retries, `needs_attention`, `audio_drive_file_id`, etc. **Wiped (rows 2+) at the start of every W_Master run; the previous data is preserved in `05_archive/{archive_name}/sheet_snapshot_*`.** | W3, W_Regen | W_Master Slack message, W_Regen filter |
| `prompts` | One row per prompt key. 11 prompts + ToV — externalized so prompt-tuning doesn't require touching code. | Operator (manual edits) | W2, W3 |

## When the schema changes

1. Update [../docs/sheets_schema.md](../docs/sheets_schema.md) — the canonical reference.
2. Add a `DECISIONS.md` entry explaining why.
3. Refresh the snapshot files in this folder if the change affects starter values (`voices.csv`, `prompts.tsv`).
4. Update [../docs/config_keys.md](../docs/config_keys.md) if a config key was added/removed/renamed.
