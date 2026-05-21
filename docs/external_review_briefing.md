# Spirio Dubbing Pipeline — external review briefing

You are reviewing a production audio-dubbing pipeline. The user pastes this briefing into your chat alongside a `prompts` table (11 rows × 3 columns: `key | description | value`) extracted from the pipeline's live Google Sheets configuration. Your job is to evaluate both the prompts and the surrounding architecture, then provide concrete refactoring suggestions.

This document is self-contained — everything you need is here. Don't ask for repo links or external docs. The prompt text itself lives in the table the user pastes; this briefing tells you what each row's `key` means and what context it operates in.

---

## 1. Project goal

The pipeline takes a single English meditation/wellness audio file (typically 3-15 minutes), transcribes and segments it, translates every segment into 7 European languages (DE, ES, FR, IT, PL, PT, TR), and synthesizes voiced dubs in each language using neural TTS — preserving the EN timeline exactly so a player can swap languages mid-lesson without drift. Output: one full-lesson WAV per language plus per-segment WAV files for QA. End consumers are listeners using the Spirio meditation/wellness app.

Quality bar is high because the content is therapeutic — translations that "sound right grammatically" but lose the affirmative/self-acceptance core (e.g., translating "I am valid" with a word that means "valid ticket" in German) are unacceptable.

---

## 2. High-level architecture

