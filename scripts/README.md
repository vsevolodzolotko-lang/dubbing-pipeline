# scripts/

Node.js utility scripts for local development, calibration, and testing. These run outside n8n — either on the command line or in CI.

| File | Purpose |
|------|---------|
| `calibrate-voices.js` | Calls ElevenLabs API for each configured voice ID and saves a short sample clip to `/tmp/calibration/`. Used to verify voice mapping before a full batch run. |
| `test-claude.js` | Smoke test for the Claude API: sends a minimal tone-analysis prompt and prints the raw response. Validates API key and model availability. |
| `test-elevenlabs.js` | Smoke test for ElevenLabs TTS: synthesizes one sentence per language and reports latency + character count. |
| `estimate-cost.js` | Given a transcript file, estimates token cost (Claude) and character cost (ElevenLabs) for a full 7-language run. |

Run with `node scripts/<file>.js`. Requires `.env` with valid API keys.
