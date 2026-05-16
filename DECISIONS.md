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

---

### 2026-05-10 — SEGMENTATION_SENTENCE_BOUNDARY

Context: Перша версія сегментації різала по часу (15s) незалежно від меж речень. Сегменти починались з середини речення — неприйнятно для дублінгу.

Decision: Різати ТІЛЬКИ на кінці речень (. ! ?). Hard cap 25s як запасний варіант для аномально довгих речень.

Rationale: TTS кліп що починається з середини речення звучить неприродньо навіть якщо стикується з попереднім. Межі речень — єдиний правильний спосіб сегментації для дублінгу.

---

### 2026-05-10 — INGEST_WORKFLOW_ARCHITECTURE

Context: Workflow_Ingest — як отримати сегменти з аудіофайлу.

Decision: Аудіо зберігається в Google Drive (input/sleep_001/). Workflow завантажує файл, відправляє в Scribe з word-level timestamps, сегментує по реченнях, записує в Sheet з en_start/en_end/en_duration.

Rationale: Drive як джерело — бо n8n в хмарі не має доступу до локального Mac. Word-level timestamps від Scribe дають точні паузи для сегментації.

---

### 2026-05-12 — CASCADE_LOGIC_VALIDATED

Context: Реалізували Cascade Positioning Code Node для розрахунку position_start_sec/position_end_sec кожного сегменту на основі real_duration_sec і en_start_sec. Початкова версія мала баг — застосовувала MIN_GAP до першого сегменту мови, зміщуючи його на 0.4с пізніше.

Decision: Виправлено через ініціалізацію prevEnd = null (замість 0) з умовним handling: перший сегмент стартує на en_start, наступні через max(en_start, prevEnd + MIN_GAP). Логіка валідована на mock-даних: DE (+30% довша) дає очікуваний drift, ES (коротша) має drift=0 бо вкладається в EN-тайми. Тестовий workflow збережений у workflows/cascade_test.json і код у code_nodes/cascade_positioning.js.

Rationale: Mock-test з очікуваними числами знайшов баг до production. Без цього перший сегмент кожної мови почав би на 0.4с пізніше — дрібниця але неправильно. Підтверджує цінність test-first для математичної логіки. Drift не накопичується там де мова вкладається в EN-тайми (між довгими паузами cascade ресетиться).

---

### 2026-05-16 — STRICT_TIMING_OVER_CASCADE

Context: Раніше план використовував cascade-positioning — кожна мова мала свій таймлайн з допустимим дрейфом від EN. Це працювало для медитативного контенту але вимагало Reaper для візуальної QA-інтеграції.

Decision: Перейти на strict EN-таймінг. Кожен seg_NNN_lang.mp3 = exactly en_duration_sec. Складається з: TTS audio + silence padding (або після adaptation для скорочення). Жоден сегмент не виходить за свій EN-слот.

Rationale: Без Reaper-інтеграції cascade ускладнював без вигоди. Strict timing означає що конкатенація всіх per-lang файлів = повний урок з EN-таймлайном, готовий до завантаження в будь-який DAW або апку. QA стає простішою — слухаєш окремі файли, регенеруєш проблемні через atomic workflow.

---

### 2026-05-16 — DROP_REAPER_INTEGRATION

Context: Week 2-3 оригінального плану — Reaper RPP generation і ReaScript hotkey workflow.

Decision: Викидаємо повністю. Замість Reaper — Drive folder з готовими аудіо файлами. QA через прослуховування у будь-якому плеєрі/DAW. Регенерація через окремий webhook workflow.

Rationale: Reaper-інтеграція — додаткова технологія (ReaScript Lua) яку треба підтримувати. Для меди-контенту де лиц не видно, точна візуалізація таймлайну не критична. Drive + simple regenerate покриває 95% use case з 10% складності.

---

### 2026-05-16 — ADAPTATION_LOOP_IN_TRANSLATE

Context: Локалізовані переклади часто довші за EN (DE +20-30%). При strict timing це блокер.

Decision: У Workflow_Translate після першого перекладу — loop з до 3 спроб адаптації. Кожна спроба — більш агресивне скорочення через окремий Claude-промпт. Estimate duration через символи / CPS. Записувати adaptation_attempts і final length у Sheet.

Rationale: Краще скорочувати текст програмно ніж покладатись на ручне виправлення. ToV-контекст у промпті адаптації забезпечує що скорочення не ламає тон. Якщо після 3 спроб все ще не влазить — fallback на speed adjustment у Synthesize.