Built on [n8n](https://n8n.io) (open-source workflow automation), 4 workflows orchestrated by a parent `W_Master`:

```
input audio dropped in Drive folder
         │
         ▼
   W_Master (Drive trigger)
         │
         ▼
   W1 — STT_and_Segment
   (Deepgram Nova-3 → segments table)
         │
         ▼
   W2 — Translate v2
   (the big one — Claude + Gemini, multi-stage QA)
         │
         ▼
   W3 — Synthesize v2
   (ElevenLabs TTS + Claude Haiku timing fixes)
         │
         ▼
   Slack notification with Drive links
```

Data layer: a single Google Spreadsheet with 5 tabs (described below). External APIs: Anthropic Claude Sonnet 4.5 (translation + QA + adapt), Google AI Studio Gemini 3.5 Flash (editorial QA), Anthropic Claude Haiku 4.5 (W3 in-flight shorten/expand), OpenAI GPT-5 (kept on canvas as orphan alternative editor), ElevenLabs (TTS), Deepgram (STT), Google Drive + Sheets.

---

## 3. Data model (Google Sheets, 5 tabs)

| Tab | Purpose | Key columns |
|---|---|---|
| `segments` | Source EN segments + final translations (1 row per EN segment) | `segment_id`, `en_text`, `en_start_sec`, `en_end_sec`, `en_duration_sec`, `segment_type`, `movement_keywords`, `de_text`/`es_text`/... |
| `localizations` | Per-segment per-lang TTS outputs (1 row per segment×lang) | `segment_id`, `lang`, `text_translated`, `real_duration_sec`, `lead_silence_sec`, `tail_silence_sec`, `borrowed_sec`, `final_duration_sec`, `needs_attention`, `audio_drive_file_id` |
| `voices` | Per-lang ElevenLabs voice config | `lang`, `voice_id`, `stability`, `similarity_boost`, `style`, `speed`, `model` |
| `config` | API keys, folder IDs, numeric thresholds | `key`, `value` (e.g., `anthropic_api_key`, `min_inter_segment_gap_sec`, `cps_estimate_de`, etc.) |
| `prompts` | All editable LLM prompts + brand ToV | `key`, `description`, `value` (multi-line text). This is the table you'll receive alongside this briefing. |

The pipeline was recently refactored so all editable text lives in `prompts` — historically it was hardcoded in Code nodes; now Code nodes do `loadPrompt(key, vars)` at runtime, substituting `{{var}}` placeholders. Editing a prompt cell in the Sheet flows to the next workflow run automatically — no n8n re-import needed.

---

## 4. W2 translation pipeline (detailed — most relevant for prompt review)

This is where most of the prompts live. The full chain:

```
Manual / Execute Trigger
    → Get Params (extracts lesson_id)
    → Read Config (API keys, thresholds)
    → Read Prompts          ← prompts tab loaded once here
    → Read Pending Segments (lesson's EN segments)
    → Prepare Tone Analysis (Code)
       │  Builds Claude request; uses prompt `tone_analysis_system`
       ▼
    → Claude Tone Analysis (HTTP, Sonnet 4.5)
       │  Classifies each segment as narrative/instruction/movement,
       │  extracts movement_keywords + key_concepts
       ▼
    → Parse Tone Map (Code)
    → Update Tone Columns (writes back to segments sheet)
    → Prepare and Expand (Code)
       │  Builds batched Claude request; uses prompt `translate_system`
       │  with `{{tov}}` interpolated. BATCH_SIZE=8 segments per call.
       ▼
    → Wait 4s (rate-limit cushion)
    → Claude Translate (HTTP, Sonnet 4.5)
    → Extract Translations (Code, splits batched JSON into per-seg items)
    → Verify Translations (Code, calls Sonnet directly)
       │  In-Code-node HTTP calls. Sonnet self-QA pass.
       │  Uses prompt `qa_verify_system`. Chunked-parallel CHUNK=3.
       │  Output: per-seg corrections object merged into translations.
       ▼
    → Gemini Editor (Code, calls Gemini 3.5 Flash via Google's OpenAI-compatible endpoint)
       │  Cross-model second-pass editor. Same input/output as Verify.
       │  Uses prompt `editor_system`. Chunked-parallel CHUNK=3.
       │  This was originally GPT-5 (still on canvas as orphaned alternative)
       │  but Gemini Flash is ~5-10× faster + ~10× cheaper with comparable
       │  EU-multilingual quality.
       ▼
    → Adapt Translations (Code, calls Sonnet 4.5 in parallel per lang)
       │  Last-mile CPS-budget shortening. Up to 3 attempts per (seg, lang)
       │  with increasing aggression (light → medium → max).
       │  Uses 4 prompts: `adapt_shorten_system` + `adapt_attempt_{light,medium,max}`
       │  Parallel per-lang via Promise.all (max 7 concurrent inside one segment).
       │  Segments themselves are sequential.
       ▼
    → Update Sheet (writes final `{lang}_text` + adaptation_attempts to segments)
```

**4-layer translation defense**:
1. **Translate** (Sonnet) produces baseline translations.
2. **Verify Translations** (Sonnet self-QA) — anti-pattern detection: false friends, formality drift, ToV violations. Returns unchanged when clean.
3. **Gemini Editor** (cross-model) — second reviewer from different model family catches what Sonnet's self-review missed by definition.
4. **Adapt Translations** (Sonnet shortener) — if estimated TTS duration > en_duration_sec × 1.05, shorten translation to fit, up to 3 attempts with progressively more aggressive rewriting.

**Cross-model rationale**: Sonnet QA reviewing Sonnet output is same-family self-review with same biases. Adding a non-Anthropic reviewer (Gemini or GPT-5) catches systematic blind spots. This is intentional and should be preserved.

**Why chunked-parallel (CHUNK=3) on Verify + Editor**: large lessons (~50 segs → ~7 batches at QA_BATCH_SIZE=8) used to take 200+ seconds sequentially in the GPT-5 editor stage alone, hitting n8n's 300-second task-runner timeout. CHUNK=3 fires 3 batches concurrently per chunk, respecting Tier-1 OpenAI/Anthropic rate limits.

**Adapt's CPS shortening**: estimates duration as `text.length / LANG_CPS[lang]` where LANG_CPS is per-language characters-per-second tuned against real ElevenLabs output (DE=12, ES=15, FR=15, IT=14, PL=14, PT=16, TR=14, overridable via config). If estimate > en_duration_sec × 1.05, Sonnet is asked to shorten with progressively more aggression — light (5-15% shorter), medium (15-25%), max (compress to essential meaning).

---

## 5. W3 synthesis pipeline (brief — uses 2 prompts)

After translations are finalized, W3 reads each (segment × active_lang), calls ElevenLabs TTS, measures PCM duration, and pads with silence to fit the EN slot. If TTS audio overshoots the slot (translation longer than expected), it triggers an **in-flight Claude Haiku shorten loop** (prompts `w3_shorten_system` + dynamic task description). If audio undershoots significantly (translation shorter than expected) and finalSpeed is still 1.0, it triggers an **expand loop** (prompts `w3_expand_system`). Both prompts interpolate `{{tov}}`.

**Breath-borrow timing**: short segments (< 2s) whose TTS just barely overshoots may extend past en_end_sec by up to 2s into the trailing silence before the next EN segment, bounded by `max_borrow_per_segment_sec`. At full-WAV concat time, the borrowed duration is trimmed from the next segment's lead silence — preserving EN-timeline alignment cumulatively. This matters because cross-lang sync (a user toggles language mid-lesson and the audio doesn't drift) is a hard product constraint.

