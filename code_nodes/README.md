# code_nodes/

Reference copies of JavaScript bodies that live inside n8n **Code** nodes. The authoritative source is the `jsCode` field inside each workflow JSON — these `.js` files mirror that code so it's diff-friendly in PRs and readable in editors with JS support.

If you change a Code node in n8n, sync the corresponding file here (and vice versa).

| File | Lives in workflow | Node name | Purpose |
|---|---|---|---|
| `prepare_tone_analysis.js` | W2_Translate_v2 | Prepare Tone Analysis | Builds one Claude request body that classifies every segment's `segment_type` (narrative / instruction / movement) + extracts `movement_keywords` and `key_concepts`. |
| `parse_tone_analysis.js` | W2_Translate_v2 | Parse Tone Map | Extracts JSON from Claude tone-analysis response → one item per `segment_id`. |
| `prepare_and_expand.js` | W2_Translate_v2 | Prepare and Expand | Builds one Claude translate request per pending segment. Injects ToV + tone context. Wraps user content in `<english>...</english>` to stop Claude from interpreting short text as conversation. |
| `adapt_translations.js` | W2_Translate_v2 | Adapt Translations | CPS-based estimation per language. If estimated duration > en_duration_sec × 1.05, runs up to 3 progressive Claude shorten attempts (light → medium → max). Length floor 60% prevents over-shortening. |
| `check_timing_and_pad.js` | W3_Synthesize_v2 | Check Timing + Pad | Largest node. Measures real PCM duration of TTS output, runs Claude Haiku shorten loop (3 attempts), then ElevenLabs speed retry (1.10 / 1.15), then hard-truncate. Also runs an expansion loop (2 attempts) for over-shortened text. Prepends lead silence (with 0.05s cap), appends tail silence, builds final WAV. |
| `build_full_audio_per_lang.js` | W3_Synthesize_v2 | Build Full Audio Per Lang | After loop completes: groups all per-segment WAVs by language, sorts by `segment_id`, strips 44-byte WAV headers, concatenates raw PCM, wraps fresh WAV header. Emits 7 binary items (one per active lang). |

## Conventions

- All Code nodes return `[{ json: {...}, binary: {...} }, ...]` items.
- HTTP calls use `this.helpers.httpRequest` (not `fetch`, not raw `http`).
- Drive auth from Code nodes is NOT possible (`this.getCredentials` is unavailable). Use a separate `Google Drive` node before the Code node to handle the download — see `build_full_audio_per_lang.js`.
- Per-segment WAV format: PCM 22050Hz mono 16-bit (44-byte standard header). The `Build Full Audio Per Lang` node relies on this being constant.
