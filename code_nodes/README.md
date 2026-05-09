# code_nodes/

JavaScript code snippets intended for use inside **n8n Code nodes**. Each file contains a single self-contained function body that can be pasted directly into an n8n Code node (JavaScript mode).

| File | Purpose |
|------|---------|
| `build-tts-payload.js` | Constructs the ElevenLabs TTS request body from upstream translation output. Handles voice ID lookup by language code. |
| `parse-claude-response.js` | Extracts and validates the JSON object from a Claude API response. Throws a descriptive error if parsing fails so n8n can route to the error branch. |
| `flatten-segments.js` | Takes a nested translation object (segment → language → text) and emits one item per segment+language combination for parallel processing. |
| `build-rpp-manifest.js` | Assembles the synthesis manifest (file paths, offsets, language codes) that the RPP generation script consumes. |

Keep each file focused on a single transformation. Complex logic belongs in `scripts/` and should be tested there first.