**TTS via ElevenLabs**: 7 voices (one per lang) configured in `voices` sheet. Format: PCM 22050Hz mono 16-bit (`pcm_22050`). Loop Over Items processes one segment at a time (batchSize=1) to respect ElevenLabs concurrency limits.

---

## 6. The 11 prompts (index)

You'll receive the actual prompt text alongside this briefing. Here's what each key means:

| Key | Role | Consumer | Model | Placeholders | Output format | ~Size |
|---|---|---|---|---|---|---|
| `tone_of_voice` | Brand voice spec (Spirio meditation app) | Referenced by `translate_system`, `w3_shorten_system`, `w3_expand_system` via `{{tov}}` | — | — | Plain text | ~6.5K chars |
| `tone_analysis_system` | Classifier — tags each EN segment with type (narrative/instruction/movement), movement_keywords, key_concepts | W2 Prepare Tone Analysis | Sonnet 4.5 | — | JSON object: `{ segment_id → { segment_type, movement_keywords, key_concepts } }` | ~334 chars |
| `translate_system` | Main translator into 7 langs from EN | W2 Prepare and Expand | Sonnet 4.5 | `{{tov}}` | JSON object: `{ segment_id → { de, es, fr, pl, pt, it, tr } }` | ~880 chars + tov |
| `qa_verify_system` | Sonnet self-QA — false friends, formality drift, ToV violations | W2 Verify Translations | Sonnet 4.5 | — | Same JSON schema as `translate_system`; return unchanged when clean | ~4.4K chars |
| `editor_system` | Cross-model strict editor (Gemini active, GPT-5 orphaned alternative) | W2 Gemini Editor, W2 OpenAI Editor | Gemini 3.5 Flash / GPT-5 | — | Same JSON schema; return unchanged when clean | ~4.7K chars |
| `adapt_shorten_system` | CPS-budget shortener system prompt with anti-pattern guards | W2 Adapt Translations | Sonnet 4.5 | — | Plain shortened text (single language, single segment) | ~1.2K chars |
| `adapt_attempt_light` | Attempt 1 user-message template — light shortening (~5-15%) | W2 Adapt Translations | Sonnet 4.5 | `{{lang}} {{budget}} {{est}} {{en}} {{trans}} {{min_chars}}` | Plain shortened text | ~330 chars |
| `adapt_attempt_medium` | Attempt 2 — medium shortening (~15-25%) | W2 Adapt Translations | Sonnet 4.5 | Same as light | Plain shortened text | ~310 chars |
| `adapt_attempt_max` | Attempt 3 — max shortening (preserve concepts, drop secondary context) | W2 Adapt Translations | Sonnet 4.5 | Same as light | Plain shortened text | ~360 chars |
| `w3_shorten_system` | W3 in-flight single-segment shortener (when TTS overshoots slot) | W3 Check Timing + Pad | Claude Haiku 4.5 | `{{tov}}` | Plain shortened text | ~1.7K chars + tov |
| `w3_expand_system` | W3 in-flight single-segment expander (when TTS undershoots threshold × en_duration) | W3 Check Timing + Pad | Claude Haiku 4.5 | `{{tov}}` | Plain expanded text | ~1.4K chars + tov |

Placeholder convention: `{{var}}` — double curly braces, no spaces. `String.replace` based, regex-aware, fails silently if user types `{var}` instead. (This is a known mild risk; we mitigate by documenting valid placeholders in the `description` column of each prompt row.)

**Loading mechanism**:

