# scripts/

Local Node.js helpers — run outside n8n on the command line. Requires `.env` with valid API keys.

| File | Purpose |
|---|---|
| `test_apis.js` | Smoke test for `ANTHROPIC_API_KEY` and `ELEVENLABS_API_KEY`. Hits Claude with a one-token completion and ElevenLabs voice-list endpoint. Confirms both keys work before running the full n8n pipeline. |
| `analyze_cps.js` | Takes a localizations CSV (export from the `localizations` tab) and prints the observed CPS (chars-per-second) per language for rows where `final_speed=1.0`. Compares with current `cps_estimate_{lang}` values in `config.csv` if present alongside, and suggests rounded recommendations. Use after each W3 run, especially after voice changes. |

## Usage

```bash
# from repo root
node scripts/test_apis.js

# analyze CPS — point at any exported localizations CSV
node scripts/analyze_cps.js /path/to/localizations.csv
# (if a sibling config.csv is present, the script also compares with current cps_estimate_* values)
```

---

## CPS calibration runbook

Use this whenever you need to update `cps_estimate_{lang}` values in the `config` sheet — after a voice swap, when adding a new language, or just periodically to keep the timing model in sync with real TTS output.

### When to run

- After changing any `voice_id` in the `voices` sheet (voice swap = different speaking pace = different CPS).
- After adding a new language (run W2 first to generate translations, then W3 to get TTS data, then calibrate).
- After ~3-5 lessons through the pipeline, just to keep numbers honest.

### Step 1 — Run W3 on a real lesson

W3 writes per-segment timing data to the `localizations` sheet. You need at least 5–7 segments per language for stable averages.

### Step 2 — Export both sheets as CSV

In Google Sheets:
1. Open the `localizations` tab → File → Download → Comma-separated values (.csv). Save anywhere.
2. Same for the `config` tab → save **next to** `localizations.csv` in the same folder, and name it `config.csv`. (Without `config.csv`, the script still reports observed CPS — it just can't show the `current` and `delta` columns.)

Tip: drag-drop the CSV file from Finder into the terminal to avoid path-escape issues with non-ASCII folder names.

### Step 3 — Run the analyzer

```bash
cd ~/Documents/dubbing-pipeline
node scripts/analyze_cps.js "$HOME/Downloads/localizations.csv"
```

You'll get:
- Per-segment CPS (useful for spotting one weird outlier)
- A summary table with `observed_cps`, `current` (from config.csv if present), `recommend` (observed rounded to nearest 0.5), and `delta` (observed − current)

### Step 4 — Update the `config` sheet for any |delta| > 1.0

Open the Google Sheet → `config` tab → find the rows `cps_estimate_de`, `cps_estimate_es`, …, `cps_estimate_tr` and bump their values to the `recommend` column.

Why the 1.0 threshold: smaller deltas are within normal voice variance per-segment (short utterances always read faster cps than long ones because trailing silence inside a single TTS clip pulls the rate up). Only act on a sustained drift across many samples.

### Step 5 — Re-run the pipeline

No code or workflow changes needed — `cps_estimate_{lang}` is read from config at runtime by W2 Adapt Translations and W3 Check Timing + Pad. New translations and synthesize runs will use the updated values immediately.

Look for these improvements in the next run's `localizations` sheet:
- Fewer rows with `shorten_retries_in_synthesize > 0` (W2 estimated correctly → less work for W3 to fix)
- Fewer rows with `final_speed > 1.0` (less last-resort speed adjustment)
- Fewer rows with `expansion_attempts > 0` (W2 didn't over-shorten)

---

## `test_apis.js` expected output

Reads `.env` (via `dotenv`). Expected output:
```
[1] Claude API
  ✓ key valid
[2] ElevenLabs API
  ✓ key valid
  ✓ N voices available
```

## Other scripts

- `verify_borrow_compensation.js` — post-run alignment audit; checks that concat-time borrow compensation kept cross-lang full WAVs aligned to EN.
- `sync_w2_jscode.js` — syncs `code_nodes/*.js` reference copies back into the embedded JS inside `workflows/W2_Translate_v2.json` (round-trip helper after editing a Code-node body locally).

## History

Earlier development included `spike_test.js` (EN→DE end-to-end spike) and `test_pipeline.js` (local clone of W1+W2+W3 logic for prototyping). Both were removed once the n8n workflows became production. Their behavior lives in `workflows/W1_STT_and_Segment.json`, `workflows/W2_Translate_v2.json`, `workflows/W3_Synthesize_v2.json`.
