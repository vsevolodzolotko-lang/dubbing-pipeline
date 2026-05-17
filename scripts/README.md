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

Reads `.env` (via `dotenv`). Expected output:
```
[1] Claude API
  ✓ key valid
[2] ElevenLabs API
  ✓ key valid
  ✓ N voices available
```

## History

Earlier development included `spike_test.js` (EN→DE end-to-end spike) and `test_pipeline.js` (local clone of W1+W2+W3 logic for prototyping). Both were removed once the n8n workflows became production. Their behavior lives in `workflows/W1_STT_and_Segment.json`, `workflows/W2_Translate_v2.json`, `workflows/W3_Synthesize_v2.json`.
