# 4-Week Implementation Plan

## Week 1 — Batch Pipeline

- [ ] **Day 1** — Environment setup + spike test
  - [ ] n8n instance running locally (Docker)
  - [ ] ElevenLabs API key validated, voice IDs mapped for all 7 languages
  - [ ] Claude API key validated, basic completion call working
  - [ ] Spike: end-to-end test with a single 30-second transcript segment (EN → DE)
- [ ] **Days 2–3** — Workflow: Translate
  - [ ] n8n workflow reads source transcript from Google Sheets
  - [ ] Claude node: tone analysis prompt → structured JSON output
  - [ ] Claude node: translation prompt per language with tone context injected
  - [ ] Claude node: cultural adaptation pass (idioms, phrasing)
  - [ ] Results written back to Google Sheets per language column
- [ ] **Days 4–5** — Workflow: Synthesize
  - [ ] n8n workflow reads translated segments from Sheets
  - [ ] ElevenLabs node: TTS call per segment × 7 languages
  - [ ] Audio files saved to `/tmp` with structured naming (`{lesson}_{segment}_{lang}.mp3`)
  - [ ] Status column updated in Sheets on success/failure
- [ ] **Days 6–7** — Integration tests
  - [ ] Full batch run on 3 real course segments
  - [ ] Validate audio quality and translation accuracy spot-check
  - [ ] Error handling: retry logic for ElevenLabs 429s, Claude timeouts
  - [ ] Document findings in DECISIONS.md

---

## Week 2 — Reaper RPP Generation

- [ ] Design RPP template structure (tracks, markers, FX chain)
- [ ] Node.js script: parse synthesis output manifest → generate `.rpp` project file
- [ ] Map audio file paths into RPP track items with correct offsets
- [ ] Test RPP opens cleanly in Reaper with all 7 language tracks
- [ ] n8n node: trigger RPP generation after synthesis batch completes
- [ ] Validate timeline alignment against original video reference

---

## Week 3 — ReaScript Hotkey Workflow

- [ ] Design hotkey action set (nudge, mute, solo by language)
- [ ] Write ReaScript (Lua) for each hotkey action
- [ ] Install and test scripts in Reaper
- [ ] Document hotkey map in `docs/reaper-hotkeys.md`
- [ ] Test full editing session: open RPP → adjust timing → export stems

---

## Week 4 — Polish & Handoff

- [ ] End-to-end test on a full course module (all segments, all languages)
- [ ] Performance: benchmark Claude + ElevenLabs latency per segment
- [ ] Cost tracking: log token counts and TTS character counts to Sheets
- [ ] Write runbook in `docs/runbook.md` (how to trigger, monitor, rerun)
- [ ] Error dashboard in n8n (failed segments visible without opening workflow)
- [ ] Final review of all prompts and voice calibration
- [ ] Handoff: record a short walkthrough video