---

### 2026-05-16 — SPEED_ADJUSTMENT_AS_FALLBACK

Context: Іноді навіть після max adaptation переклад не влазить у en_duration.

Decision: У Synthesize використовувати ElevenLabs speed parameter як fallback. Послідовність: speed=1.0 → 1.10 → 1.15. Якщо і 1.15 не вистачає — flag needs_attention=true і зберегти як є (буде довшим за слот).

Rationale: ±15% швидкості ElevenLabs дає натуральний звук. Більше — починає звучати штучно. Краще флагнути і дати людині ручне рішення, ніж генерувати неякісне аудіо.

---

### 2026-05-16 — OUTPUT_FORMAT_PER_SEGMENT_FILES

Context: Як саме доставляти готовий дубляж.

Decision: Per-segment mp3 файли у Drive: output/{lesson_id}/{lang}/seg_NNN_{lang}.mp3. Кожен файл = silence_before + TTS + silence_after (за потреби) = en_duration_sec. Концепція: користувач може завантажити всі файли в DAW і вони ляжуть на правильні позиції просто за послідовністю.

Rationale: Не залежить від конкретного DAW. Простий у консумації — апка може завантажити окремі сегменти і програти їх з паузами. Регенерація однієї проблемної ділянки — заміна одного файлу.

---

### 2026-05-16 — DAY1_VERIFICATION_COMPLETE

Context: Day 1 cleanup і verify перед переходом до Tone Analysis (Day 2-3).

Decision: Всі пункти закриті. Підсумок:
- Workflow_Synthesize v2: каскадні ноди (Aggregate, Get Localizations Fresh, Cascade Positioning, Save Positions to Sheet) видалені. Workflow експортований у `workflows/synthesize_v2_post_cleanup.json`.
- Workflow_Translate: ToV підключений коректно — читає з config sheet по ключу `tone_of_voice` через "Read Config" ноду. Виправлень не потрібно.
- Sheet segments: en_duration_sec заповнений для всіх 9 сегментів sleep_001, значення коректні.
- Sheet localizations: очищено від тестових даних.

Rationale: Day 2 можна починати з чистого стану. Жодних open issues не виявлено.

---

### 2026-05-16 — ADAPTATION_LOOP_IMPLEMENTATION

Context: Days 4-5 — реалізація adaptation loop для скорочення перекладів що не влазять у EN timing budget.

Decision: Реалізовано як "Adapt Translations" Code node у W2_Translate_v2. Вставлений між "Extract Translations" і "Update Sheet". Estimates duration через `chars / LANG_CPS[lang]` (константи per-language). Якщо estimated > en_duration * 1.05 — до 3 спроб адаптації через `this.helpers.httpRequest` (не окрема HTTP нода). Виводить `{lang}_text` (final) і `{lang}_adaptation_attempts` (0 якщо адаптація не потрібна).

CPS константи: de=13, es=17, fr=15, pl=14, pt=16, it=16, tr=14.

Rationale: Один self-contained Code node замість трьох окремих нод (estimate → IF → Claude → loop back) спрощує граф. `helpers.httpRequest` дозволяє async loop в межах однієї ноди без n8n loop workarounds. Per-language tracking дає прозорість яка саме мова потребувала адаптації.

---

### 2026-05-16 — SYNTHESIZE_PCM_NO_FFPROBE

Context: Days 6-7 — реалізація Synthesize з strict timing. Потрібно вимірювати реальну тривалість TTS-аудіо без ffprobe (n8n cloud не має доступу до системних команд).

Decision: Запитувати TTS у форматі `pcm_22050` (raw PCM, 22050Hz mono 16-bit). Тривалість = `bytes.length / (22050 × 2)`. Silence padding = `Buffer.alloc(padBytes, 0)` в Code node. WAV будується вручну (44-byte header + PCM). Результат — `.wav` файл у Drive замість `.mp3`.

Rationale: PCM формат дає точне вимірювання тривалості без зовнішніх інструментів. `Buffer` доступний у n8n Code nodes (Node.js runtime). WAV header — детерміністичний і тривіальний для побудови вручну. `.wav` прийнятний для DAW та аудіоплеєрів. Альтернатива (mp3 + оцінка за розміром файлу) неточна через VBR/CBR варіацію. (estimate → IF → Claude → loop back) спрощує граф. `helpers.httpRequest` дозволяє async loop в межах однієї ноди без n8n loop workarounds. Per-language tracking дає прозорість яка саме мова потребувала адаптації.