```js
const promptMap = {};
$('Read Prompts').all().forEach(i => { if (i.json.key) promptMap[i.json.key] = i.json.value; });
function loadPrompt(key, vars = {}) {
  const raw = promptMap[key];
  if (!raw) throw new Error(`Missing prompt "${key}" in prompts sheet`);
  return Object.entries(vars).reduce(
    (s, [k, v]) => s.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v ?? '')),
    raw
  );
}
```

Throw-on-missing is deliberate (fail-fast over silent fallback to baked-in defaults).

---

## 7. Hard constraints (preserve in any refactor)

These are product/code constraints the prompts must continue to encode. Any refactor that drops these is a regression.

**Languages**: 7 targets — DE, ES (**Castilian only**, not LatAm), FR, IT, PL, PT (**European only**, not Brazilian), TR. EN is the source.

**Address**: informal singular always. Per-language anti-forms:
- DE: must use `du/dich/dein`, never `Sie/Ihnen/Ihr`
- ES: must be Castilian `tú/te/tu`, never `usted/le/su`, never `vos/ustedes` (LatAm)
- FR: must use `tu/te/ton/ta/tes`, never `vous/votre/vos`
- IT: must use `tu/ti/tuo/tua`, never capitalized formal `Lei/La/Suo/Le`
- PL: must use direct `ty`-verb forms (e.g., `jesteś`, `czujesz`), never `Pan/Pani/Państwo`
- PT: must be European `tu/te/teu/tua` with EU conjugation (`tu fazes`, `tu sentes`), never Brazilian `você/seu/sua` or BR verb forms (`você faz`, `você sente`)
- TR: must use `sen/seni/senin`, never `siz/sizi/sizin`

**False-friend traps** the prompts explicitly warn against (caught by both Verify and Editor):
- DE `gültig` for "valid" (means "valid ticket") → use `wertvoll` or `richtig, so wie ich bin`
- FR `suffisant` for "enough" about a person (means "arrogant") → use `assez` or `Je me suffis`
- FR `valide` for "valid" about a person (means "able-bodied") → use `légitime` or `J'ai ma place`
- TR `geçerli/geçerliyim` for "valid" (means "valid as a rule") → use `Değerliyim` or `yeterliyim`
- PL bare `Jestem dość` for "I am enough" (ungrammatical) → use `Jestem wystarczający` or `Jestem dość dobry`
- ES `válido`, PT `válido`, IT `valido` for "valid" about a person — clinical/legal feel → prefer warmer `Yo valgo`, `Eu tenho valor`, `Ho valore`

**Length budget**: keep translations within ±25% of original character count. This is enforced softly by the Adapt stage's CPS estimation; the prompts ask for it explicitly.

**Preserve exactly**: negations (`no`/`not`/`never`/`without`), contrasts (`A, not B` / `A but B`), numbers, proper nouns, named techniques (e.g., specific breathing patterns), ellipsis `...` and em-dash `—` as pause timing markers.

