# docs/

Additional documentation for the pipeline — runbooks, reference guides, and architecture notes.

| File | Purpose |
|------|---------|
| `runbook.md` | Step-by-step operational guide: how to trigger a localization run, monitor progress in n8n, rerun failed segments, and deliver output files. |
| `reaper-hotkeys.md` | Hotkey reference for the ReaScript workflow inside Reaper: what each key does, how to install the scripts, and troubleshooting tips. |
| `architecture.md` | High-level diagram and narrative description of the full pipeline data flow: Google Sheets → n8n → Claude → ElevenLabs → RPP → Reaper. |
| `voice-calibration.md` | Notes on ElevenLabs voice selection per language: which voice IDs are in use, why they were chosen, and how to recalibrate if quality degrades. |

Files are added here as each feature reaches a stable state. Work-in-progress notes belong in the relevant week's PLAN.md checklist, not here.
