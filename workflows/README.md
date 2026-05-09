# workflows/

n8n workflow exports in JSON format. Import these via **n8n → Workflows → Import from file**.

| File | Purpose |
|------|---------|
| `translate.json` | Reads source transcript segments from Google Sheets, runs tone analysis and translation via Claude, writes results back to Sheets. |
| `synthesize.json` | Reads translated segments from Sheets, calls ElevenLabs TTS per segment × language, saves audio files, updates status column. |
| `generate-rpp.json` | Triggered after synthesis completes. Calls the RPP generation script and saves the `.rpp` project file to the output directory. |

**Versioning:** workflow JSON files are committed as-is. When making breaking changes, export the updated workflow, overwrite the file, and note the change in DECISIONS.md. Do not commit workflows with hardcoded credentials — use n8n credential references.