**Tone of voice** (full text is in the `tone_of_voice` row of the prompts table you'll receive — read it first). High-level: warm knowing-friend, never marketing/promise/guarantee tone, never imperative filler like "Just relax", sensation-grounded language preferred ("notice the weight of your hands" not "feel relaxed").

**Output format on batched calls** (`translate_system`, `qa_verify_system`, `editor_system`): single JSON object mapping `segment_id → { de, es, fr, pl, pt, it, tr }`. Every input segment_id MUST appear in the output. No `en` in output. No markdown fences. No commentary.

---

## 8. Recent observations (factual context)

- Translation pipeline has been iterated on for ~10 days. Current state appears to produce good results on test lessons (`the_anchor`, `tc_practice_23_ph2-flow-the-ball`, `test4`).
- Editor stage was migrated from inline GPT-5 to Gemini 3.5 Flash on cost/speed grounds (~10× cheaper, ~5-10× faster per batch, comparable quality on EU-multilingual editorial). GPT-5 stays on canvas as an alternative.
- A known latency cliff: even small lessons (2 segments) take ~1 minute through W2, mostly single-call LLM latency on the QA/editor stages.
- Prompts were originally hardcoded in n8n Code-node `jsCode` strings. Recently externalized into the `prompts` Sheets tab for daily editability without n8n re-import. The substitution happens at workflow-run time via `loadPrompt(key, vars)`.

---

## 9. Your evaluation task

The user wants you to evaluate **both prompts and architecture**. Specifically:

**Per-prompt review** (each of the 11 prompts):
- Clarity: is the role/expectation unambiguous?
- Completeness: does it cover what a reasonable LLM needs to do the job correctly?
- Token efficiency: is the prompt unnecessarily long? Are constraints repeated more than they need to be?
- Error prevention: does it forestall common failure modes (markdown fences, commentary, language switching, etc.)?
- Robustness against model drift: would a new model version with different default behavior break this prompt?

**Cross-prompt review**:
- **`qa_verify_system` vs `editor_system`**: both do "anti-pattern QA on translation output". Are they meaningfully differentiated? Should they be merged into one prompt run once (cheaper, faster) at the cost of cross-model diversity? Or differentiated more sharply (one catches X-class issues, the other Y-class)?
- **The 3 `adapt_attempt_*` prompts**: progressive aggression. Could this be encoded as one prompt with an `{{aggression_level}}` placeholder? Tradeoff vs three explicit templates?
- **`w3_shorten_system` vs `adapt_shorten_system`**: both shorten. One runs at W2 stage (per-batch, per-language), the other at W3 stage (per-segment, after TTS overshoots). Are they sufficiently differentiated, or is one of them redundant?

**Placeholder convention robustness**: any failure modes we missed? Edge cases where `{{var}}` substitution behaves unexpectedly?

**Architecture suggestions** (pipeline-level):
- Is the 4-layer defense (Translate → Verify → Editor → Adapt) over-engineered? Could it be 3 layers without quality loss?
- Is the Sonnet-then-Gemini cross-model split valuable, or could a single stronger model (e.g., Claude Opus or GPT-5 directly) replace both with better cost/quality?
- Adapt's CPS-shortening loops sometimes fail (segments still over budget after 3 attempts). Better approach?
- W3's in-flight shorten/expand operates after TTS has already produced audio. Could it be moved upstream (pre-TTS, with predicted TTS duration) for faster pipeline?

**Risks the team might not have considered**: open-ended. Anything from prompt-injection vulnerabilities (user-controlled `en_text` flowing into LLM prompts) to model-deprecation risks to cost-spike scenarios.

---

## 10. Suggested output format

Structure your response as Markdown:

```
# Per-prompt review

## tone_of_voice
Rating: N/5
Strengths: …
Issues: …
Suggested changes: (full rewrite if substantive, else "n/a")

## tone_analysis_system
…

[continues for all 11 prompts]

# Cross-prompt review
[the differentiation / merging questions above]

# Placeholder convention
[notes]

# Architecture suggestions
- [Suggestion 1] (effort: low/med/high, impact: low/med/high)
- [Suggestion 2]
…

# Risks / unknowns
[bulleted list]
```

Be concrete. If you say "tighten this prompt", show what you'd rewrite. If you say "the architecture should merge X and Y", explain the tradeoff and which constraint(s) from section 7 might break.

---

## 11. What NOT to change

These are load-bearing for the existing codebase:

- **Prompt keys** (e.g., `qa_verify_system`, `adapt_attempt_light`) — strings match in Code nodes. Renaming a key breaks the pipeline.
- **Placeholder syntax** `{{var}}` — double curly braces. Code uses a regex that expects exactly this.
- **Required output JSON schema** for batched calls (`translate_system`, `qa_verify_system`, `editor_system`): `{ segment_id → { de, es, fr, pl, pt, it, tr } }`. Code parses this structure verbatim.
- **Cross-model architecture** (Sonnet + non-Anthropic editor): if your refactor collapses both onto one model family, flag the tradeoff explicitly and let the user decide — don't silently drop it.
- **Hard constraints in section 7**: address informality, EU variants, length budget, preservation rules, ToV principles. All must survive.

You may suggest changes to any prompt's wording, structure, length, placeholder list (within the existing convention), and to the pipeline topology — just be explicit about what you're touching.

Now read the `prompts` table the user pastes next, and produce your evaluation.
