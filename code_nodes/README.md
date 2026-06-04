# code_nodes/

Reference copies of JavaScript bodies that live inside n8n **Code** nodes. The authoritative source is the `jsCode` field inside each workflow JSON — these `.js` files mirror that code so it's diff-friendly in PRs and readable in editors with JS support.

If you change a Code node in n8n, sync the corresponding file here (and vice versa). For W2, `scripts/sync_w2_jscode.js` does the file → workflow direction automatically (run after editing any `code_nodes/*.js` file listed in its `NODE_FILE_MAP`).

| File | Lives in workflow | Node name | Purpose |
|---|---|---|---|
| `prepare_tone_analysis.js` | W2_Translate_v2 | Prepare Tone Analysis | Builds one Claude request body that classifies every segment's `segment_type` (narrative / instruction / movement) + extracts `movement_keywords` and `key_concepts`. The two movement signals feed back into W3 (Expand TTS Jobs → Check Timing + Pad) where they decide whether silence-borrow is allowed. |
| `parse_tone_analysis.js` | W2_Translate_v2 | Parse Tone Map | Extracts JSON from Claude tone-analysis response → one item per `segment_id`. |
| `prepare_and_expand.js` | W2_Translate_v2 | Prepare and Expand | Builds one Claude translate request per pending segment. Injects ToV + tone context. Wraps user content in `<english>...</english>` to stop Claude from interpreting short text as conversation. |
| `extract_translations.js` | W2_Translate_v2 | Extract Translations | Parses Claude's batched translation response, emits one item per segment with `{de, es, fr, pl, pt, it, tr}`. Defensive — skips broken batches with error log. |
| `gemini_editor.js` | W2_Translate_v2 | Gemini Editor | Cross-model editorial review (Gemini 3.5 Flash via OpenAI-compatible endpoint). Default active editor. Returns text unchanged when clean. |
| `openai_editor.js` | W2_Translate_v2 | OpenAI Editor (orphaned) | GPT-5 alternative editor. Sits on canvas but disconnected by default. Swap in via n8n UI if Gemini quality drops on a specific lesson. |
| `formality_lint.js` | W2_Translate_v2 + W3 Phase 2 expand | Formality Lint | Deterministic post-processor that enforces informal address (du/tu/ty/sen) per lang. |
| `adapt_translations.js` | W2_Translate_v2 | Adapt Translations | CPS-based estimation per language. If estimated duration > en_duration_sec × 1.05, runs up to 3 progressive Claude shorten attempts (light → medium → max). Length floor 60% prevents over-shortening. |
| `check_timing_and_pad.js` | W3_Synthesize_v2 | Check Timing + Pad | Largest node. Measures real PCM duration of initial TTS, runs Gemini 3.5 Flash shorten loop (3 attempts), then dynamic per-voice speed-up (`voice.speed + max_speed_up_delta` ceiling), then hard-truncate. Permissive silence-borrow: any non-movement segment may extend past `en_duration` into trailing silence (bounded by `effective_slot_sec`); movement-locked stays strict. Prepends lead silence, appends tail silence, builds final WAV. |
| `phase2_batch_llm_tts.js` | W3_Synthesize_v2 | Phase 2: Batch LLM + TTS | Slowdown-to-fill via Opus 4.7 expansion. Triggered for cells where Phase 1 `real_duration / en_duration < expansion_threshold`. Includes refusal/false-friend safety nets + re-TTS speed-up retry. |
| `trim_lead_for_sequence.js` | W3_Synthesize_v2 | Trim Lead For Sequence | Concat-time alignment fix. Trims `borrowed_sec[N]` bytes from segment N+1's lead silence so per-segment WAVs sum exactly to the full lesson WAV per language. |
| `build_full_audio_per_lang.js` | W3_Synthesize_v2 | Build Full Audio Per Lang | After loop completes: groups all per-segment WAVs by language, sorts by `segment_id`, strips 44-byte WAV headers, concatenates raw PCM, wraps fresh WAV header. Emits 7 binary items (one per active lang). |
| `build_vtt_per_lang.js` | W3_Synthesize_v2 | Build VTT Per Lang | One WebVTT file per active lang. Cue text = `text_translated`; cue timings = `en_start_sec → en_end_sec`. |
| `regen_synthesize.js` | W_Regen | Regen Engine | Reads `needs_retts=TRUE` rows from localizations, re-TTSes via ElevenLabs with Phase 1-style timing logic. Bounded concurrency (`regen_concurrency` config, default 5). On success writes `needs_attention=REVIEW` (yellow); on still-not-fit writes `TRUE`. Returns `[]` if no rows flagged (silent exit). |
| `predelete_drive_files.js` | W_Regen (reference) | Pre-Save Cleanup | Drive deduplication helper. Calls `this.helpers.httpRequestWithAuthentication` — note that this helper is BLOCKED in Code Node sandbox on some n8n versions; the production W_Regen uses HTTP Request nodes instead. Kept here as documentation of the pattern. |

## Conventions

- All Code nodes return `[{ json: {...}, binary: {...} }, ...]` items, or `[]` for no-op exit (downstream nodes simply don't fire).
- HTTP calls use `this.helpers.httpRequest` (not `fetch`, not raw `http`).
- `this.helpers.httpRequestWithAuthentication` and `this.getCredentials` are NOT available in Code Node on some n8n versions. For Drive/Sheets API calls that need OAuth, use a dedicated HTTP Request node with `authentication: predefinedCredentialType` + `nodeCredentialType: googleDriveOAuth2Api` (see W_Master archive chain, W_Regen Drive PATCH).
- Per-segment WAV format: PCM 22050Hz mono 16-bit (44-byte standard header). `Build Full Audio Per Lang` relies on this being constant.
