# Decisions Log

## Decisions log

---

### 2026-05-09 — Example entry format

Context: Needed a consistent way to document architectural and product decisions so future contributors understand why choices were made, not just what was chosen.

Decision: Use a flat markdown file with dated entries, each containing Context / Decision / Rationale sections.

Rationale: Lightweight, lives in the repo, no extra tooling required. ADR format is overkill for a small pipeline project; a simple log is enough to capture the key tradeoffs.

---

### 2026-05-10 — DE audio expansion observed in spike test

Context: First end-to-end spike test (EN → DE, 60s source audio).

Decision: Flagged for investigation — no immediate fix applied.

Rationale: DE translated text was 19.6% longer in chars and TTS output was 15.9% longer (79.4s vs 68.5s). This is standard German verbosity, but for a dubbing pipeline it means DE audio won't fit EN video gaps. Mitigation options to evaluate: (1) increase TTS `speed` parameter (e.g. 1.15–1.25), (2) prompt Claude to produce slightly shorter DE text, (3) combination of both. Will test in Week 1 calibration.

---

### 2026-05-10 — NO_DUBBING_API

Context: Considered using ElevenLabs Dubbing API for end-to-end localization.

Decision: Use ElevenLabs TTS API directly, NOT Dubbing API.

Rationale: Dubbing API uses "Fixed Generation" which speeds up audio to fit original timing. Produces artificial fast-paced voice unacceptable for meditative content. TTS API gives natural pace, full control.

---

### 2026-05-10 — HYBRID_ARCHITECTURE

Context: Need to balance pipeline complexity with quality control.

Decision: Custom pipeline using TTS API + Claude translation + cascade timing. n8n orchestrates.

Rationale: ElevenLabs Studio UI is too slow manually. ElevenLabs Dubbing auto is too fast/unnatural. Custom pipeline with our prompts and our timing gives quality + speed.

---

### 2026-05-10 — SEPARATE_DOCS

Context: Where to store brand voice vs language-specific translation rules.

Decision: Two docs — tone_of_voice.md (brand personality, all languages) and localization_rules.md (per-language technical rules: formality, variant).

Rationale: Different concerns, different authors. ToV by marketing/brand. Localization by translators. Mixing makes both harder to maintain.

---

### 2026-05-10 — INFORMAL_ADDRESS_ALL_LANGS

Context: Need consistent address style across 7 languages.

Decision: Always informal address (du, tu, ty, sen). Consistent across entire piece — never switch.

Rationale: Listener is personal companion, not stranger. Switching mid-translation breaks intimacy.

---

### 2026-05-10 — EUROPEAN_PORTUGUESE

Context: Portuguese has Brazilian and European variants.

Decision: European Portuguese (Portugal), not Brazilian.

Rationale: Brand decision per market focus.

---

### 2026-05-10 — CASCADE_TIMING_PRINCIPLE

Context: How to handle timing differences between EN and target language audio.

Decision: Each language has its own timeline. Localized audio does NOT match EN word-by-word. Segments positioned via cascade: `position[i] = max(EN_start[i], position[i-1] + real_duration[i-1] + min_gap)`.

Rationale: Forcing EN timing requires speeding up audio (artificial) or cutting content. Cascade preserves natural pace while bounding drift to next pause in EN.

---

### 2026-05-10 — SEGMENTATION_STRATEGY

Context: How to split long videos for translation + TTS.

Decision: Sentence-level segmentation using ElevenLabs Scribe word-level timestamps. Break on punctuation, pauses >0.6s, or max 15s. Minimum 2s (merge if shorter).

Rationale: Fixed-duration cuts break sentences mid-thought, hurt translation quality. Natural breaks align with breathing rhythm.

---

### 2026-05-10 — MOVEMENT_SEGMENTS_FUTURE_PROOFING

Context: Current content (sleep meditation) has no movement instructions, but future courses (yoga, kundalini) will. Want architecture to support without rework.

Decision: Build "movement-aware" scaffolding from day 1, even if unused for current content. Tone Analysis always tags segment_type. Synthesize workflow has if-branch for movement segments routing to adaptation logic. Adaptation prompt exists but isn't triggered until movement-tagged segments appear.

Rationale: Adding the branch later means refactoring schema, prompts, workflow nodes — multi-day work. Building scaffolding now is hours, saves weeks later.

---

### 2026-05-10 — TRANSLATE_WORKFLOW_ARCHITECTURE

Context: Workflow_Translate — вибір між N×7 Claude calls vs N calls з JSON output.

Decision: Один Claude call на сегмент повертає всі 7 перекладів як JSON об'єкт.

Rationale: 56 паралельних calls → rate limit 429. 8 calls → стабільно. Claude добре тримає JSON output для 7 мов одночасно.

---

### 2026-05-10 — QUOTE_SANITIZATION

Context: en_text з подвійними лапками ламав JSON response від Claude.

Decision: Заміна " → ' в en_text перед відправкою в Claude (в Prepare and Expand).

Rationale: Лапки в тексті виходять escaped в JSON і ламають parse. Одинарні лапки семантично еквівалентні для медитативного контенту.

---

### 2026-05-10 — SYNTHESIZE_WORKFLOW_ARCHITECTURE

Context: Workflow_Synthesize — як обробляти 56 TTS calls (8 сегментів × 7 мов).

Decision: Loop Over Items з batch size 1 + 3s wait між calls. MP3 зберігаються в Google Drive з назвою {segment_id}_{lang}.mp3 в папці audio/sleep_001/.

Rationale: Паралельні calls → "Multiple voice additions/deletions" error від ElevenLabs. Sequential з паузою — стабільно. Google Drive замість локальної папки бо n8n в хмарі.

---

### 2026-05-10 — AUDIO_FILE_NAMING

Context: Конвенція назв для MP3 файлів.

Decision: {segment_id}_{lang}.mp3 — наприклад seg_001_de.mp3. Папка: audio/{lesson_id}/ в Google Drive.

Rationale: Легко парсити назву назад в segment_id і lang для RPP генерації в Week 2.

---

### 2026-05-10 — DRIVE_OVERWRITE_NOT_SUPPORTED

Context: Google Drive Upload нода в n8n не має "overwrite if exists" опції.

Decision: Перед повторним запуском Synthesize — вручну видаляти папку sleep_001 і створювати заново. В Week 4 додати автоматичний Search → Delete → Upload.

Rationale: Прийнятно для поточного обсягу (8 сегментів). Для production потрібен upsert.
