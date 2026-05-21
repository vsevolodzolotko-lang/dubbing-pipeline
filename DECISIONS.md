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

Rationale: PCM формат дає точне вимірювання тривалості без зовнішніх інструментів. `Buffer` доступний у n8n Code nodes (Node.js runtime). WAV header — детерміністичний і тривіальний для побудови вручну. `.wav` прийнятний для DAW та аудіоплеєрів. Альтернатива (mp3 + оцінка за розміром файлу) неточна через VBR/CBR варіацію.

---

### 2026-05-16 — SLOT_TIMELINE_EACH_SEGMENT_OWNS_LEAD_SILENCE

Context: Перший прогін Synthesize виявив що сума всіх localized сегментів не дорівнює тривалості оригінального EN-аудіо. Зокрема: pause перед першим словом (lead silence на початку lesson) і paused між сегментами не потрапляли в жоден файл — концатенація з'їжджала по часу.

Decision: Кожен сегмент-файл "володіє" silence-проміжком ПЕРЕД своїми словами. Формат файлу: `[lead_silence_sec of zeros] + [exactly en_duration_sec of audio]`. Де `lead_silence_sec = en_start_sec - prev_en_end_sec` (або просто `en_start_sec` для першого сегменту). Це гарантує що concat файлів end-to-end відтворює оригінальний EN-таймлайн до `en_end_sec` останнього сегменту.

Також додано **hard truncate**: якщо після Claude adapt + speed 1.10 + 1.15 переклад все ще не влазить — обрізаємо PCM до `en_duration_sec` (може обрізати посередині слова) і ставимо `needs_attention=true` для ручного перегляду.

Rationale: Без lead silence файли тільки локально влазять у свої en_duration_sec, але концатенація не реконструює оригінальний таймлайн. Захоплення pauses ПЕРЕД сегментом (а не ПІСЛЯ) — натуральніше: pause "належить" наступному сегменту як "вдих перед фразою". Hard truncate — компроміс strict timing: краще різке зрізання з needs_attention flag для review ніж тихе зсунення. Альтернатива — додаткові speed steps 1.20/1.25 — звучить штучно для медитативного контенту.

---

### 2026-05-16 — MIN_GAP_VIA_PREV_AUDIO_STEAL

Context: При першому повному прогоні sleep_001 деякі сегменти EN мають натуральну паузу < 0.4с до наступного — голос дубляжу звучить наче два сегменти злипаються (різко обривається кінець попереднього і одразу починається наступний). Потрібен мінімум 0.4с пауза між дубльованими словами, але суму дубляжу хочеться зберегти = EN.

Decision: Структура файлу тепер `[lead_silence] + [tts_budget audio] + [trailing_silence]`, де загальна довжина дорівнює `lead_silence + en_duration_sec` (slot size, як було). MIN_GAP досягається через **"крадіжку" часу** з аудіо-бюджету попереднього сегменту: якщо `natural_gap_after_i < MIN_GAP`, то `tts_budget_i = en_duration_sec_i - (MIN_GAP - natural_gap)` і ця різниця стає `trailing_silence_i`. W2/W3 адаптація тексту відштовхується від `tts_budget_sec` (а не `en_duration_sec`) — Claude скорочує текст до меншого бюджету, замість того щоб speed-up.

MIN_GAP конфігурується через `config.min_inter_segment_gap_sec` (default 0.4). Sanity guard: `tts_budget` не падає нижче 50% від `en_duration` навіть якщо MIN_GAP вимагав би більше.

Rationale: User-вибір серед трьох варіантів (extend timeline / steal from prev / steal from curr). "Steal from prev" зберігає total=EN, дає natural-sounding pause, і використовує існуючий W2/W3 adapt-flow для скорочення тексту замість штучного прискорення. Pause "після слів попереднього сегменту" звучить як кінець думки — природніший ніж пауза в середині нового сегменту.

---

### 2026-05-16 — DIAGNOSTIC_COLUMNS_FOR_ALIGNMENT

Context: Користувач спостерігає що неперші сегменти стартують зі словами на ~0.25с раніше ніж EN, і сумарна тривалість дубляжу на ~0.25с коротша за EN. Експлорація коду підтвердила що математика slot'ів коректна — причина має бути в даних (Scribe word timestamps або TTS lead silence).

Decision: Додати в localizations sheet 4 діагностичні колонки: `slot_start_sec`, `slot_end_sec`, `tts_budget_sec`, `trailing_silence_sec`. Після прогону user порівнює `slot_end_sec` останнього сегменту з `en_end_sec` (мають збігатись), і `lead_silence_sec` з `en_start_sec - slot_start_sec` (мають збігатись). Розбіжності точково покажуть звідки -0.25с.

Rationale: Перед тим як додавати compensation hack (extra_lead_silence_sec) або silence trim в TTS-аудіо — потрібно зрозуміти ROOT CAUSE. Debug колонки дешеві, не змінюють поведінку pipeline, і дають конкретні числа для діагностики.

---

### 2026-05-16 — ADAPTATION_PROMPT_PRESERVE_CONCEPTS + LENGTH_FLOOR

Context: Реальний прогон sleep_001 виявив сильне over-shortening DE seg_001: "No extra tools are required, only your own fingertips" → "Du brauchst nur deine Fingerspitzen". Концепт "no extra tools" (важливе акцентування доступності практики без обладнання) повністю зник. Інші мови дали повний переклад. Причина: Claude в W2 Adapt Translations і/або W3 Claude re-adapt інтерпретував "no extra tools" і "only fingertips" як дублюючі і викинув першу частину.

Decision:
1. **Prompt explicit rules**: системний промпт тепер містить чіткі правила що зберігати — кожен distinct concept з EN-оригіналу, негації ("no", "not", "without", "never"), контрасти ("A, not B"), власні назви/числа.
2. **EN reference у W3 re-adapt**: раніше W3's claudeAdapt бачив лише поточний переклад. Тепер передається en_text як reference — Claude бачить що саме треба зберегти.
3. **Length floor MIN_RETAIN = 0.6**: якщо Claude повертає текст коротший за 60% від input, результат відкидається і залишається попередній (довший) текст. Sanity guard від aggressive shortening.

Rationale: Без EN reference Claude не знає що "fingertips" і "no extra tools" — це два РІЗНІ concept (один про мінімалізм/доступність, інший про конкретний інструмент). Length floor — захист від edge cases де навіть з кращим промптом Claude вибирає над-агресивний шлях. 60% — компроміс: дозволяє зменшити на 40% (відрізати реальні fillers) але не дозволяє drop концептів.

---

### 2026-05-16 — NEEDS_ATTENTION_ONLY_ON_REAL_OVERFLOW

Context: Прогон sleep_001 показав 14 рядків з needs_attention=TRUE з 49. Аналіз CSV: більшість FALSE positives — обрізання було <0.2с (нечутно). Приклади: seg_002 fr (0.10с trim), seg_001 tr (0.099с trim), seg_002 es (0.05с trim). User не міг зрозуміти чому так багато прапорів.

Decision: needs_attention тепер TRUE тільки якщо `real_duration > tts_budget × 1.05` ПІСЛЯ всіх спроб (Claude adapt + speed 1.10 + 1.15). Це означає що жодна стратегія не дозволила влізти в бюджет, і hard-truncate реально обрізав чутну частину аудіо.

Rationale: BUDGET_FACTOR=1.05 вже використовується в speed-retry loop як толерантність. Логічно поширити її і на truncation flag. Дрібні обрізання <5% не потребують ручного перегляду — вони косметичні. Це робить needs_attention реальним сигналом проблемних сегментів замість шуму.

---

### 2026-05-16 — SPEED_AS_LAST_RESORT

Context: Раніше Synthesize використовував speed=1.10/1.15 як основний механізм коли переклад не вміщувався. Це часто спрацьовувало навіть коли можна було ще скоротити текст. Поточний W3 chain був: Claude re-adapt (1 attempt) → speed 1.10 → speed 1.15 → hard truncate. Speed запускалась після всього однієї adapt-спроби.

Decision: Розширити Claude re-adapt у Synthesize до **3 attempts** (light → medium → max) перед будь-якою зміною швидкості. Фінальна послідовність: adapt light → adapt medium → adapt max → THEN speed 1.10 → speed 1.15 → needs_attention=true з hard truncate. Між кожною adapt спробою — re-TTS at speed 1.0 і re-check vs effective_slot.

Conflict with prior decisions: уточнює SPEED_ADJUSTMENT_AS_FALLBACK (2026-05-10) і ADAPTATION_PROMPT_PRESERVE_CONCEPTS (2026-05-16). Speed залишається fallback, але тепер формально остання можливість після вичерпання усіх текстових варіантів.

Rationale: Зміна швидкості голосу навіть в межах +15% погіршує natural feel меди-аудіо (фоновий ритм дихання, що настроюється під оригінальний темп). Краще ще раз скоротити текст ніж змінити темп. Three-tier adapt дозволяє Claude послідовно йти від light (filler-removal) до max (compress to core meaning) — у переважній більшості випадків переклад вміщується в effective_slot до того як знадобиться speed.

---

### 2026-05-16 — BREATH_BORROW_MECHANISM

Context: Мікросегменти типу breath instructions ("in", "out") можуть бути довшими в інших мовах ("atme ein", "atme aus"). Strict-timing v2 форсує ці сегменти у тісний слот навіть коли сусідні сегменти мають 1–2с тиші. Реальний прогон показав: коли natural gap після сегменту > 0.4с, є природний "запас" що можна використати, але v2 його не використовує.

Decision: Дозволити сегменту "позичити" частину наступного gap'у. Формула:
- `gap_after = next.en_start_sec − this.en_end_sec`
- `max_borrowable = max(0, min(gap_after − min_inter_segment_gap_sec, max_borrow_per_segment_sec))`
- `effective_slot = en_duration_sec + max_borrowable`

Якщо `real_duration > en_duration` але `real_duration ≤ effective_slot` — accept TTS as-is без padding/trim, записати `borrowed_sec = real − en_duration` у Sheet.

**Reuse existing config key**: `min_inter_segment_gap_sec` (default 0.4) виконує роль "буфера", який ВЖЕ використовується у MIN_GAP_VIA_PREV_AUDIO_STEAL. Це уніфікує симетричну математику: signed_adjustment = gap_after − min_inter_segment_gap_sec, clamped зверху на `max_borrow_per_segment_sec`. Negative signed → steal-from-prev (existing); positive → borrow-from-next (new). Новий конфіг-ключ `borrow_gap_buffer_sec` НЕ вводимо — це дублювання.

New config key: `max_borrow_per_segment_sec` (default 2.0) — верхня межа щоб мікросегмент не з'їв увесь gap.

Conflict with prior decisions: доповнює MIN_GAP_VIA_PREV_AUDIO_STEAL (2026-05-16) — обидва механізми тепер симетричні. Steal працює коли gap_after < MIN_GAP; borrow коли gap_after > MIN_GAP. Файл-структура `[lead_silence] + [TTS] + [tail_silence]` залишається, але `tail_silence` може бути 0 при breath-borrow (TTS заповнив весь slot + позичений час).

Rationale: Меди-контент часто має природні паузи між інструкціями (дихання, перехід між фазами). Жорстко тримати ці паузи коли локалізований переклад природньо довший — погіршує якість TTS (треба скорочувати або прискорювати). Borrow механізм використовує наявну структуру EN-аудіо: якщо там була тиша, нехай локалізована мова "видихне" в неї. Користувач не помітить різницю — паузи в меди-аудіо здебільшого взаємозамінні в межах одного gap'у.

---

### 2026-05-16 — TRANSLATION_EXPANSION_IN_SYNTHESIZE

Context: Adaptation у Translate (W2) іноді надто агресивно скорочує. У Sheet localizations бачимо ratio `real_duration / en_duration` 0.58–0.85 для деяких сегментів (DE seg_001: 0.53). Це дає 1.5–3с неприродної padding-тиші. Length floor MIN_RETAIN=0.6 (ADAPTATION_PROMPT_PRESERVE_CONCEPTS) допомагає тільки коли Claude шортить нижче порогу — а тут проблема в тому що Claude під W2 CPS-estimate не врахував що реальне TTS буде ще коротше за оцінку.

Decision: Додати **expansion loop** у Synthesize. Тригер: після початкового TTS at 1.0 і fit-check, якщо `real_duration < en_duration × expansion_threshold` (default 0.85) → single-segment Claude call який розширює переклад, відштовхуючись від EN reference. Макс 2 attempts. Якщо нова версія overshoots `effective_slot` → revert до попередньої коротшої. Записати `expansion_attempts` у Sheet.

New config key: `expansion_threshold` (default 0.85).

Conflict with prior decisions: симетрія до ADAPTATION_PROMPT_PRESERVE_CONCEPTS. Раніше тільки скорочували; тепер відновлюємо що було передcorocheno. Не порушує length-floor: expansion дає БІЛЬШИЙ текст, не менший.

Rationale: Expansion рішення приймається на real_duration (точно, після TTS), а не на CPS-estimated (приблизно). Це усуває fundamental помилку W2: CPS — це усереднена швидкість, реальний TTS може бути на 20% швидший/повільніший в залежності від речення. Single-segment expand дешевий (1 Claude call), revert-on-overshoot захищає від snowball-ефекту. Тримається ToV через явну референцію у промпті. У 90% випадків дає природніший результат ніж довга padding-тиша.

---

### 2026-05-16 — SILENCE_DISTRIBUTION_20_80

Context: У v2 вся padding-тиша йшла в `trailing_silence` (тобто після TTS). Це звучить як "обірване речення" коли padding значна (>1с) — слухач сприймає що сегмент закінчився посередині думки, бо одразу після останнього складу — тиша.

Decision: Розподіл padding'у: **20% перед TTS** (lead), **80% після** (tail). Конфігурується через `silence_lead_ratio` (default 0.2).

**Exception для збереження timeline alignment**: якщо у сегменту вже є natural EN gap (`lead_silence_sec` з prev's en_end до this en_start) > 0 — використати його ПОВНІСТЮ як lead, а всю padding-тишу класти в tail. Це гарантує що слова локалізації стартують у тому ж часі що й EN-слова. Якщо EN gap = 0 (back-to-back сегменти), тоді розподіл 20/80 застосовується до повної padding (трохи зсуває слова назад, але це OK бо альтернативи alignment немає).

Conflict with prior decisions: переписує неявне правило з SLOT_TIMELINE_EACH_SEGMENT_OWNS_LEAD_SILENCE (2026-05-16) — там лише EN gap йшов у lead. Тепер дозволено додавати ще padding до lead якщо EN gap = 0. Також впливає на сенс колонки `lead_silence_sec` — раніше це строго EN gap, тепер може включати додаткові 20% padding.

Rationale: Початкова тиша (перед TTS) природня — наратор приготовлюється, робить вдих. Кінцева — дихальний простір після фрази. 80% на кінець бо людина більше переносить тишу в кінці фрази ніж на початку (gestalt closure: завершення думки). 20% lead додає природність уже коротких сегментів типу "in" / "out" — без цього вони звучать як "вистрелили" словом одразу після попереднього сегменту.

---

### 2026-05-17 — DRIFT_FIX_BRANCH_ON_EN_DURATION

Context: Перший прогон Synthesize v3 на sleep_001 виявив систематичний дрифт. У localizations 10 рядків мали `borrowed_sec` НЕГАТИВНИМ (від −0.009 до −0.255), що означало "файл коротший за слот" — пряма ознака дрифту. Сумарна тривалість дубляжу на 0.125–0.353с коротша за EN total залежно від мови. Для 12-хвилинного уроку це проектувалось у ~4с дрифт для DE.

Корінь: гілкування у `Check Timing + Pad` йшло по `realDur > tts_budget_sec`, а має йти по `realDur > en_duration_sec`. Steal-сценарій (де `tts_budget < en_duration`) хибно потрапляв у borrow-гілку, отримував від'ємний `borrowed_sec` і файл виходив коротшим за слот.

Decision: Гілкування тепер по `real ≤ en_duration_sec`. У pad-гілці завжди file = `naturalLead + en_duration_sec` (стала довжина слоту незалежно від `real`). Trail_steal перестав бути окремою змінною в padding-обчисленні — він вже включений в `en_duration - real` природньо. Borrow-гілка спрацьовує лише коли `real > en_duration` (реальний overrun) і завжди `borrowed_sec ≥ 0`.

Також виправлено side-bug: у W3 shorten-loop Claude інколи над-агресивно скорочував (pt_seg_001: 4.48с → 3.11с). Додано explicit floor `targetCharsLow = floor(targetChars × 0.85)` у промпт + code-side reject. Зняв guard `shortenRetries === 0` з expansion loop — тепер expansion може відновлювати над-скорочений текст незалежно від того чи shorten перед тим спрацював.

Rationale: Drift у piped'і це не "feature, accept it" — це баг, що пропорційно росте з довжиною уроку. Branch на `en_duration` робить структуру файлу деtermined: для будь-якого `real ≤ enDur` файл = naturalLead + enDur. Borrow стає семантично коректним (тільки коли є overrun у фактичну тишу EN). Single-segment shorten + expansion разом утворюють Goldilocks-loop, що знаходить правильну довжину навіть коли Claude промахується в одну зі сторін.

---

### 2026-05-17 — COST_OPTIMIZATIONS_W3 + STRICT_DRIFT_CAP

Context: Прогон W3 з'їдав ~$0.39 за один урок sleep_001 (8 сегментів × 7 мов). Аналіз показав ~180 API calls/прогон: 49 initial TTS + ~53 shorten attempts (Claude + re-TTS) + ~17 speed retries + ~4 expansion attempts. Друга проблема — IT мова мала залишковий positive drift +0.454с через `slot * 1.05` tolerance у steal-сценарії (де borrow недоступний).

Decision: Кілька оптимізацій разом:

1. **Claude → Haiku для W3 shorten/expand**: модель змінена на `claude-haiku-4-5-20251001`. Задачі (скоротити/розширити з збереженням concepts) прості — Sonnet overkill. ~4× дешевше per token. W2 Adapt Translations і Tone Analysis залишаються на Sonnet (тон-критичні).

2. **Prompt caching з ephemeral TTL (5 хв)**: системний промпт у shorten/expand розбитий на static + dynamic частини, static markнут `cache_control: {type: ephemeral}`. ToV входить в static (часто 1000+ tokens). Cache TTL рефрешиться на кожному hit'і, тож для tightly-packed loop'у W3 кеш залишається теплим протягом усього прогону (навіть для довгих уроків). 1-hour TTL не вмикали — у нашому випадку beneficial gain marginal.

3. **LANG_CPS retune за реальними даними**: з prog2 даних чарактерна швидкість TTS була нижча за оцінки v1: DE 13→12, ES 17→15, IT 16→14. Це дає W2 кращу estimate і зменшує false-positive triggers у W3.

4. **expansion_threshold default 0.85 → 0.75**: експансія fired для real/en_duration ratio 0.75–0.85, де padding-тиша звучала прийнятно. Зменшує expansion calls без помітного якісного програшу.

5. **STRICT_DRIFT_CAP**: уведено `maxAllowed = maxBorrowable > 0 ? slot * 1.05 : enDur`. У steal-сценарії (no borrow available) audio truncates строго на `en_duration` замість `slot * 1.05`. Це усуває +0.454с дрифт IT з prog2. Hard truncate з needs_attention flag для ручного review.

Conflict with prior decisions:
- SPEED_ADJUSTMENT_AS_FALLBACK (2026-05-10) — speed loop ціль тепер `maxAllowed` замість `slot * 1.05`.
- NEEDS_ATTENTION_ONLY_ON_REAL_OVERFLOW (2026-05-16) — поріг для needs_attention тепер строгіший у steal-сценарії.
- ADAPTATION_PROMPT_PRESERVE_CONCEPTS (2026-05-16) — Sonnet → Haiku для W3 single-segment ops. W2 multi-lang adapt залишається на Sonnet.

Rationale: Економія — це не цілком про "менше API calls", а про **дешевше за виклик**. Haiku 4.5 справляється з "скороти зі збереженням concepts" майже як Sonnet (задача добре формалізована у промпті, не вимагає глибокого reasoning). Caching робить input tokens у 10× дешевшими після першого виклику. CPS-tune перерозподіляє роботу: W2 (one call per segment-bulk) робить більше — W3 (per segment×lang) фіриться менше. Strict drift cap прибирає накопичувальну похибку, яка для 12-хв уроку давала би ~5с зсуву.

Очікувана економія: $0.39 → ~$0.10–0.15 per W3 run.

---

### 2026-05-17 — SANITIZE_CLAUDE_OUTPUT

Context: Перший прогон з Haiku 4.5 виявив контамінацію: у стресових випадках (shorten_retries=3, max attempt) Haiku включала свої метакоментарі в payload разом з перекладом. Приклади з sleep_001 run 3:
- es_seg_001: "Solo necesitas las yemas de tus dedos.\n\n(57 characters — within target range)"
- tr_seg_002: "EFT...kullanır.\n\n(Character count: 95 characters — within range)"
- pl_seg_003: дві версії перекладу з reasoning'ом між ними ("Wait — this falls below minimum. Let me adjust:")

Ці рядки повністю проникали: записувались у localizations.text_translated І озвучувались TTS'ом у фінальний WAV (включно з "(57 characters — within target range)" в аудіо). Наш length-check `result.length >= floorChars` не виявляв контамінацію — навпаки, додаткові символи робили текст "достатньо довгим".

Decision: Дві комплементарні міри:

1. **Sanitizer `sanitizeClaudeOutput`** після кожного Claude-виклику в W2 Adapt Translations і W3 Check Timing + Pad:
   - Обрізає все після першого `\n\n` (Haiku використовує double-newline як роздільник між основною відповіддю і коментарем)
   - Видаляє leading/trailing markdown emphasis (`*`, `**`, `__`)
   - Видаляє surrounding quotes

2. **Жорсткіші OUTPUT-правила в промптах**:
   - Список явних заборон: no character counts, no reasoning words ("Wait", "Let me", "Actually"), no markdown, no multiple drafts, no blank lines
   - Framing: "any violation will cause your reply to be rejected and re-tried" (стимулює виправлення)

Rationale: Sanitizer — код-side defense in depth: навіть якщо Claude ігнорує промпт, ми не записуємо контамінований текст. Prompt rules — first line of defense. Не повертаємось до Sonnet, бо вартість того не варта: sanitizer + tighter rules мають закрити >95% випадків. Якщо наступний прогон покаже залишкову контамінацію — fallback на Sonnet для shorten/expand.

Side effect: коли Haiku виводить дві версії з reasoning'ом між (як pl_seg_003), sanitizer бере ПЕРШУ. Якщо вона коротша за floorChars — наш існуючий length-check її reject'нув, повертає original input. Goldilocks-loop через shorten+expansion в наступних ітераціях знайде правильний баланс.

---

### 2026-05-17 — MILESTONE: sleep_001 baseline зелений

Context: Sleep_001 run 4 (post sanitizer + Haiku + caching + strict drift cap + CPS retune) дав чисту картину для всіх 49 рядків × 7 мов.

Зведення метрик:
- **Drift**: 0/49 рядків. Сума `final_duration_sec` для кожної мови = `en_end_sec` останнього сегменту (64.119с) точно.
- **Контамінація** (метакоментарі від Haiku в payload): 0/49. Sanitizer + жорсткіші OUTPUT-правила закрили клас.
- **needs_attention**: 0/49. Жоден сегмент не потребує ручного перегляду.
- **Експансія fired**: 2/49 (seg_001_fr відновив "supplémentaire", seg_003_es відновив "downregulate stress response").
- **Shorten retries**: ~30/49 (виключно нормальна робота — Haiku підтягує до бюджету).
- **Speed retries (>1.0)**: 8/49 (~16%).
- **Якість перекладу**: 95%+ концептів збережено. Дрібні втрати qualifier-слів ("significantly", "even", "Stanford-trained") у ~10% сегментів. Дві IT-проблеми з реальною concept loss (seg_005, seg_007) — задокументовано як known follow-up.

Decision: Прийнято як **production-ready baseline** для меди-контенту. Week 1 (segment-level pipeline) закрито. Якісні нюанси Haiku-адаптації не блокують — гото переходити до Week 2 (Drive trigger, atomic regenerate, multi-lesson real-world test).

Rationale: Зелені light на drift/contamination/needs_attention — три головні фундаментальні баги фіксовані. Quality issues — інкрементальні, можна тюнити промпт або робити IT-fallback на Sonnet, коли матимемо більше даних з різних уроків.

---

### 2026-05-17 — LEAD_SILENCE_CAP_FOR_LONG_TAIL_CONTENT

Context: Тестовий прогон на новому уроці з big-tail сегментами (короткі affirmation-фрази типу "I am here." з 5+с EN-тиші всередині слоту) виявив що дубльовані слова стартують на 1-1.5с пізніше за EN-слова. Приклади з sleep_001 run 5:
- seg_006 de: real=1.254с, padding=5.126с, leadSec=1.025с → слова пізніше на 1.025с
- seg_007 de: leadSec=0.978с → слова пізніше на 0.978с
- seg_008 de: leadSec=1.551с → слова пізніше на 1.551с

Причина: формула `leadSec = leadRatio × padding` (20% від padding'у) у no-natural-lead гілці працює коректно для tight microsegmentів (padding < 1с дає <0.2с lead), але для big-tail контенту (padding 5с+) дає 1с+ штучної тиші ПЕРЕД словами. EN мав слова на початку слоту + tail-тишу, наш дубляж — навпаки.

Decision: Додано hard cap на lead-силенс у no-natural-lead випадку. Формула:
```
leadSec = min(padding × silence_lead_ratio, silence_lead_max_sec)
tailSec = padding - leadSec
```

New config key: `silence_lead_max_sec` (default 0.05) — максимальна тиша перед словами коли natural EN-gap = 0. 0.05с = пів-склад breath, практично невідчутний на слух зсув. User може viставити 0 для строгого EN-alignment або більше для tight microsegmentів.

Conflict with prior decisions:
- `SILENCE_DISTRIBUTION_20_80` (2026-05-16) — soft revise. Ratio 0.2 залишається але обмежується max-cap'ом. Поведінка для маленьких padding (<0.25с) ідентична. Поведінка для big padding кардинально краща.
- `SLOT_TIMELINE_EACH_SEGMENT_OWNS_LEAD_SILENCE` (2026-05-16) — незмінне в principle. Slot-size constancy зберігається (file = naturalLead + en_duration). Просто redistribute padding всередині слоту.

Rationale: 20/80 правило базувалось на гіпотезі що "padding ~= маленьке breath room для природного звучання". Це viявилось правдою тільки для tight контенту. Для медитативного контенту з природніми тишами в EN — навпаки, штучний lead зміщує слова відносно EN-таймінгу і ламає сприйняття уроку (слухач відчуває "паузи не там"). Cap у 0.05с зберігає мінімальний акустичний transition від prev'sTTS, але не зсуває слова відчутно. Math: для типового padding=5с — old leadSec=1с, new leadSec=0.05с → 20× менший зсув.

---

### 2026-05-17 — STT_SWITCH_SCRIBE_TO_DEEPGRAM

Context: Тестовий урок з природніми довгими паузами між фразами виявив що ElevenLabs Scribe **систематично зсуває позиції слів** — drift накопичувався 0с → 7.2с до кінця уроку. Корінь: Scribe не відстежує довгі inter-segment тиші, а просто chain'ить слова. Музика не була причиною (підтверджено Phase A — drift залишався після voice-isolation).

Тестування Deepgram Nova-3 на тому ж аудіо (Phase B1):

| seg | reality | scribe en_start | scribe drift | deepgram start | deepgram drift |
|---|---|---|---|---|---|
| 001 | 0.8с | 0.839 | 0.04 | 0.88 | +0.08 |
| 002 | 9.5с | 7.319 | +2.18 | 9.36 | -0.14 |
| 005 | 26.1с | 24.399 | +1.70 | 26.3 | +0.20 |
| 006 | 40.5с | 35.199 | **+5.30** | 40.555 | +0.06 |
| 007 | 46.9с | 41.559 | +5.34 | 46.955 | +0.06 |
| 008 | 56.8с | 49.599 | +7.20 | 56.86 | +0.06 |

Deepgram точність ±0.2с на всіх сегментах vs Scribe з 7с накопичувальним дрифтом.

Decision: Замінити ElevenLabs Scribe на Deepgram Nova-3 у W1 для STT. Pipeline стає:
- W1: Download Audio (Drive) → **Deepgram STT (Nova-3 з `utterances=true`, `utt_split=1.5`)** → Segment Transcript → Write to Sheet
- W2, W3 — без змін

Реалізація:
- HTTP node POST `https://api.deepgram.com/v1/listen?model=nova-3&punctuate=true&smart_format=true&utterances=true&utt_split=1.5&language=en`
- Auth: Header Auth credential з `Authorization: Token <KEY>`
- Body: raw binary (audio file з Drive)
- Segment Transcript code тепер парсить `data.results.utterances[]` напряму — Deepgram уже сегментує по punctuation + silence, наш custom sentence-detection і "merge < 3с" логіка не потрібні.

Conflict with prior decisions:
- `INGEST_WORKFLOW_ARCHITECTURE` (2026-05-10) — Scribe був вибраний як one-vendor convenience. Тепер цей aspect не критичний. ElevenLabs залишається для TTS (де він кращий за альтернативи).
- Output schema segments sheet — без змін (en_text, en_start_sec, en_end_sec, en_duration_sec). W2/W3 не зачеплені.

Сторонній бонус: Deepgram дав більше granular сегментацію — старий sleep_001 seg_005 ("As each word arrives... You are ready.") тепер дві окремі utterances (між ними 1.2с природньої тиші). Це коректніше — кожен sentence окремий slot.

Rationale: Меди-контент має фундаментально інший audio profile від загального speech — короткі фрази з 1-5с тишами між ними. Scribe тренований на continuous speech і chain'ить слова. Deepgram Nova-3 з explicit utterance splitting розроблений саме під такі use cases. Точність ±0.2с робить timeline-aligned дубляж реально можливим без manual fix-up. Cost: ~$0.004/хв (Nova-3 base rate) ≈ $0.005 за наш 66-секундний урок — пренеброжно мало.

---

### 2026-05-17 — W1_SEGMENTATION_BY_SENTENCES_WITH_GROUPING

Context: Перший прогін W1 з Deepgram на повільному медитативному контенті (з довгими паузами) дав акуратні segments через `utterances` (silence-split). Але другий прогін на швидкому/розмовному контенті (без довгих пауз) дав лише 4 великі сегменти — користувач хоче гранулярність 1-2 речення / до ~150 символів на сегмент.

Decision: Перейти з Deepgram `utterances` на `paragraphs.paragraphs[].sentences[]` як основу сегментації:
- Sentences розбиваються Deepgram по пунктуації (більш надійно для змішаних швидкостей мовлення)
- Paragraph boundaries — природні довгі паузи (Deepgram сам визначає)
- Додано grouping логіка: послідовні речення в одному paragraph об'єднуються в один сегмент якщо:
  - сумарна довжина ≤ `MAX_CHARS = 150`
  - пауза між ними ≤ `MAX_GAP_FOR_GROUPING = 1.0с`
- Paragraph boundaries завжди закривають current segment (не групуємо через довгі паузи)

Поведінка:
- Швидкий контент → багато сегментів по 1-2 речення (групуються до 150 chars)
- Повільний меди-контент з паузами → кожне речення = окремий сегмент (paragraph boundaries і gap-перевірка не дають згрупувати)
- Дуже довгі окремі речення (>150 chars) → 1 сегмент (не ріжемо посередині речення)

Rationale: Sentences більш універсальні ніж utterances — Deepgram дає їх для будь-якого типу контенту. Char-based grouping (150) дає предсказуваний розмір сегмента для TTS budget і Claude adaptation. Gap-check зберігає природні паузи там де вони є. Без changes у W2/W3 — segments sheet contract той же.

---

### 2026-05-17 — STRICT_ALIGNMENT_DISABLE_BREATH_BORROW

Context: Прогон з Deepgram + sentence-level segmentation виявив що breath-borrow механізм (BREATH_BORROW_MECHANISM, 2026-05-16) створює inter-lang inconsistency. Один сегмент мав різну `final_duration_sec` для різних мов (ті що позичили час vs ті що не позичили). Приклад з sleep_001 run 7:

| seg_001 (slot 7.44с) | de | es | fr | pl | pt | it | tr |
|---|---|---|---|---|---|---|---|
| final_duration | 8.36 | 8.87 | 7.44 | 8.36 | 7.44 | 7.44 | 8.36 |
| borrowed_sec | 0.92 | 1.43 | 0 | 0.92 | 0 | 0 | 0.92 |

Cross-lang drift до 2.1с по сумі цілого уроку. Користувач вимагає строго consistent timing між мовами для multi-lang dubbing playback.

Decision: Вимкнути breath-borrow. У Check Timing + Pad змінити `maxAllowed`:
```
// Старе:
maxAllowed = maxBorrowable > 0 ? slot * BUDGET_FACTOR : enDur;
// Нове:
maxAllowed = enDur;  // always strict
```

Це гарантує що shorten loop, speed retry, hard truncate цілять у `en_duration` завжди. Реальне аудіо ніколи не перевищує `en_duration` → file_duration = `naturalLead + en_duration` константно для всіх мов.

Borrow-else branch у lead/tail computation залишається як defensive (set `borrowedSec=0`, flag `needs_attention=true` у rounding edge cases).

Conflict with prior decisions:
- `BREATH_BORROW_MECHANISM` (2026-05-16) — фактично revoked. Конфіг key `max_borrow_per_segment_sec` залишається у схемі для backward compat але не впливає на pipeline (dead code).

Rationale: Breath-borrow був спроектований для рідкого case'у "lang TTS overruns + adjacent gap available". На практиці він спрацьовував стихійно для 1-3 langs з 7 у тих самих сегментах, створюючи unpredictable cross-lang final_duration. Для multi-lang DAW playback (де користувач може миттєво перемикати мови) предсказуваність важливіша за гнучкість. Втрата: одна або кілька мов матимуть більш аґресивне shortening/speed замість borrow. Acceptable trade-off — обираємо alignment над breath room.

---

### 2026-05-17 — EXTEND_LAST_SEGMENT_TO_AUDIO_DURATION

Context: Deepgram повертає word-level timestamps до останнього слова. Якщо EN-аудіо має trailing silence (5+с після останніх слів), Deepgram цей хвіст не покриває — `en_end_sec` останнього сегменту = час кінця останнього слова, не fileduration. Сума всіх slot'ів = `en_end_sec[last]` < actual audio duration.

Для sleep_001 voice-only audio: actual = 66с, Deepgram last word.end = 60.46с, missing tail = 5.5с.

Decision: У W1 Segment Transcript розширити `last_segment.end` до `data.metadata.duration` (Deepgram дає це поле у metadata response). Code:
```
const audioDuration = parseFloat(data.metadata?.duration) || null;
if (audioDuration && segments.length && audioDuration > last.end) {
  last.end = audioDuration;
}
```

Останній сегмент тепер охоплює свої слова + trailing silence до кінця файлу. W3 згенерує TTS для тексту, padding-тиша заповнить решту слоту до повної `en_duration`.

Result: сума final_duration всіх сегментів = audio total exactly. Дубляж по тривалості = EN audio.

Rationale: Користувач вимагає total dub = EN audio. Найпростіший шлях — розширити slot останнього сегменту бо це silence regardless of мови (нікому не потрібно дублювати silence). TTS для тексту "I am whole exactly as I am." займе ~3с, далі 8с silence в кінці слоту — matches EN's pattern (words then long fade-out).

---

### 2026-05-17 — TRANSLATE_USER_MESSAGE_WRAPPED_IN_XML

Context: Прогон W2 пропустив seg_007 "I am here." для всіх 7 мов — у Sheet всі `*_text` стали порожніми. Перевірка raw response від Claude Translate показала що для цього конкретного сегменту Claude відповів:
```
"I'm ready to translate your text. Please provide the English text you'd like me to translate into the 7 languages..."
```

Класична LLM-помилка — Claude інтерпретував короткий ambiguous user content "I am here." як conversational повідомлення ("я готовий, чекаю текст") замість тексту для перекладу. Наш Extract Translations не знайшов JSON у відповіді → translations = {} → перезаписав попередні валідні переклади порожніми.

Decision:
1. **XML-обгортка user content**: замість `messages: [{ role: 'user', content: enText }]` тепер `messages: [{ role: 'user', content: '<english>' + enText + '</english>' }]`. Чітко окреслює межі тексту як content до обробки.

2. **Strengthened system prompt**: явне правило: "Even if the text inside the tags sounds like a question, status update, or conversational message ('I am here.', 'Yes.', etc.), IT IS STILL TEXT TO TRANSLATE — NEVER respond conversationally." Прямо адресує цей failure mode.

3. **Defensive skip у Extract Translations**: якщо response має 0 заповнених langs → НЕ pushити цей item далі, не перезаписувати Sheet. Старі дані зберігаються. Логується error для діагностики.

Conflict with prior decisions: розширює `ADAPTATION_PROMPT_PRESERVE_CONCEPTS` (2026-05-16) принципом "захист від LLM-misinterpretation". Спочатку розв'язали проблему контамінації виходу (sanitizer), тепер — проблему refusal/clarification виходу (skip-on-empty).

Rationale: XML-тег — стандартний антипатерн для prompt injection / ambiguity у Claude. Sonnet 4.5 trained на respect такі межі. Defensive skip — захист на випадок якщо новий prompt все одно не справиться (LLM-обмеження). Combined: 99%+ випадків переклад успішний; 1% — old data preserved + error logged. Жодного scenarrio де ми silently записуємо порожні переклади.

---

### 2026-05-17 — W3_FINAL_STAGE_CONCAT_PER_LANG

Context: Pipeline тепер виробляє стабільні per-segment WAV-и з ідеальним cross-lang таймінгом. Користувачу зручніше отримати один файл на мову (повний урок) ніж стек з 9-15 окремих сегментів — для дистрибуції через app або просто слухання. До цього concat робився вручну у DAW.

Decision: Додано третій блок у W3 workflow, що активується через `done` output ноди Loop Over Items після завершення всіх ітерацій per-segment генерації:

```
Loop Over Items (done) → Read Localizations Fresh → Build Full Audio Per Lang → Save Full to Drive
```

**Read Localizations Fresh** — Sheets read, забирає всі рядки з localizations (вже записані попередньою ітерацією).

**Build Full Audio Per Lang** — single Code node:
1. Групує рядки по lang
2. Для кожної мови сортує по segment_id (zero-padded sort — лексикографічно стабільний)
3. Завантажує кожен per-segment WAV через Drive API (httpRequest, OAuth token з n8n credential via `getCredentials`)
4. Зрізає 44-byte WAV header, аккумулює raw PCM
5. Загортає в новий WAV header (22050Hz mono 16-bit — той самий формат що per-segment)
6. Повертає 7 items з binary WAV, named `{lesson_id}_full_{lang}.wav`

**Save Full to Drive** — Google Drive Upload node, обробляє кожен з 7 items. `folderId` тягнеться з нового config key `drive_output_full_folder_id` (fallback на `drive_output_folder_id` якщо відсутній).

Rationale: Concat у Code node — найпростіший шлях. Drive API через `helpers.httpRequest` обходить обмеження що n8n Drive node не може напряму "join binaries". Реюз credentials з n8n (`getCredentials`) — без зайвих API keys у config. Виконується лише раз per W3 run (не loop) — мінімум API calls (1 Sheets read + 7×N Drive downloads + 7 Drive uploads, де N = кількість сегментів). Для 1-хв уроку = ~70 calls, ~10с overhead.

Edge cases:
- Якщо `audio_drive_file_id` порожнє для якогось рядка (теоретично можливо при skip-on-empty у W2) — той сегмент пропускається (немає WAV-у для concat). Full duration буде менша.
- Якщо лесон дуже довгий (>12 хв, 50+ сегментів × 7 langs = 350 файлів × ~500KB = 170MB у пам'яті) — потенційний memory ризик у n8n Code node. Для типових 1-5 хв уроків — безпечно.
- Drive folder для full files: рекомендовано окрема субпапка `full/` всередині `output/` (через `drive_output_full_folder_id`), але працює і з тим самим `drive_output_folder_id` як fallback.

**Update 2026-05-17 (kept here for traceability)**: Initial implementation used `this.getCredentials('googleDriveOAuth2Api')` inside the Code node to authenticate Drive downloads via `helpers.httpRequest`. This is **not supported in n8n Code nodes** — `this.getCredentials is not a function`. Refactored to a 3-node chain:

```
Read Localizations Fresh
  → Download Segment WAV  (n8n Drive Download, processes each row, binary out)
  → Build Full Audio Per Lang  (Code, $input.all() has N items with binaries)
  → Save Full to Drive  (Drive Upload, 7 items)
```

Drive Download handles OAuth automatically via the n8n credential. Code node only does pure JS concat. No credential lookup needed in Code.

---

### 2026-05-17 — CLEANUP_LEGACY_FILES_AND_DOCS

Context: Після того як pipeline вийшов на production-ready стан, у репо залишилося багато legacy-файлів і застарілих README з посиланнями на Reaper-інтеграцію (викинута 2026-05-16) та неіснуючі файли (`translate.json`, `synthesize.json`, `build-tts-payload.js`, etc.).

Decision: Hard delete з git:
- `workflows/W2_Translate.json` — заміщений `W2_Translate_v2.json`
- `workflows/W3_Synthesize.json` — заміщений `W3_Synthesize_v2.json`
- `workflows/cascade_test.json` — cascade-логіка викинута (`STRICT_TIMING_OVER_CASCADE`)
- `workflows/synthesize_v2_post_cleanup.json` — experimental dump
- `code_nodes/cascade_positioning.js` — cascade math, не використовується
- `scripts/spike_test.js` — ранній спайк, замінений n8n workflow
- `scripts/test_pipeline.js` — local pipeline test, дублює W1+W2+W3

Переписані README файли:
- `README.md` (root) — повний rewrite: production-ready status, quick-start, pipeline overview, Sheets cheatsheet section, file structure, common tasks, cost estimate
- `workflows/README.md`, `code_nodes/README.md`, `prompts/README.md`, `scripts/README.md`, `docs/README.md` — synced з реальним вмістом folder'ів

Документація фіксів:
- `docs/sheets_schema.md` — `status` колонка позначена як legacy/unused; додано список dead config keys
- `docs/config_keys.md` — додано секцію "Dead keys to remove from your live sheet" (cps_estimate_*, min_speed)

Rationale: Згідно з користувацьким принципом proactive documentation maintenance (memory: feedback_doc_maintenance). Чистий репо = легше onboarding. Видалені файли збережено у git history якщо колись знадобляться. Live Google Sheet config tab матиме рекомендацію в README прибрати застарілі ключі — це manual cleanup для user.

---

### 2026-05-17 — CPS_DRIVEN_BY_CONFIG_NOT_HARDCODED

Context: Раніше LANG_CPS була hardcoded константою в `code_nodes/adapt_translations.js` і `code_nodes/check_timing_and_pad.js` (`{ de: 12, es: 15, ... }`). Користувач додав `cps_estimate_de=13`, `cps_estimate_es=15.5`, ... в config sheet, але код їх не читав — Sheet-значення були dead. Окрім того, плануються voice changes (наприклад, перехід на чоловічі голоси), які можуть зсунути CPS на 1-3 одиниці.

Decision: Зробити CPS config-driven з code-side defaults як fallback. Архітектура:

```js
// Top of code node — defaults bakery
const CPS_DEFAULTS = { de: 12, es: 15, fr: 15, pl: 14, pt: 16, it: 14, tr: 14 };

// After configMap is built
const LANG_CPS = {
  de: parseFloat(configMap.cps_estimate_de) || CPS_DEFAULTS.de,
  // ... per-lang fallback ...
};
```

Якщо `cps_estimate_{lang}` присутній в config → override default. Якщо відсутній → fallback на code-side default (зберігає backward compat).

Додано `scripts/analyze_cps.js` — standalone Node-скрипт що читає expoрт `localizations.csv` і виводить observed CPS per lang (для рядків з `final_speed=1.0`, щоб не плутати з прискореними сегментами). Поряд порівнює з current `cps_estimate_*` з `config.csv` (якщо є sibling файл), пропонує rounded recommendations. Запускається вручну після кожного W3 прогону або при зміні голосів.

Conflict with prior decisions: ослаблює `CLEANUP_LEGACY_FILES_AND_DOCS` (2026-05-17) — там `cps_estimate_*` був позначений як "dead key". Тепер ці keys — live optional overrides. Documentation в `docs/config_keys.md`, `docs/sheets_schema.md`, `README.md` оновлено відповідно.

Rationale: Voice changes (планується переходити на male/female + інші мови) роблять CPS не universal-константою, а voice-pair-specific. Виносити в config дозволяє швидко тюнити з Sheet без редагування коду. Code-side defaults захищають від config-shutdown. Analyze script закриває data-driven loop: запустив W3 → дивишся observed → оновлюєш config якщо drift.

Заплановано окремо (не в цьому коміті): **W0_Calibrate workflow** — автоматизована калібрація CPS на test sample audio після зміни voice_id. Триггер manual, output — рекомендовані значення з можливістю автозапису у config. Дизайн обговорюється з користувачем.

---

### 2026-05-17 — W0_CALIBRATE_NOT_BUILT (analyze_cps.js покриває use case)

Context: Розглядали окремий n8n workflow W0_Calibrate, який би на reference audio + поточні `voices` робив TTS кожною мовою на speed 1.0 → міряв observed CPS → автоматично оновлював `cps_estimate_{lang}` в config sheet. Use case — швидка перекалібровка після voice swap.

Decision: **Не будуємо W0.** Існуючий `scripts/analyze_cps.js` + runbook у `scripts/README.md#cps-calibration-runbook` закривають той же flow без додаткової інфраструктури.

Rationale: Кожен сценарій, де потрібна перекалібровка (voice swap, нова мова, periodic drift check), все одно вимагає W3-прогону — або щоб почути новий голос, або щоб згенерувати production output. W3 пише в `localizations` рядки з `real_duration_sec` і `final_speed=1.0`, які analyze_cps.js якраз і споживає. W0 би просто дублював TTS-проходи (~$0.25 на запуск) без економії жодного user step. Висновок задокументовано у `/Users/vsevolodzolotko/.claude/plans/distributed-stirring-stroustrup.md`.

---

### 2026-05-17 — W_MASTER_DRIVE_TRIGGER_ORCHESTRATOR

Context: До цього моменту pipeline запускався вручну: користувач клав файл у Drive, копіював file_id у W1's Download Audio, ставив `lesson_id` хардкодом у W1's Segment Transcript jsCode, виконував W1 → W2 → W3 послідовно. Це OK для розробки, але не масштабується на десятки уроків.

Decision: Створено `workflows/W_Master.json` — orchestrator з 7 нодами: Drive Trigger (input/) → Parse Filename → Execute W1 → Execute W2 → Execute W3 → Read Config → Build Telegram Message → Telegram Notify. W1 модифіковано — додано Execute Workflow Trigger + Get Params Code-ноду, щоб приймати `{file_id, lesson_id}` від W_Master і fallback-ити на хардкодні defaults при ручному запуску (Manual Trigger зберіг).

**lesson_id derivation**: з імені файлу через `replace(/\.[^./\\]+$/, '')` → trim/lowercase → `replace(/[^a-z0-9_-]+/g, '_')`. Тобто `sleep_002.mp3` → `sleep_002`, `Sleep Lesson 003.wav` → `sleep_lesson_003`. Non-audio drops (за mime або extension) soft-skip — Parse Filename повертає `[]`, downstream нічого не робить.

**Retry semantics**: кожна з трьох Execute Workflow нод — `retryOnFail=true`, `maxTries=2` (= 1 retry), `waitBetweenTries=5000`, `onError=stopWorkflow`. Один retry — компроміс між self-healing (transient API errors) і fail-fast (real bugs не повинні мовчки повторюватись 5 разів). Якщо все одно fail → workflow зупиняється, Telegram НЕ відправляється; debug через n8n execution log.

**Telegram payload**: lesson_id, source filename, active_langs count + list, лінк на `https://drive.google.com/drive/folders/{drive_output_full_folder_id}`. Bot authenticates через n8n credential, chat_id зчитується з config sheet (`telegram_chat_id`). Якщо chat_id missing — Build Telegram Message кидає error до того, як Telegram нода виконується.

Нові config-ключі: `drive_input_folder_id` (для документації — фактично прив'язується в Drive Trigger ноду в UI), `telegram_chat_id` (зчитується з sheet у Build Telegram Message).

Rationale: Drive trigger відразу дає auto-pipeline без додаткових webhook ендпоінтів, а filename-based lesson_id виключає ручний крок копіювання file_id. Retry=1 (а не 3) — щоб не маскувати справжні баги. Telegram-нотифікація — мінімальне push-сповіщення; для повніших dashboard alerts можна додавати поверх. W0_Calibrate (див. вище) свідомо не будемо — analyze_cps.js покриває.

---

### 2026-05-17 — W1_DUAL_TRIGGER_PATTERN

Context: W1 раніше мав тільки Manual Trigger з `fileId` і `lesson_id` хардкодними. Тепер його викликає W_Master через Execute Workflow Trigger, але хочеться зберегти можливість ручного debug-запуску.

Decision: Додано другий тригер (Execute Workflow Trigger) паралельно Manual Trigger. Обидва конвергують на нову `Get Params` Code-ноду, яка нормалізує `{file_id, lesson_id}` з вхідного payload, fallback-ить на захардкоджені defaults (`1gDRuwWEtfeHcQwEjEMbg4cQOHZQC_nYR` / `sleep_001`) коли запуск ручний (Manual Trigger не передає payload). Download Audio тепер використовує `={{ $json.file_id }}`, а Segment Transcript jsCode читає `lesson_id` через `$('Get Params').first().json.lesson_id`.

Rationale: Pattern "два тригери → один normalizer" коштує однієї додаткової ноди, але дає 2 переваги: (1) parent workflow (W_Master) і ручне виконання використовують той самий downstream pipeline без розгалуження, (2) defaults у Get Params задокументовані як constants, а не "магічні" числа у різних місцях.

---

### 2026-05-17 — MULTI_LESSON_FILTERING_IN_W2_W3

Context: Користувач прогнав W_Master, дропнув `test3_small.wav` (26 сек), а pipeline видав `sleep_001_full_tr.wav` тривалістю >1 хв. Тобто згенерувався дубляж попереднього уроку, а не того що дропнули. Корінь — W2 і W3 не мали Execute Workflow Trigger нод і ігнорували `lesson_id` параметр який W_Master їм передавав, плюс їхні Code-ноди читали ВСІ рядки з `segments` / `localizations` без жодного фільтра. Залишені рядки `sleep_001_seg_*` з попереднього прогону потрапили в обробку разом з новими `test3_small_seg_*`.

Decision: W2 і W3 отримали той самий dual-trigger pattern що й W1 (Manual + Execute Workflow Trigger → Get Params Code-нода), а Code-ноди тепер фільтрують усі читання по `segment_id.startsWith(lesson_id + '_')`:

- **W2**: `Prepare Tone Analysis` і `Prepare and Expand` після читання `Read Pending Segments` додано `.filter(i => !lesson_id || i.json.segment_id.startsWith(lesson_id + '_'))`.
- **W3**: `Expand TTS Jobs` фільтрує sortedSegs, `Build Full Audio Per Lang` фільтрує `items` перед групуванням по lang. Це критично для concat — без фільтра в Build Full було б склеювання сегментів різних уроків в один WAV.

Якщо `lesson_id === null` (Manual Trigger без payload) — фільтр пропускається. Це зберігає backward compat для ручних debug-запусків коли користувач хоче пройти всі pending рядки за один раз.

Side fix у `workflows/W_Master.json`: вирази `={{ $('Parse Filename').first().json.lesson_id }}` в Execute W2 і W3 замінено на `={{ $json.lesson_id }}`, бо `first()` для multi-item потоку завжди повертав lesson_id ПЕРШОГО файлу. `Build Telegram Message` переписано щоб емітити N items (по одному на Parse Filename item) через `$('Parse Filename').all().map(...)` — тепер кожен файл отримує власне Telegram-повідомлення.

Rationale: Це фіксить single-file correctness (для якого є реальний баг-репорт), і безкоштовно вмикає multi-file drop як побічний продукт. Альтернатива — auto-cleanup `segments` sheet перед кожним запуском — створює нову точку відмови (а якщо cleanup тільки частковий, дані змішуються все одно). Фільтрація по `lesson_id` strict-superset workflow's behavior — попередні випадки коли sheet чистий або містить тільки один урок працюють так само як раніше.

Tradeoffs:
- `Read Localizations Fresh` у W3 все ще читає всі рядки, тому `Download Segment WAV` витрачає Drive API виклики на стара уроки. Прийнятно бо a) для clean sheets немає stale рядків, b) Drive read free. Якщо стане проблемою — додати окрему Filter ноду між Read Localizations Fresh і Download Segment WAV.
- Filter не оптимальний для дуже великих sheets — кожен виклик W3 робить .filter() over full localizations table. Це O(N) per run, тривіально до ~10K рядків.

Conflict with prior decisions: жодних.

---

### 2026-05-18 — RETRY_AND_BACKOFF_ON_CLAUDE_AND_ELEVENLABS_CALLS

Context: На тестовому 4.5-хвилинному аудіо ("the_anchor") W2 пропустив 14 з 31 сегментів (5, 12, 17, 20-31). Patterns failures розкидані спочатку (5, 12, 17), а потім зплошним блоком з seg_020 до кінця. Той самий текст "I am enough." успішно пройшов в seg_019, але провалився у seg_020/021 — це підтверджує що проблема **не в контенті**, а у транзитному стані Anthropic API: timeout / 429 / порожня відповідь. W2 "Extract Translations" має захист (skip якщо немає валідних перекладів) щоб не перезаписувати existing sheet rows порожніми рядками — це і призводить до того, що сегменти "беззвучно" пропускаються в кінцевих результатах.

Decision: Додано retry з exponential backoff на всі Claude / ElevenLabs HTTP-виклики:

- **W2 Claude Tone Analysis** (HTTP Request node): `retryOnFail=true, maxTries=4, waitBetweenTries=5000` (n8n-level retry).
- **W2 Claude Translate** (HTTP Request node): те ж саме. Плюс `onError: continueRegularOutput` залишений — якщо після 4 спроб і досі fail, downstream Extract Translations skip-ить рядок (existing захист).
- **W2 Wait node**: збільшено з 2с до 4с між Claude requests. Per 31-сегментну лекцію це додає ~62с але дає Anthropic API ~12 RPM steady замість 30 — добре нижче за 50 RPM ліміт default tier.
- **W2 Adapt Translations** (Code node, helpers.httpRequest): JS-level retry wrapper навколо `callClaude()` — 4 спроби з backoff 2s/4s/8s. Після всіх невдалих спроб повертає `''` (empty) → length-floor check у `claudeShorten` (60% from MIN_RETAIN) залишає попередній рядок без змін.
- **W3 Check Timing + Pad** (Code node): retry wrapper навколо `tts()` (ElevenLabs) AND `callClaude()` (Anthropic Haiku). 4 спроби з backoff. tts() кидає throw на остаточному fail (бо без TTS нічого не зробити); callClaude() повертає `''` (м'який graceful — Claude shorten/expand просто не зменшить текст, original залишається).

Rationale: Rate limit / network glitches — норма у multi-step API pipelines. Замість заходу "fail loud" обираю "retry few times, then skip gracefully" бо meditation script — не критична транзакція; краще втратити 1 сегмент і дізнатись з logs, ніж зривати весь run. Exponential backoff (2s→4s→8s) — стандартна стратегія для 429 — дає API час відновити квоту перед наступною спробою.

Tradeoffs:
- **Час**: на чистих API без помилок зміни не впливають (бо retry не fire). На API з 429 — додаткові 2-14с на сегмент, проте кейс passing rate стає ~100% замість попередніх ~55%.
- **Cost**: retry → можливі дубльовані виклики (платні). Але оскільки failure-rate без retry була ~45% на довгих лекціях, retry економить більше (запобігаючи re-run всього pipeline) ніж витрачає.
- **Observability**: failures у Code-нодах ловляться у `console.error` → видно у n8n execution logs, але НЕ пишуться у segments sheet. Майбутній improvement — писати "FAILED" або attempt count у `notes` колонку коли всі retry вичерпані.

Conflict with prior decisions: жодних. Доповнює існуючий `onError: continueRegularOutput` патерн на Claude Translate.

What is NOT in this fix (можливі follow-ups):
- ~~**Batched translation**~~ ← реалізовано наступним фіксом (див. нижче).
- **Detect-and-mark-failed у sheet** — додати notes/status колонку, щоб юзер бачив які саме сегменти failed без читання execution logs. Невелика зміна, але окремий план.

---

### 2026-05-18 — BATCHED_TRANSLATION_TO_AVOID_TOKEN_RATE_LIMIT

Context: Після додавання retry+backoff протестували 4.5-хвилинну лекцію the_anchor (31 сегмент). Результат: 17 успіхів, 14 провалів — той самий ~45% failure rate. Identical text "I am enough." успіх у seg_019 і seg_021, провал у seg_020. Retry допоміг сповільнити failure rate (попередньо було 14 провалів сходу, тепер scatter), але не виправив root cause.

Корінь — **output-tokens-per-minute обмеження Anthropic Default Tier**: 8K вихідних токенів/хв. Один Claude-виклик за сегмент = ~600 токенів output × 31 сегмент = 18K/хв. Перші ~14 запитів проходять, потім API повертає 429 / порожній content / interrupted response. Retry/backoff лише трохи розтягує в часі без зміни total rate.

Decision: переписано W2 `Prepare and Expand` + `Extract Translations` на **батчований режим**. Замість 1 запит на сегмент — 1 запит на 8 сегментів (`BATCH_SIZE = 8`). Для 31-сегментної лекції це **4 запити замість 31**.

**Архітектура батчу**:

- `Prepare and Expand` групує сегменти у батчі. Кожен emit-item містить `claude_body` де:
  - System prompt — instructions + ToV. Обгорнуто в `cache_control: ephemeral` (Anthropic prompt caching) щоб 2-й, 3-й, 4-й batch не оплачував токени за повторюваний system prompt.
  - User content — JSON map `{ segment_id: { text: "...", type: "narrative", key_concepts: "..." } }` для всіх сегментів батчу.
- `Claude Translate` HTTP node — без змін структури, просто менше викликів.
- `Extract Translations` — оновлено: парсить batched JSON response (`{ segment_id: { de: ..., es: ..., ... } }`) і emit-ить per-segment items для downstream `Adapt Translations`.
- `Adapt Translations` (CPS-driven shorten) — без змін, працює per-segment як раніше.

`max_tokens` для Claude bumped з 2000 на 8000 (бо batched response більший).

Rationale:
- **Tokens-per-minute compliance**: 4 batches × ~5000 tokens output × 60s = 1.25K tokens/min. Глибоко під 8K ліміт.
- **Latency**: 31 окремих виклики × ~2с claude + 4с wait = ~190с. 4 батчі × ~8с claude + 4с wait = ~50с. **~4× швидше**.
- **Cost**: 31 окремих system prompts × ~1500 input tokens = 47K input tokens. 4 батчі з prompt caching: 1 повний system + 3 cached × ~150 tokens = 1.95K input. **~24× менше input tokens**. Output token count приблизно той самий.
- **Quality**: Claude бачить контекст всього батчу разом — кращі переклади для повторюваних affirmations ("I am enough." × 3) і consistency between related segments.
- **Reliability**: Менше HTTP запитів = менше точок відмови. Single batched failure впливає на 8 сегментів, але retry-логіка на HTTP node level (`maxTries=4, waitBetweenTries=5000`) лікує більшість випадків.

Tradeoffs:
- **Batch-level failure radius**: якщо Claude повертає некоректний JSON для батчу (наприклад, truncated) — втрачаємо до 8 сегментів за раз. Mitigation: `max_tokens=8000` робить truncation малоймовірним; defensive parser у Extract Translations логує помилку але не падає.
- **Order matters less**: раніше segment_id ↔ claude response пара була 1-to-1. Тепер маємо JSON map ключований по segment_id всередині батчу — більш explicit, але mismap ризики є якщо Claude переплутає id-шки (рідко).
- **Tone analysis context per batch**: tone info (type, key_concepts) пакується в user JSON. Це додає ~50 токенів per segment, але preserves quality.

Conflict with prior decisions: жодних. Працює поверх попереднього RETRY_AND_BACKOFF фіксу — retry на batch-level спрацьовує на rare server errors.

Future work:
- Adaptive BATCH_SIZE на основі total segment count (наприклад 16 для >50 сегментів).
- Detect-and-mark-failed у segments sheet (`notes` колонка) для observability — щоб юзер відразу бачив які сегменти failed замість читання execution logs.

---

### 2026-05-18 — SCALING_FOR_LONG_FORM_LESSONS_10_PLUS_MINUTES

Context: Поточна архітектура (post-W2-batching) добре працює до ~60 сегментів (~9 хв). Для 12+ хвилинних лекцій (80+ сегментів × 7 langs = 560+ TTS викликів) виявляються нові bottlenecks:

1. **Tone Analysis single-call** — один Claude-виклик з усіма сегментами наближається до max_tokens ліміту при N>100.
2. **W3 sequential loop** — Split In Batches з batchSize=1 + Rate Limit Guard Wait 3с = 560 ітерацій × ~10с/ітерацію = ~95 хвилин на 12-хв лекцію.
3. **ElevenLabs TTS sequential** — `httpRequest` ноді без batching обробляє items по одному. ElevenLabs Scale-tier підтримує 15 concurrent → потенціал 5-15× прискорення.

Decision: Три зміни для long-form support.

**1. W2 Tone Analysis батчинг** (`workflows/W2_Translate_v2.json`):
- `Prepare Tone Analysis` тепер ділить сегменти на батчі по `TONE_BATCH=40`. 80 сегментів → 2 батчі, 160 → 4.
- `max_tokens` bump 2000 → 4000 (за умови 40 сегментів × ~50 chars output).
- `Parse Tone Map` тепер merge-ить кілька batched responses через `Object.assign`. Defensive — пропускає поламані батчі з error log, не падає.

**2. W3 Loop Over Items batchSize 1→5** (`workflows/W3_Synthesize_v2.json`):
- 560 items / 5 = 112 ітерацій замість 560.
- Кожна ітерація обробляє 5 TTS jobs (зазвичай 5 langs для одного сегменту через cross-join порядок).
- Не дає справжньої concurrency для downstream Code-нод (Check Timing + Pad ітерує items by-default), але різко зменшує overhead Rate Limit Guard wait + Drive Save iterations.

**3. ElevenLabs TTS HTTP node batching** (`workflows/W3_Synthesize_v2.json`):
- Додано `options.batching.batch = { batchSize: 5, batchInterval: 0 }`.
- 5 паралельних TTS-запитів одночасно. ElevenLabs Scale tier має 15 concurrent — безпечно під лімітом (запас 3× для retries).
- Прискорює саме TTS-етап у ~5×.

**4. W3 Rate Limit Guard Wait 3с→0.5с** (`workflows/W3_Synthesize_v2.json`):
- Виправдано бо ElevenLabs Scale tier має high RPM (~500+).
- Економія: 560 × (3-0.5) = ~23 хвилини на 12-хв лекцію.

**Expected impact на 12-хв лекцію (80 сегментів)**:

| Step | До (estimated) | Після |
|---|---|---|
| W1 (STT) | ~6 сек | ~6 сек |
| W2 Tone Analysis | ~15 сек | ~10 сек (2 батчі parallel) |
| W2 Translate | ~120 сек (15 батчів × 8с) | ~120 сек |
| W2 Adapt | depends on shorten count | depends |
| W3 Loop iterations | 560 × 10с = ~95 хв | 112 × ~4-7с = ~10-15 хв |
| Total W3 | ~95 хв | **~10-15 хв** (6-9× speedup) |

Rationale:
- Концентровано на біggest-bang-for-the-buck: W3 loop dominates total time, тому changes there мають найбільший impact.
- Tone Analysis батчинг — preemptive захист від overflow на 100+ сегментах, де single-call підходить близько до max_tokens. Маленький overhead для коротких лекцій (1 батч = той же 1 call).
- HTTP Request batching — n8n-native feature (`options.batching.batch`), не вимагає Code-нод чи custom Promise.all логіки.

Tradeoffs:
- **Кошти**: паралельні TTS виклики не змінюють cost (та ж кількість викликів), просто швидше. Anthropic Tone Analysis at 2 batches замість 1 = ~2× system prompt input tokens (без prompt caching) — невеличке збільшення.
- **Concurrency safety**: 5 паралельних TTS на ElevenLabs Scale (15 concurrent capacity) — safe з запасом. Якщо tier нижчий — треба зменшити batchSize.
- **Memory**: 5 paralel TTS responses в RAM одночасно (5 × ~100KB PCM) = ~500KB additional memory per loop iteration. Тривіально.
- **Order**: Items у batch обробляються паралельно — fairness гарантована не строго (race conditions для same-segment-different-lang теоретично можливі). Але кожен (segment × lang) пишеться в окрему row у localizations sheet → конфліктів немає.

What is NOT in this change (можливі follow-ups для 30+ хв lessons):
- **Parallel Check Timing + Pad** — зараз код-нода обробляє items in sequence within a batch. Для масової параллелізації треба замінити на Code-нода з Promise.all. Складніше, але дасть ще 3-5× speedup.
- **Streaming concat** у Build Full Audio Per Lang — зараз все в RAM. Для 30+ хв треба ffmpeg streaming. Не критично до ~25 хв.
- **Parallel branches per language** — replicate Loop Over Items 7 разів, по одній на lang. Дає істинний 7× parallel. Більший redesign.
- **Adaptive batchSize** — підбирати batchSize під lesson size (1 для коротких, 10 для дуже довгих). Зараз hardcoded 5.

Conflict with prior decisions: жодних.

---

### 2026-05-18 — W3_LOOP_BATCHING_REVERTED_DATA_LOSS_BUG (postmortem)

Context: попередній SCALING_FOR_LONG_FORM_LESSONS зміни (batchSize=5 на Loop Over Items + `options.batching.batch={batchSize:5, batchInterval:0}` на ElevenLabs TTS) дали data-loss на real-world прогоні `the_anchor.mp3` (4.5 хв, 31 сегмент). У `localizations` потрапили 43 рядки замість очікуваних 217 (31×7).

**Pattern провалу** — рівно 1 рядок per Loop iteration (217 items / batchSize=5 ≈ 44 batches → 43 рядки):
```
seg_001: de, it    seg_002: pl    seg_003: es, tr    seg_004: pt    seg_005: fr
seg_006: de, it    seg_007: pl    ...
```
Lang-розподіл циклічний по 5 сегментах (35 items/cycle) — точно 1 langs per batch.

**Корінь**: `Check Timing + Pad` Code-нода використовує singular accessors:
- `$('Expand TTS Jobs').item.json` — paired-item accessor (singular)
- `$input.first().binary?.data` — тільки перший input binary
- `return [{ json, binary }]` — завжди 1 output item

З `batchSize=5` Code-нода отримує 5 input items, але обробляє тільки перший. Решта 4 губляться. Build Full Audio Per Lang потім склеює тільки ці fragmented кусочки → final WAV-и значно коротші за оригінал.

Decision: **revert** обидві batching-зміни в `workflows/W3_Synthesize_v2.json`:
1. Loop Over Items: видалити `batchSize: 5` (за замовчуванням 1).
2. ElevenLabs TTS: видалити `options.batching.batch` блок.

Залишаємо **в силі**:
- Rate Limit Guard Wait 0.5с (не пов'язано з batching, дає ~3× прискорення без ризику).
- Prepare Localization Row JOIN-by-filename (robust навіть з batchSize=1).
- Save to Drive `={{ $json.file_name }}` (працює коректно).

Rationale: correctness > speed. Краще ~24 хв на 4.5-хв лекцію зі 100% даних ніж ~10 хв з 20% даних. Reverted state однаково ~3× швидший за оригінал (через Wait 0.5с замість 3с).

**Lessons learned**:
1. Per-item Code-ноди з `.item` / `.first()` accessors НЕ можна тримати в batched Loop without rewriting. Перевіряти все code path при зміні batchSize.
2. n8n's `options.batching.batch` на HTTP Request — туманна семантика. Точно не дає 5× concurrent без додаткових змін у downstream нодах. Краще уникати поки немає чіткого розуміння.
3. Pattern-based detection працює: подивитись на distribution row-counts (43 ≈ 217/5) одразу натякає на batching проблему.

Future (Phase 2, окремий план): для true parallelism — замінити Loop Over Items + ElevenLabs TTS + Check Timing + Pad на **єдину Code-ноду з Promise.all**. Усе в одному JS-контексті — без n8n-pairing-pitfalls. Дасть 5-10× speedup без data-loss ризиків.

Conflict with prior decisions: відкочує частину SCALING_FOR_LONG_FORM_LESSONS_10_PLUS_MINUTES (батчинг W3). Tone Analysis batching у W2 + Wait 0.5с у W3 — залишаються в силі.

---

### 2026-05-19 — NOTIFICATION_CHANNEL_TELEGRAM_TO_SLACK

Context: Користувач переходить з Telegram на Slack для completion-нотифікацій. Причина — Slack більш natural fit для team workflow (інші робочі канали уже там), плюс позбавляє від bot-management overhead (BotFather revoke/replace кожен раз коли токен світиться).

Decision: замінено `Telegram Notify` ноду в `workflows/W_Master.json` на `Slack Notify` (n8n-nodes-base.slack, typeVersion 2.2). `Build Telegram Message` Code-нода перейменовано в `Build Slack Message` і переписано:

- Замість `chat_id` → `channel` (читається з `cfg.slack_channel`).
- Текст переформатовано під Slack mrkdwn: `*bold*`, `:emoji:`, `<url|text>` для кликабельних лінків замість HTML.
- Лінк на output folder тепер кликабельний: `<https://drive.google.com/.../folders/...|Open in Drive>`.

Config sheet:
- Доданий ключ `slack_channel` (channel ID типу `C01234ABCDE`).
- Ключ `telegram_chat_id` — застарілий, можна видалити з sheet.

Required Slack scopes для bot:
- `chat:write` — base requirement
- (optional) `chat:write.public` — щоб писати в публічні канали без `/invite`

Без `chat:write.public` бот треба запросити в канал командою `/invite @YourBotName`. Інакше API повертає `not_in_channel`.

Rationale:
- Slack OAuth tokens мають довший lifecycle ніж Telegram bot tokens (немає frequent revoke/replace).
- Slack rich formatting (block kit, attachments, threads) дає простір для майбутніх покращень — наприклад тред-replies з per-lang details.
- Slack workspace централізує робочі сповіщення; Telegram був temp-solution з minimal setup.

Tradeoffs:
- Slack app setup складніший: треба створити app на api.slack.com, налаштувати OAuth scopes, install to workspace, copy `xoxb-` token. Telegram BotFather швидший. Один-раз setup overhead.
- Slack credentials прив'язані до workspace — якщо проект колись передаватиметься іншій команді, треба переробляти app/credentials. У Telegram bot портабельний.
- Слово `chat_id` (negative для груп) у Telegram було user-friendly через `@userinfobot`. У Slack `channel ID` (`C01234...`) менш очевидний — треба пояснити в docs.

Files changed:
- `workflows/W_Master.json` — node replaced (Telegram→Slack), Code-нода переписана, connections updated.
- `docs/config_keys.md` — `telegram_chat_id` рядок замінено на `slack_channel`.
- `workflows/README.md` — таблиця нод і setup-checklist оновлені.
- `README.md` — згадки про Telegram замінено на Slack.

Conflict with prior decisions: відкочує `W_MASTER_DRIVE_TRIGGER_ORCHESTRATOR` (Telegram-частина). Архітектура multi-file, Drive Trigger, lesson_id scoping — без змін.

---

### 2026-05-19 — MEMORY_REFACTOR_W3_BUILD_FULL_AFTER_OOM_KILL

Context: 2026-05-18 n8n self-hosted сервер (1 GB RAM, SQLite) впав під час 40-хв виконання W3 на the_anchor.mp3 на стадії concat. Кернел убив n8n процес → SQLite write in progress → corruption → wipe-нуло workflows + credentials + executions. Це другий серйозний інцидент після W3_LOOP_BATCHING_REVERTED — і поки той був code bug, цей був operational/memory issue.

Explore-агент підтвердив hotspot у `Build Full Audio Per Lang` Code-нодi (`workflows/W3_Synthesize_v2.json`):
- `$input.all()` → 217 items × ~480 KB base64 = ~104 MB у JS heap одночасно
- `byLang` pre-grouping дублює refs → ~72 MB після base64-декоду
- `results` накопичує всі 7 готових full WAVs до return → ~76 MB
- **Peak: ~250-300 MB** для 4.5-хв лекції. На 12-хв (560 items) — ~500-800 MB.
- Жодного `N8N_BINARY_DATA_MODE` env var → бінарні дані в heap, не на диску.

Decision: Two-phase memory mitigation.

**Phase 1 — n8n env vars** (zero code change, не в git):
```
N8N_BINARY_DATA_MODE=filesystem
EXECUTIONS_DATA_PRUNE=true
EXECUTIONS_DATA_MAX_AGE=168
EXECUTIONS_DATA_SAVE_ON_SUCCESS=none
EXECUTIONS_DATA_SAVE_ON_ERROR=all
EXECUTIONS_DATA_SAVE_DATA_ON_PROGRESS=false
```
Очікуваний ефект: peak 300 MB → 100 MB. Документовано у `workflows/README.md` в новій секції "n8n deployment env vars".

**Phase 2 — refactor Build Full Audio Per Lang Code-нодi**:
- Прибрано pre-grouping у `byLang` — items фільтруються per-iteration через `items.filter(i => i.json.lang === lang)`. Не тримаємо 7 копій refs одночасно.
- Додано explicit `pcmChunks.length = 0` після `Buffer.concat` — звільняє refs на per-segment буфери для GC.
- `activeLangs` тепер береться з `config.active_langs` (fixed list) замість dynamic discovery через `Object.keys(byLang)`. Стабільніше і не залежить від того, що було в input.
- `fullPcm` і `fullWav` йдуть out of scope на кожній наступній iteration → GC може реклеймити.

Peak memory у concat-стадії після refactor: ~140 MB (без env vars). З filesystem mode — ~50 MB.

Rationale:
- Phase 1 — найкращий ROI: один env var → ~70% reduction без коду. Operational config, не workflow change.
- Phase 2 — defense in depth: навіть без filesystem mode, refactor сам по собі знижує peak на ~40%. Атомарний commit, легко rollback.
- Обидві разом: 4.5-хв лекція з 300 MB → ~30-50 MB peak. Стійко на 4 GB сервері навіть для 30+ хв lessons.

Tradeoffs:
- Refactor читає `Read Config` зсередини Build Full Audio Per Lang — це нова залежність, але config уже читається в W3 раніше у Expand TTS Jobs, тому n8n кешує результати `$('Read Config').all()`. Overhead тривіальний.
- `Object.keys(byLang).sort()` був dynamic — спрацював би для будь-яких langs у input. Тепер фіксований список з config — якщо хтось додасть `xx_text` у segments без `xx` у `active_langs`, ці сегменти не concat-нуться. Це фіча, не баг (active_langs — source of truth).

Files changed:
- `workflows/W3_Synthesize_v2.json` — тільки `Build Full Audio Per Lang` jsCode.
- `workflows/README.md` — нова секція "n8n deployment env vars" + апдейт node-table.

What is NOT in this fix (Phase 3, окремо):
- **Per-lang Sub-Loop в n8n** через SplitInBatches → ще ~3× зниження memory. Для 30+ хв lessons. Більший redesign.
- **Streaming concat via ffmpeg** — найрадикальніше, потребує ffmpeg на сервері + subprocess.spawn. Залишається у Phase 3.
- **Postgres замість SQLite** — operational/ops, рекомендовано у docs але не блокуюче.

Conflict with prior decisions: жодних. Доповнює існуючу архітектуру W3 без зміни data flow.

Lessons learned:
1. **OOM kill = DB corruption** на SQLite. Memory monitoring + Postgres важливі для production.
2. **n8n holds binary in JS heap by default** — це нетривіально, varto документувати у setup checklists.
3. **Pre-grouping items by some key** доцільно тільки якщо потім всі групи треба тримати одночасно. Для sequential обробки — lazy filter дешевший.

---

### 2026-05-19 — W3_NO_FULL_RETRY_ON_PARTIAL_FAILURE

Context: на the_anchor.mp3 W3 пройшов до `seg_013_it`, fail-нув на `seg_013_tr` (ймовірно ElevenLabs 429 чи timeout після всіх 4 retry-спроб у `tts()` функції), і W_Master запустив **retry усієї W3 з нуля** через `retryOnFail=true, maxTries=2` на Execute W3. Друга атака почала перестворювати TTS-файли від `seg_001_de` заново — це означає:

- 5+ хвилин уже зробленої роботи **викидаються** і повторюються
- Кожна re-TTS — це нові Drive uploads (дублікати в `output/`)
- Localizations rows перезаписуються (upsert по `row_key`), але старі Drive-файли стають orphans
- ElevenLabs cost множиться ×2 (а на retry-storm-сценарії — ×N)
- Якщо причина fail була стійка (e.g., Anthropic Tier 1 quota exhausted), retry знову fail на тому ж місці → інфініт re-try до maxTries.

Decision: **дві захисні зміни** щоб partial failure не призводив до full-workflow retry.

**1. W_Master: disable retry на Execute W3**

`workflows/W_Master.json` — на ноді Execute W3 (Synthesize) видалено `retryOnFail`, `maxTries`, `waitBetweenTries`. Залишено лише `onError: stopWorkflow` — W_Master зупиняється на failure без повторення.

W1 і W2 retry **залишений** (`retryOnFail=true, maxTries=2`) — ці workflows короткі (секунди до хвилини), idempotent, retry дешевий. Тільки W3 — довгий (~25 хв на 4.5-хв лекцію) і non-idempotent у частині Drive uploads, тому retry на ньому особливо дорогий.

**2. W3 Check Timing + Pad: tts() soft-fail замість throw**

`workflows/W3_Synthesize_v2.json` — `tts()` тепер повертає `null` після всіх 4 спроб (раніше throw). Усі 3 call-sites (shorten retry, speed retry, expand loop) додали null-guards:

- Shorten retry: при `tts→null` → залишити попередній text/pcm, mark `needsAttention=true`, break loop.
- Speed retry: те ж саме — keep previous, mark, break.
- Expand loop: при null break (no expansion improvement).

Також додано **silent-WAV fallback** на початку основної логіки: якщо initial ElevenLabs TTS HTTP-нода не повернула binary (ми поставили `onError: continueRegularOutput, retryOnFail=true, maxTries=4` на самій нодi), Check Timing + Pad емітить **тихий WAV довжиною `en_duration_sec`** з `needs_attention=true` і `warning='ElevenLabs TTS failed after retries — silent placeholder WAV'`. Downstream nodes (Save to Drive, Update Localizations, Build Full Audio Per Lang, Save Full to Drive) продовжують працювати.

Rationale:
- **Failure radius — один сегмент-lang**, а не вся W3. 216 з 217 готових сегментів зберігаються; failed segment маркується для ручного review.
- **No silent re-explosion of cost** — Drive не отримує дублікатів, localizations sheet не перезаписується.
- **W_Master Slack notification все одно спрацьовує** з фінальним статусом — користувач бачить що pipeline закінчився.
- **Observability**: `needs_attention=TRUE` і `warning` field у localizations — фільтрувати у sheet щоб бачити failed segments.

Tradeoffs:
- **Без full-W3 retry**: якщо transient API issue (network blip) — failed segment лишається failed. Альтернатива — додати **per-segment retry** всередині W3 (наступний Phase, не зараз).
- **Silent placeholder WAV** замість real audio — у final full WAV буде секунда-чи-більше тиші замість missing slot. Краще ніж crash, але треба усвідомлювати при QA.

Files changed:
- `workflows/W_Master.json` — Execute W3 retryOnFail block removed.
- `workflows/W3_Synthesize_v2.json` — tts() returns null, 3 null-guards у call-sites, silent-WAV fallback на початку, ElevenLabs TTS HTTP-нода тепер з `onError: continueRegularOutput, retryOnFail=true, maxTries=4, waitBetweenTries=5000`.

Conflict with prior decisions: відкочує частину `W_MASTER_DRIVE_TRIGGER_ORCHESTRATOR` (retry semantics на Execute W3). W1/W2 retry залишається в силі.

Future work (Phase 2 для resumable W3):
- **Skip-existing у Expand TTS Jobs**: перед генерацією JOBs читати existing `localizations` і пропускати ті, що уже мають `audio_drive_file_id`. Тоді failed-then-rerun не дублює готову роботу — починає з failed-сегмента. Більший redesign.
- **Per-segment retry-with-backoff** всередині W3 loop: на failure окремого сегмента — try few times, but not whole workflow.
- **Postgres** замість SQLite (operational).

---

### 2026-05-19 — CONDITIONAL_BREATH_BORROW_FOR_SHORT_SEGMENTS

Context: На прогоні the_anchor.mp3 (4.5хв, 31 сегментів) 12 з 217 рядків у localizations отримали `needs_attention=TRUE`. Усі 12 — це ультра-короткі афірмації:

- seg_018 "I am valid." (0.96с): truncated у de, fr, pl, it, tr
- seg_019 "I am enough." (1.28с): truncated у de, tr
- seg_025 "I am grounded." (1.12с): truncated у de, es, pl, pt
- seg_001 "Find a position..." (6.64с): truncated у de (cps_estimate_de tuning issue, окрема задача)

Усі affected сегменти прошли 3 Claude-shorten attempts + speed bump 1.10/1.15 без успіху → hard-truncate до en_duration. На слух — обрізаний останній склад слова. У всіх цих case-ах **наступний сегмент далеко** (gap_after = 5-7с тиші), тобто було куди розширюватись.

Decision: enable **conditional breath-borrow** — дозволити TTS-аудіо вийти за межі `en_duration_sec` ТІЛЬКИ для коротких сегментів (`en_duration_sec < short_seg_threshold_sec`, default 2.0с) і ТІЛЬКИ якщо `effective_slot_sec > en_duration_sec` (тобто є trailing silence). Normal-length segments (≥ 2.0с) залишаються strict-aligned.

**Реалізація** (workflows/W3_Synthesize_v2.json, `Check Timing + Pad` Code-нодa):

1. Замість `const maxAllowed = enDur;` тепер:
   ```js
   const SHORT_SEG_THRESHOLD = parseFloat(configMap.short_seg_threshold_sec) || 2.0;
   const isShortSeg          = enDur > 0 && enDur < SHORT_SEG_THRESHOLD && slot > enDur;
   const maxAllowed          = isShortSeg ? slot : enDur;
   ```
   Де `slot = effective_slot_sec` уже обчислюється в Expand TTS Jobs як `tts_budget + max_borrowable` з config-ключами `min_inter_segment_gap_sec` і `max_borrow_per_segment_sec`.

2. Post-TTS file-build:
   - `realDur <= enDur` → стандартний padding (lead + tts + tail = en_duration).
   - `enDur < realDur <= maxAllowed` → **нова borrow branch**: `borrowedSec = realDur - enDur`, `leadSec = naturalLead`, `tailSec = 0`. **Не** флагається `needs_attention` — це intentional.
   - `realDur > maxAllowed` → defensive: truncate (вже відбувся раніше) + flag attention.

3. Config-key `short_seg_threshold_sec` (default 2.0). Set to 0 для повного revert до strict alignment.

Rationale:
- **Усуває truncation для short-affirmation case** — найпоширеніший failure mode у meditation content. Affected рядків у the_anchor: ~11 з 12 мають отримати borrow (seg_001_de — окрема CPS-калібрування проблема).
- **Зберігає strict alignment для normal segments** (≥ 2.0с) де cross-lang sync критичний для довгих наративних блоків.
- **Не потребує rework** — використовує існуюче `effective_slot_sec` обчислення в Expand TTS Jobs (механіка вже там, просто була disabled).
- **Bounded extension** через `max_borrow_per_segment_sec=2.0` і доступний `gap_after_sec`.

Tradeoffs:
- **Cross-lang drift у borrowed-сегментах**: DE з real_dur=1.4с і ES з real_dur=0.93с у тому ж slot-і дають різні file durations → subsequent сегменти у full WAV для різних мов offset на суму borrows. Drift кумулятивний у фінальному WAV. Для **single-lang listening** (типовий use case meditation) не помітно. Для **cross-lang A/B QA** — drift треба тримати в межах bounded.
- **Threshold вибір**: 2.0с — компроміс. Affected: всі seg_018/019/025-патерни ("I am ___"). Не affected: seg_005 (6.5с), seg_017 (4.5с) etc. Якщо потрібно тонше — config-key регулюється без code change.
- **Без per-lang threshold**: DE/PL мають довші мінімальні слова, можливо потребуватимуть вищого порогу. Поки global 2.0с — якщо побачимо residual truncation в DE/PL — можна знизити cps_estimate_* (root cause fix) або підняти SHORT_SEG_THRESHOLD до 2.5/3.0.

Conflict with prior decisions: **частково пом'якшує** STRICT_ALIGNMENT_DISABLE_BREATH_BORROW (2026-05-17). Strict alignment залишається для нормальних сегментів. Тільки short-segment fallback дозволяє borrow. Існуючі `effective_slot_sec`, `maxBorrowable`, `borrowed_sec` поля у localizations sheet тепер фактично використовуються (раніше були dead-через-strict).

Files changed:
- `workflows/W3_Synthesize_v2.json` — `Check Timing + Pad` jsCode (3 точкові правки: видалення старого maxAllowed, додавання SHORT_SEG_THRESHOLD блоку, нова borrow branch у post-TTS).
- `docs/config_keys.md` — додано `short_seg_threshold_sec`.
- `docs/sheets_schema.md` — оновлено опис `borrowed_sec` (більше не "always 0").

Future work (якщо drift буде помітним):
- **Two-pass cross-lang aware borrow**: всі langs у segment отримують однаковий extension = max needed across langs. Зберігає sync, потребує rework loop architecture (collect → align → resize). Більше складно.
- **Per-language threshold** (наприклад `short_seg_threshold_de=2.5`, інші `2.0`). Тривіально додати, але треба data щоб обґрунтувати.

---

### 2026-05-19 — TRANSLATION_QA_AND_ANTIPATTERN_RULES

Context: Зовнішня review (Gemini) знайшла **семантичні помилки** у Sonnet-перекладах на коротких медитативних афірмаціях:
- `seg_018 "I am valid."`: DE `Ich bin gültig.` (= "дійсний квиток"), FR `Je suis valide.` (= "працездатний"), TR `Ben geçerliyim.` (= "як чинне правило")
- `seg_019 "I am enough."`: FR `Je suis suffisant.` (= **"зарозумілий зазнайка"**), PL `Jestem dość.` (граматично невалідне)
- `seg_014`: TR `limmanımım` (typo з подвійним `mm`)

Корінь: Sonnet 4.5 на 3-словних афірмаціях втрачає терапевтичний контекст і обирає **найперше словникове значення** (бюрократичне/legalese). На довших сегментах якість залишається високою.

Decision: Три targeted-зміни у `workflows/W2_Translate_v2.json` без архітектурного refactor і без model-switch:

**1. Prepare and Expand sysParts** — додано `=== MEANING PRESERVATION ===` блок з конкретними FORBIDDEN translations і RIGHT alternatives для DE/FR/TR/PL/PT/ES/IT. Кейс kicks-in для будь-якого "I am ___" — Sonnet тепер знає що НЕ можна "gültig", "suffisant", "valide" (про людину), "geçerli", і знає WARMER альтернативи.

**2. NEW `Verify Translations` Code-нода** між `Extract Translations` і `Adapt Translations`. Якісний "linter" пост-перекладу:
- Батчить по 8 сегментів × 7 langs у один Claude-call (Sonnet 4.5, prompt-caching на SYSTEM)
- Sends JSON `{segment_id: {en, de, ..., tr}}` і просить **повернути JSON корекцій** (або unchanged-translations якщо чисто)
- Apply corrections per-lang якщо QA повернув non-empty, інакше pass-through
- Retry 4× з exponential backoff на API failure; defensive parse через try/catch
- Cost: ~4 Claude calls per 31-segment lesson ≈ **$0.04**. Latency ~30 секунд

**3. Adapt Translations SYSTEM_PROMPT** — додано anti-pattern guard у CRITICAL RULES блок щоб Adapt-shorten НЕ регресував добрі переклади ("Ich bin richtig" → "Ich bin gültig" заради char-budget). Same list of false-friend traps.

Rationale:
- **Three-layer defense**: prevention (sysParts), QA (Verify), preservation (Adapt). Catches the literal-translation pattern at three different points у потоці.
- **Why before Adapt, not after**: якщо QA fix відбувається ДО shorten — Adapt працює з корректним текстом і скорочує його коректно. Якщо AFTER — Adapt могла регресувати, QA фіксить, але потенційно треба rerun shorten. One-pass cleaner.
- **No model switch**: Sonnet 4.5 уже capable on long-context translation. Issue = prompt guidance, не модель. DeepSeek-V3 (suggested by Gemini) — не warranted: ризик і додатковий cost без guarantees.
- **Cost trivial**: ~$0.04 на лекцію (~1% від $4-5 повної pipeline cost). Латентність +30с прийнятна.

Tradeoffs:
- **Verify Translations може over-correct** на чистих перекладах (perfectly fine "Ich bin wertvoll" → "Ich bin würdig" arbitrary tweaks). Mitigation: prompt explicitly каже "For clean translations, RETURN THEM UNCHANGED". Якщо побачимо drift — додати length-floor exception.
- **Prompt-rules можуть стати stale** як знайдемо нові патерни. Це prompt-text у jsCode — легко доповнити при потребі.
- **Cross-lesson contention**: anti-pattern rules фокусуються на афірмаціях. Якщо колись будемо дублювати не-афірмаційні скрипти — треба буде розширити список або зробити conditional.

Files changed:
- `workflows/W2_Translate_v2.json` — три targeted edits (Prepare and Expand sysParts, NEW Verify Translations node + connections rewire, Adapt Translations SYSTEM_PROMPT).
- `workflows/README.md` — додано рядок Verify Translations у W2 node table.

Conflict with prior decisions: жодних. Доповнює існуючу архітектуру без рефакторингу решти ланцюга.

Lessons learned:
1. **Sonnet first-pass на коротких phrases** не завжди семантично коректна — context-poor. Anti-examples в prompt значно ефективніші ніж "будь обережним".
2. **External LLM review** (Gemini) — гарний sanity check на якість перекладів. Дешевий feedback loop: експортуй segments.csv → попроси review → інтегруй знайдені patterns у prompt.
3. **Three-layer defense** (prevention/QA/preservation) — pattern варто використовувати і для майбутніх translation quality issues.

---

### 2026-05-19 — BORROW_DRIFT_FIX_AT_CONCAT_TIME

Context: Запропоноване в [CONDITIONAL_BREATH_BORROW_FOR_SHORT_SEGMENTS] передбачення збулось. На прогоні `the_anchor.mp3` короткі афірмації (seg_006, seg_007, seg_018, seg_019, seg_025…) активували breath-borrow, кожна на 0.1–0.7с. Per-segment WAV-файли стають довшими за свій slot (`final_duration_sec > en_end - prev_en_end`), а наступний сегмент у concat не знав про overshoot — його `lead_silence_sec` обраховано як `en_start[N+1] - en_end[N]` (від EN, не від реальної позиції в concat). Накопичений drift по `the_anchor` для DE ≈ 1.78с до останнього сегмента. Положення перекладених сегментів роз'їзджались з EN таймлайном — те, що strict alignment мав гарантувати.

Decision: компенсувати borrow на етапі **concat-у в `Build Full Audio Per Lang`**, а не в Check Timing + Pad. Для кожного сегмента N+1 при склеюванні відрізати `min(borrowed_sec[N], lead_silence_sec[N+1])` секунд з ПОЧАТКУ його PCM. Це з'їдає рівно ту тишу, яку seg N запозичив, і ставить seg N+1 у концерт на правильну EN-позицію.

**Реалізація** (workflows/W3_Synthesize_v2.json + code_nodes/build_full_audio_per_lang.js, нода `Build Full Audio Per Lang`):

```js
let prevBorrow = 0, trimmedLeadSum = 0;
for (const e of entries) {
  let pcm = wavBuf.subarray(44);
  if (prevBorrow > 0) {
    const leadSec   = parseFloat(e.json.lead_silence_sec) || 0;
    const trimSec   = Math.min(prevBorrow, leadSec);
    const trimBytes = Math.round(trimSec * SAMPLE_RATE) * BPS;
    if (trimBytes > 0 && trimBytes < pcm.length) {
      pcm = pcm.subarray(trimBytes);
      trimmedLeadSum += trimSec;
    }
  }
  pcmChunks.push(pcm);
  prevBorrow = parseFloat(e.json.borrowed_sec) || 0;
}
```

Додано `trimmed_lead_total_sec` в output JSON для observability (має дорівнювати сумі `borrowed_sec` коли всі lead silences достатні).

Rationale:
- **Single-step compensation**: borrow seg N компенсується ТІЛЬКИ в seg N+1, не накопичується. Кожен сегмент після фіксу опиняється у своїй правильній EN-позиції незалежно від попередніх borrows.
- **Structurally safe**: `max_borrowable[N] ≤ gap_after[N] - MIN_GAP`, а `lead_silence_sec[N+1] = gap_after[N]`. Тож `trimSec ≤ lead_silence[N+1] - MIN_GAP < lead_silence[N+1]` — у TTS-аудіо ніколи не різатимемо. `Math.min(prevBorrow, leadSec)` clamp — belt-and-braces проти Sheet round-trip rounding (3 знаки).
- **Per-segment WAVs у Drive залишаються "як були"** (overshoot en_end на borrowed_sec). Вони — проміжні артефакти для QA, ніхто не накладає їх поодинці на EN таймлайн. Фікс тільки на concat-стадії, де це має значення.
- **Алгоритмічно простіше за альтернативи**: cross-lang aware borrow (collect → align → resize) потребував би рефакторингу loop architecture; reduce lead у Check Timing + Pad — не вийде, бо segments processed in parallel batches і не мають lookahead.

Tradeoffs:
- **Per-segment files стають семантично "розкаліброваними"** — якщо хтось зробить ручний concat без trim-логіки, drift повернеться. Mitigation: задокументовано в `docs/sheets_schema.md`; стандартний шлях — через `Build Full Audio Per Lang`.
- **Cross-lang drift у full WAV — все одно існує**, але обмежений: різні мови мають різні `borrowed_sec`, тож для DE/ES/FR концерти однакової тривалості ≈ EN duration, але внутрішні позиції сегментів ідентичні EN. Cross-lang A/B при listening-по-сегментно тепер працює.
- **Verification**: новий скрипт `scripts/verify_borrow_compensation.js` симулює concat з/без фіксу на експортованому CSV — sanity check без перезапуску W3.

Conflict with prior decisions: **доводить до кінця** CONDITIONAL_BREATH_BORROW_FOR_SHORT_SEGMENTS — це той самий "Tradeoffs → cumulative drift" пункт, що тепер закритий. Альтернатива (set `short_seg_threshold_sec=0`) досі доступна як escape hatch якщо фікс несподівано регресує.

Files changed:
- `workflows/W3_Synthesize_v2.json` — `Build Full Audio Per Lang` jsCode (concat-loop переписаний з prevBorrow/trim, +`trimmed_lead_total_sec` в output).
- `code_nodes/build_full_audio_per_lang.js` — повний rewrite під актуальну JSON-версію + борров-компенсація. Раніше був out-of-sync (без lesson_id filter, без memory-conscious lang loop).
- `docs/sheets_schema.md` — оновлено опис `borrowed_sec` і `final_duration_sec` щоб пояснити що per-file overshoot НЕ дорівнює full WAV overshoot.
- `scripts/verify_borrow_compensation.js` — новий offline simulator.

Lessons learned:
1. **Predicted tradeoffs варто перевіряти на реальних прогонах** — попередня decision явно зазначила "cumulative drift" як risk, але без real-run data ризик виглядав "не критичним". Реальний прогон показав 1.78с drift на 4.5-хв уроці — це чути.
2. **Concat-time compensation > per-file pre-compensation**. Якщо потрібно скоригувати взаємні позиції — робити на стадії композиції, а не модифікувати окремі артефакти. Per-segment files лишаються "природними".
3. **Sample-rate-aware trim** (`Math.round(trimSec * SAMPLE_RATE) * BPS`) — обов'язковий для precision. Просто `trimSec * SAMPLE_RATE * BPS` дав би накопичення sub-sample помилок між сегментами.

---

### 2026-05-20 — QA_SYSTEM_EXPANSION_FOR_CACHE_AND_COVERAGE

Context: `Verify Translations` нода в W2 (повернена після `eadc868` дропу — раніше додана `b4197b9`, але n8n state на момент chore-sync не мав її) використовує `cache_control: { type: 'ephemeral' }` на `QA_SYSTEM`. Виявилось що промпт був ~354 токени — НИЖЧЕ Sonnet 4.5 cache minimum (1024 токени). Anthropic мовчки ігнорує директиву і кожен з 4 батчів на typical-урок обходиться у full price (~$0.05/урок). Окремо: anti-pattern coverage обмежений DE/FR/TR/PL — ES/PT/IT мають свої false-friend traps (`válido`/`valido` для self-acceptance) які не ловились, плюс formality drift і ToV violations не перевірялись зовсім.

Decision: розширити `QA_SYSTEM` до ~1117 токенів (4469 chars) з трьома класами реальних правил:
1. **Class 1 — Literal-dictionary mistranslations (false friends)**: збережено DE/FR/TR/PL, додано ES/PT/IT `válido`/`valido` (clinical/legal feel для affirmations) + note про `suficiente`/`sufficiente` як flat для self-acceptance segments + загальний typo flag.
2. **Class 2 — Formality drift**: explicit per-lang address rules (du/tú/tu/tu/ty/tu/sen) з конкретними anti-forms (Sie/usted/vous/Lei/Pan/você/siz) і EU vs BR PT verb forms (`tu fazes` not `você faz`).
3. **Class 3 — ToV violations**: marketing/transformation vocab, promise/guarantee tone, bare imperative filler, clinical register, anglicism syntax, urgency words — взято з `docs/tone_of_voice.md`.
4. Hard constraints збережено: ±25% length, preserve negations/contrasts/numbers/proper nouns/pause markers, return unchanged when clean.

**Файлові зміни** ([workflows/W2_Translate_v2.json:Verify Translations](workflows/W2_Translate_v2.json)): додано ноду в `nodes` array між Extract Translations і Adapt Translations, переписано connections `Extract Translations → Verify Translations → Adapt Translations`. Скрипт-генератор у `/tmp/n8n_raw/insert_verify.js` (одноразовий, не в репо).

Окрема правка ([workflows/W_Master.json](workflows/W_Master.json)): підставлено реальний Slack credential ID `ogtQ2NONkRrXj2kl` (замість placeholder `REPLACE_WITH_SLACK_CREDENTIAL_ID`) + auto-generated `webhookId` для node-а. Це довершує `feat(w_master): re-add Slack notification stage` (859fd45) — тепер JSON full-import-ready без ручного binding кредента в n8n UI.

Rationale:
- **Cache activation**: 1117 токенів безпечно перевищує 1024-токен Sonnet min. На typical-уроці 4 батчі Verify Translations → batch 1 cache_creation, batches 2-4 cache_read (90% знижка на cached input). Економія ~$0.02-0.03/урок, плюс ~30% швидше TTFT на cache hits.
- **Real content, not padding**: всі 700+ нових токенів — це реальні anti-pattern правила що покращують QA якість. ES/PT/IT тепер покриті false-friend traps які раніше пропускались. Formality drift детектиться явно. ToV violations ловляться окремим class-ом.
- **Backward compat**: на clean translations (як в останньому прогоні the_anchor) Verify повертає текст unchanged — `text_translated` колонка не повинна змінитись. Якщо побачимо unexpected правки на clean rows → over-correction issue.
- **Source of truth = on-disk**: користувач підтвердив що re-import W2.json у n8n після правки. JSON тепер canonical, n8n re-imports на запит.

Tradeoffs:
- **Verify Translations тепер додає ~$0.04/урок (Sonnet input + output)** до повного pipeline cost. Cache знижує до ~$0.025 коли активний. Acceptable bottleneck — quality improvement > cost.
- **Cache misses на нових сегментах**: якщо за 5 хвилин не приходить cache hit (TTL = 5 min ephemeral), оплачуємо knowledge-recreation. Для batched lesson processing — несуттєво (всі 4 батчі в одній сесії укладаються в 30-60 секунд).
- **QA може over-correct**: розширений промпт явно каже "return unchanged when clean", але якщо побачимо arbitrary tweaks на добрих перекладах — варто додати length-floor exception або тоніше формулювання. Моніторити перші 3-5 прогонів.

Conflict with prior decisions: complements `TRANSLATION_QA_AND_ANTIPATTERN_RULES` (2026-05-19) — це та сама three-layer defense, тільки тепер `Verify Translations` нода фактично в репо JSON-і, не тільки в n8n.

Files changed:
- `workflows/W2_Translate_v2.json` — додано Verify Translations ноду (1 нода, ~5KB jsCode), переписано connections.
- `workflows/W_Master.json` — Slack credential ID + webhookId.

Verification:
- Всі 4 Code-ноди парсяться: `node -e "for (const f of [...]) for (const n of require('./workflows/'+f).nodes) new Function('return (async function(){'+n.parameters.jsCode+'\\n})')()"`
- QA_SYSTEM length перевірка: `node -e "console.log(require('./workflows/W2_Translate_v2.json').nodes.find(n=>n.name==='Verify Translations').parameters.jsCode.match(/QA_SYSTEM = \\\`([\\s\\S]*?)\\\`;/)[1].length)"` → 4469.
- Post-deploy: re-import W2.json у n8n, прогнати лекцію з 16+ сегментами (форсує 2+ Verify батчі), глянути на console.log `resp.usage` — очікувано `cache_creation_input_tokens > 1000` на batch 1, `cache_read_input_tokens > 1000` на batch 2.

---

### 2026-05-20 — VTT_SUBTITLES_PER_LANG_IN_W3

Context: Користувач попросив генерувати WebVTT субтитри під час повного прогону — окремий файл на кожну активну мову, у виділеній Drive-папці що задається в config. Дані вже всі є в `localizations` sheet: `text_translated` (фінальна версія після Verify + Adapt + W3 shorten), `en_start_sec`, `en_duration_sec`. Залишилось зібрати у формат VTT і завантажити.

Decision: дві нові ноди в W3 у паралельній гілці після `Read Localizations Fresh` — поряд із `Download Segment WAV`. Ноди: `Build VTT Per Lang` (Code) → `Save VTT to Drive` (Google Drive upload). Гілка не блокує WAV-pipeline (обидві читають одну таблицю незалежно).

**Cue model**: timings = `en_start_sec → en_end_sec`. Після borrow-compensation фіксу (61c9e75) кожен сегмент у full WAV стартує точно на `en_start_sec`, тож EN-aligned cues автоматично співпадають з дубльованим аудіо для ВСІХ мов. Cue text = `text_translated`. Cue нумерація — порядковий індекс (1, 2, 3...).

**Файлові артефакти**: `{lesson_id}_full_{lang}.vtt` (відповідає шаблону `{lesson_id}_full_{lang}.wav`). MIME type `text/vtt`. UTF-8 encoding.

**Config key**: `drive_output_vtt_folder_id` (новий, optional). Fallback chain: `drive_output_vtt_folder_id → drive_output_full_folder_id → drive_output_folder_id`. Не обов'язковий — без нього VTT-файли упадуть у full-папку поряд з WAV.

**Файлові зміни**:
- [workflows/W3_Synthesize_v2.json](workflows/W3_Synthesize_v2.json) — додано 2 ноди + fan-out з Read Localizations Fresh (одна головна гілка `main[0]` тепер веде до двох таргетів: Download Segment WAV + Build VTT Per Lang). 20 нод тепер замість 18.
- [code_nodes/build_vtt_per_lang.js](code_nodes/build_vtt_per_lang.js) — нова mirror file.
- [docs/config_keys.md](docs/config_keys.md) — нова строка про `drive_output_vtt_folder_id` з fallback chain.
- [workflows/README.md](workflows/README.md) — оновлено node table з новими VTT-нодами (помічено як sibling-гілка до Download Segment WAV).

Rationale:
- **Reuse existing data**: вся інформація вже є у localizations row-ах, які зчитує Read Localizations Fresh. Не треба ні re-translation, ні re-timing — лише format conversion.
- **EN-aligned cues universally work**: тому що borrow-fix компенсує overshoot, в full WAV кожна мова починає сегмент на тому самому місці що EN. Один cue-timing fits all langs (не треба генерувати окремий VTT з audio-aligned timings для кожної мови).
- **Parallel branch, not serial**: VTT generation не залежить від WAV concat (читає тільки JSON). Виносити в окремий workflow було б over-engineering — два паралельних таргети з одного output port-у це native n8n pattern.
- **Fallback chain для folder ID**: graceful degradation — користувач може не задавати новий ключ і VTT файли підуть у full-папку. Якщо й її нема — у per-segment папку.

Tradeoffs:
- **Cue визначається EN slot-ом, не реальною тривалістю TTS**: коли дубльоване аудіо коротше за slot (silence padding в tail), субтитр залишиться на екрані під час тиші. Альтернатива (end = en_start_sec + real_duration_sec) сховала б субтитр коли голос замовкає — але для meditation з повільним темпом це може виглядати дивно (читач думає що сегмент закінчився, потім чує ще). Поточний підхід проще і безпечніше. Якщо появляться скарги — можна переключити через config-key.
- **Один VTT на мову, не cross-lang multi-track**: для YouTube/HTML5 player це означає 7 окремих файлів. Якщо знадобиться single SRT/VTT з мовними доріжками — це окрема фіча (не стандарт WebVTT, потребує WebVTT Regions або поза-стандартних тагів).
- **VTT файли містять ту саму mojibake-небезпеку як і інший Code-node output**, але оскільки ми пишемо через `Buffer.from(vtt, 'utf8')` напряму — байти на диску правильні UTF-8. Якщо ElevenLabs/Sonnet/Adapt видали mojibake-токени в `text_translated` (вони цього не роблять, бо Sheets зберігає чистий UTF-8) — це проявиться у VTT.

Conflict with prior decisions: жодних. Use-case-isolated nова фіча.

Verification:
- Smoke test з реальними DE рядками the_anchor: 4 cues, valid WebVTT format, точні таймінги.
- Після re-import у n8n: один повний прогон → у Drive `vtt/` папці має з'явитись 7 файлів `the_anchor_full_*.vtt`.
- Cross-check: cue timings у DE.vtt мають збігатись з ES.vtt (один і той самий EN timeline) — підтверджує що borrow compensation працює.

---

### 2026-05-20 — OPENAI_GPT5_CROSS_MODEL_EDITOR

Context: W2 translation pipeline до цього моменту повністю на Claude Sonnet 4.5 — і переклад, і self-QA (`Verify Translations`). Це **same-family self-review** — Sonnet перевіряє свій же output, з однаковими training biases. Систематичні сліпі плями моделі за визначенням не виявляються її ж self-review. Класична відповідь на цю проблему — cross-model judge: другий редактор з іншої сімейки моделей (OpenAI) ловить що Sonnet QA пропустив.

Decision: додано ноду `OpenAI Editor` (GPT-5) у W2, **між `Verify Translations` і `Adapt Translations`**. 4-шарова translation defense тепер виглядає так:

```
Extract Translations → Verify Translations (Sonnet self-QA)
                    → OpenAI Editor (GPT-5 cross-model second-pass)
                    → Adapt Translations (Sonnet CPS shorten)
                    → Update Sheet
```

**Роль — strict editor**: prompt-rule #1 = "If a translation is already clean, RETURN IT UNCHANGED. Do not modify wording, rhythm, or word choice just because you would phrase it differently. Style is a matter of taste; only intervene on objective issues you can name." Це primary lever проти over-correction. Як Verify Translations, охоплює три класи: false friends (з ES/PT/IT additions), formality drift (per-lang explicit address rules), ToV violations.

**Реалізація** ([workflows/W2_Translate_v2.json:OpenAI Editor](workflows/W2_Translate_v2.json)):
- Code-нода батчить items по 8 (так само як Verify), POST до `api.openai.com/v1/chat/completions`
- Model: `gpt-5`. `response_format: { type: 'json_object' }` структурно забезпечує JSON output.
- Auth: `Authorization: Bearer ${openai_api_key}` (з config sheet)
- EDITOR_SYSTEM = 4690 chars / ~1173 токени → вище 1024-token threshold для OpenAI auto-cache → batches 2-4 платять 50% за cached input
- Retry: 4 спроби з exponential backoff (2s/4s/8s). На final failure → empty corrections → items pass through з Verify-clean текстом (no silent data loss)
- Fail-fast: якщо `openai_api_key` відсутній у config → throws upfront, W2 зупиняється (no half-applied editorial)

**Місце вставки чому так**:
- AFTER Verify, BEFORE Adapt — Editor бачить QA-cleaned текст і не воює зі скороченнями Adapt
- Якщо було б AFTER Adapt — Editor міг би "un-shorten" текст, ламаючи timing budget що ретельно витриманий Adapt-ом
- Якщо було б BEFORE Verify — теряли б valuable Sonnet QA які OpenAI міг би випадково перетерти

Rationale:
- **Cross-model diversity**: різна тренувальна data, різні bias-патерни. Sonnet чудово ловить свої pattern-и в self-QA, але систематично пропускає те що відрізняється від його preferences. GPT-5 ловить інше.
- **Premium model вибраний свідомо**: на короткі meditation affirmations нюанси (warmth, register, idiom) важать більше за raw accuracy. GPT-5 краще handle-ить це ніж 4o.
- **Strict role не stylist**: рисик стиліста — переписує добрий Sonnet-переклад на свою альтернативну версію, не кращу, не гіршу, просто іншу. Це noise, не value. Strict-mode виключає це.
- **Same anti-pattern rules across both models**: value не в різному rulebook-у, а в різному reviewer-і. Обидва enforce те саме (false friends, formality, ToV), а cross-model перевірка ловить gaps в self-coverage.

**Cost expectation** (на typical 31-segment lesson):
- 4 batches × ~6-8K input tokens × $10/MTok GPT-5 = ~$0.30 input (без cache)
- З auto-cache на batches 2-4: ~$0.20 input
- Output ~3K tokens × 4 batches × $40/MTok = ~$0.50 output (mostly empty corrections → much less)
- Realistic: $0.10-0.20/lesson. Monitor після 3-5 lessons на platform.openai.com.

**Файлові зміни**:
- [workflows/W2_Translate_v2.json](workflows/W2_Translate_v2.json) — додано ноду `OpenAI Editor` (17 нод тепер замість 16), переписано connections `Verify Translations → OpenAI Editor → Adapt Translations` (раніше Verify → Adapt).
- [code_nodes/openai_editor.js](code_nodes/openai_editor.js) — новий mirror.
- [docs/config_keys.md](docs/config_keys.md) — додано `openai_api_key` row.
- [workflows/README.md](workflows/README.md) — додано рядки про Verify Translations і OpenAI Editor у W2 node table (раніше Verify взагалі не був задокументований у README, тільки в DECISIONS).

Tradeoffs:
- **Disagreement risk**: якщо GPT-5 "fixes" речі які Sonnet правильно обрав → quality regression. PRIMARY RULE про "return unchanged" — perşt захист. Якщо побачу що GPT-5 змінює >30% cells → strict-mode недостатньо strict; tighten EDITOR_SYSTEM.
- **Cost**: ~$0.10-0.20/lesson премія. На production load (5-10 lessons/day) — $30-60/month. Прийнятно за quality lift.
- **Single-point-of-failure**: якщо OpenAI API down або API key revoked, W2 зупиняється (fail-fast). Trade-off за data integrity — краще fail clean ніж silently pass through unedited.
- **Latency**: +5-15с до W2 wall time (4 sequential batches × ~3-5с per GPT-5 call). На повний pipeline це <5% addition.

Conflict with prior decisions: **extends** `TRANSLATION_QA_AND_ANTIPATTERN_RULES` (2026-05-19) — це той самий three-layer defense pattern, тепер з cross-model variation. Не конфліктує з `QA_SYSTEM_EXPANSION_FOR_CACHE_AND_COVERAGE` (2026-05-20) — навпаки, both QA stages ділять однакову rulebook структуру, що зменшує cognitive load на майбутні правки prompts.

Verification:
- Smoke test перед deploy: re-import W2.json, додати `openai_api_key` у config, прогнати the_anchor через W_Master. Очікувано: `text_translated` colonal у localizations sheet ≈ ідентичний попередньому прогону (бо the_anchor вже clean після Verify), або з minor differences тільки на segments де GPT-5 знайшов щось.
- Cache activation: на perший прогон у Code-ноду додати temporarily `console.log('usage:', JSON.stringify(resp.usage));`. Очікувано на batch 1: `prompt_tokens > 1000`; на batch 2+: `usage.prompt_tokens_details.cached_tokens > 1000` (OpenAI auto-cache).
- Rollback: `git revert <this-commit>` АБО disable OpenAI Editor node в n8n UI (connections route around — швидкий revert без commit).

---

### 2026-05-20 — ADAPT_TRANSLATIONS_PARALLEL_PER_LANG

Context: На урок `tc_practice_23_ph2-flow-the-ball` (21 сегмент movement-контенту з довшими перекладами) n8n кинув `Task execution timed out after 300 seconds` на ноді `Adapt Translations`. Дефолтний n8n task-runner timeout = 300с. Поточний код Adapt був повністю sequential: 21 сегмент × 7 мов × до 3 Claude-спроб = до 441 послідовних Claude-викликів × 3-5с = до 22 хвилин wall time. На щільному movement-уроці навіть з пропусками "if est ≤ budget break" набралось >300с.

Decision: розпаралелити 7 мов **в межах одного сегмента** через `Promise.all`. Сегменти залишаються sequential (між собою), але 7 мов одного сегмента стартують одночасно. 3-спроби shorten-loop усередині однієї мови залишаються sequential (кожна спроба refine-ить попередню, dependency інherent).

**Реалізація** ([workflows/W2_Translate_v2.json:Adapt Translations](workflows/W2_Translate_v2.json)):

```js
for (const item of $input.all()) {
  const langResults = await Promise.all(LANGS.map(async (lang) => {
    let text = item.json[`${lang}_text`] || '';
    let attempts = 0;
    // ... 3-attempt shorten loop (sequential within lang) ...
    return { lang, text, attempts };
  }));
  // ... merge langResults into out object ...
}
```

Smoke-test (7 langs × 50-100ms mock-Claude-calls): elapsed **95ms** проти ~525ms sequential → **~5.5x speedup**. Output structure ідентична попередній (всі `{lang}_text` і `{lang}_adaptation_attempts` колонки populated так само).

Rationale:
- **Concurrency level safe**: max 7 in-flight Claude requests at any moment (7 langs of 1 segment). Sonnet 4.5 Tier 1 RPM ≈ 500, тож 7 concurrent — well below. TPM (30K input / 8K output) тут не критичний бо кожен call ~500 input + ~300 output → 7 × 800 = 5.6K instantaneous, в межах limit-а.
- **Segments залишаються sequential**: обмежує global concurrency до 7. Якби розпаралелити ВСЕ (всі 21 × 7 = 147 одночасно), Tier 1 limit-и точно б розірвало.
- **Existing retry semantics зберігаються**: callClaude уже має 4 спроби з exponential backoff. Якщо парочка з 7 паралельних впала в rate-limit — retries їх підхоплять окремо.
- **Без env-var змін**: альтернатива (підняти `N8N_RUNNERS_TASK_TIMEOUT=900`) лише відсунула б проблему — на довшу лекцію (45+ сегментів) знов timeout. Parallelize вирішує root cause.

Очікувана нова wall-time на 21-сегментну movement-лекцію: 21 × ~15-20с (час найповільнішої з 7 паралельних) = **5-7 хвилин** замість попередніх >5 хв per language-batch. Безпечно вкладається в 300с timeout навіть на 45+ сегментів.

Tradeoffs:
- **7 concurrent calls збільшують peak TPM**: якщо TPM-buffer був тісним до цього, тепер тісніший. Якщо побачимо rate-limit-spikes у Anthropic dashboard → доведеться обмежити concurrency до 3-4 через semaphore (small extra code).
- **Order of completion non-deterministic** усередині сегмента: але output збирається назад через `for (const { lang, text, attempts } of langResults)` що йде в order of LANGS array → детермінований output порядок. Test-friendly.

Conflict with prior decisions: жодних. Pure performance refactor без зміни behavior. Output JSON ідентичний sequential-версії (smoke-test confirmed).

Files changed:
- `workflows/W2_Translate_v2.json` — `Adapt Translations` Code-нода: для-loop по LANGS замінено на `Promise.all(LANGS.map(...))`.
- `code_nodes/adapt_translations.js` — оновлений mirror.

Verification:
- Smoke-test mock-Claude (50-100ms latency): 7 calls completed in 95ms = 5.5x speedup over sequential 525ms estimate.
- JS syntax of all W2 Code nodes parses cleanly.
- Post-deploy: re-import W2.json у n8n, re-run failed lesson (`tc_practice_23_ph2-flow-the-ball`). Expected: Adapt стадія завершується за ~3-5 хв замість timeout. localizations sheet має ті ж 21 × 7 = 147 рядків з адаптованими перекладами.

---

### 2026-05-20 — W3_EMPTY_BUFFER_GUARD_AND_BUILD_FULL_DIAGNOSTICS

Context: Прогон `tc_practice_23_ph2-flow-the-ball` (21 сегмент, движення-контент) дав full WAVs по 44 байти (порожні WAV header без data). При цьому per-segment WAVs у Drive нормального розміру (KB-MB silence-padded), `N8N_BINARY_DATA_MODE=filesystem` виставлений, W3 execution показав SUCCESS. localizations sheet містить 147 рядків де **~93% мають `real_duration_sec=0`** (тільки ~10 з 147 з реальним TTS-аудіо), але `needs_attention=FALSE` всюди — система проковтала помилки і не попередила.

Root-cause-analysis:

**Bug 1 (критичний): `if (!pcm)` guard у `Check Timing + Pad` не ловить empty Buffer.**

Поточний код:
```js
const binaryData = $input.first().binary?.data;
let pcm = binaryData ? Buffer.from(binaryData.data, 'base64') : null;
// ...
if (!pcm) { /* silent placeholder, sets needs_attention=true */ }
```

Коли ElevenLabs TTS HTTP-нода падає (rate limit / 5xx) з `onError: continueRegularOutput`, n8n МОЖЕ передати item з `binary.data = { data: '', ... }`. Тоді:
- `binaryData` truthy (об'єкт існує)
- `Buffer.from('', 'base64')` = 0-length Buffer
- Empty Buffer **truthy в JS** → `if (!pcm)` НЕ спрацьовує
- Silent-placeholder branch (який ставить `needs_attention=true` + `lead=0/tail=0`) пропускається
- Normal pad-path виконується з порожнім pcm
- `pcmDuration(pcm) = 0` → `realDur = 0`
- Loops не fire (0 не > maxAllowed), expansion fires але claudeExpand/tts() теж падають → break без increment
- Final: `lead=naturalLead`, `tail=enDur`, `real=0`, `needs_attention=FALSE` — БРЕХНЯ
- Output WAV — silence з валідним header-ом. Per-segment файли у Drive KB-MB silence, фейково правильні

Це найгірша варіація бага — pipeline здається успішним а реально продукує тишу.

**Fix 1**: harden the guard в `Check Timing + Pad`:
```js
let pcm = binaryData?.data ? Buffer.from(binaryData.data, 'base64') : null;
if (pcm && pcm.length === 0) pcm = null;  // treat empty Buffer as failure too
```
Тепер empty Buffer → null → silent-placeholder branch → `needs_attention=true`. Користувач бачить flag і знає що треба ре-тригерити.

**Bug 2 (загадка, ще не з'ясовано): full WAVs = 44 байти попри коректні per-segment WAVs у Drive.**

Per-segment WAVs у Drive нормального розміру (від KB до MB silence-padded). Build Full Audio Per Lang мав би їх скачати, обрізати header, склеїти, видати ~8MB на мову. Але отримуємо 44-байтний WAV header без PCM data.

Можливі причини що залишилось перевірити на наступному прогоні (через нові діагностичні логи):
1. Download Segment WAV інколи "тихо" повертає item без binary slot (Drive API throttle / quota)
2. Filesystem-mode interaction робить `binData.data` недоступним як base64 у Code-ноді
3. Build Full filter `wavBuf.length <= 44` непередбачено матчить per-segment файли через якісь n8n-internal перетворення

**Fix 2**: додано діагностичні counters + warning logs у `Build Full Audio Per Lang`:
- `skippedNoBinary` (item без binary) і `skippedEmptyWav` (WAV ≤44 bytes) per-lang counter
- `console.warn` за кожен skip — видно у n8n executions log: `Build Full: de seg_005 skipped — WAV is 44 bytes (header-only or empty)`
- Counters також у output JSON для post-hoc inspection

Після наступного прогону подивитись n8n executions log для Build Full — буде ясно чи проблема в download-stage чи в filter-stage.

**Files changed**:
- `workflows/W3_Synthesize_v2.json` — Check Timing + Pad guard hardened (`if (pcm && pcm.length === 0) pcm = null;`); Build Full Audio Per Lang has new skip counters + per-skip warning logs
- `code_nodes/check_timing_and_pad.js` — mirror sync
- `code_nodes/build_full_audio_per_lang.js` — mirror sync

**Не змінено в цьому коміті** (свідомо):
- ElevenLabs TTS HTTP node `onError: continueRegularOutput` — залишено, бо зміна на `stopWorkflow` зломає всі majority-rate-limit-hit прогони хардкорно. Кращий шлях — bump tier на ElevenLabs АБО зменшити paralelism. Окреме рішення.
- Ніяких parallelism-обмежень у W3 не додано — спершу хочемо побачити що покажуть нові логи на наступному прогоні

**Verification** (next run):
1. Re-import W3.json у n8n
2. Прогнати `tc_practice_23_ph2-flow-the-ball` ще раз (або інший movement-урок)
3. Якщо TTS знов падатиме: тепер у localizations sheet `needs_attention=TRUE` на проблемних рядках → можна frustration-free ре-тригерити по rows where TRUE
4. Якщо повторно full WAV = 44 байти: глянути n8n execution log на Build Full Audio Per Lang — `console.warn` повідомлення скажуть точно чому всі items skipped
5. `skipped_no_binary` / `skipped_empty_wav` counters у Save Full to Drive item JSON — також доступні через post-execution inspection

---

### 2026-05-21 — W3_BATCHSIZE_GOTCHA_AND_RATE_LIMIT_HARDENING

Context: Прогон `tc_practice_23_ph2-flow-the-ball` (21 сегмент movement-контенту) видав audio файли з тишею у Drive output папці. Користувач зупинив pipeline побачивши порожні WAV. CSV localizations показав ~97% рядків з `real_duration_sec=0` + `needs_attention=FALSE` всюди. Користувач здогадався: "схоже, через паралелізацію запитів в елевенлабс стаються такі проблеми".

**Root cause знайдено**: нода `Loop Over Items` (splitInBatches v3) у W3 мала `parameters: { options: {} }` — без explicit batchSize. n8n splitInBatches v3 **default batchSize=10**. Це означає що ВСІ 10 items у кожному батчі проходять через downstream ElevenLabs TTS HTTP-ноду **одночасно**. Реальна паралельність 10× прихована у дефолті, ніде не явна. Користувач мав рацію.

Компаундні фактори:
- Check Timing + Pad може стріляти до 8 TTS-викликів на (segment × lang) item (1 initial + 3 shorten + 2 speed + 2 expand). На batchSize=10 в піку до 80 in-flight ElevenLabs запитів.
- ElevenLabs `onError: continueRegularOutput` ковтає 429-відповіді тихо.
- Вчорашній empty-buffer guard fix (`de1ba8c`) **не був re-import-нутий у n8n** (користувач підтвердив). Тому стара версія W3 без `if (pcm && pcm.length === 0) pcm = null` досі жила у n8n і не флагала фейли.

User є на **ElevenLabs Scale tier** (15+ concurrent nominal). 97% failure rate при batchSize=10 на Scale tier означає або стрикіший per-endpoint ліміт (TTS endpoint MAY мати нижчий threshold ніж base API), або account-level throttle, або quota issue. Незалежно від точного ElevenLabs ліміту, **жодна meditation-лекція не потребує більше 1-2 in-flight TTS запитів** — bounding concurrency до 1 структурно усуває цей failure mode.

Decision:

1. **Explicit `batchSize: 1`** у `Loop Over Items` ([workflows/W3_Synthesize_v2.json](workflows/W3_Synthesize_v2.json) `Loop Over Items.parameters.batchSize`). Гарантує serial обробку через TTS-path. Wall-time росте до ~25-35min для 147-item лекції — прийнятно.

2. **Rate Limit Guard wait 0.5s → 1.5s** ([workflows/W3_Synthesize_v2.json](workflows/W3_Synthesize_v2.json) `Rate Limit Guard.parameters.amount`). Cushion для ElevenLabs RPM ceiling коли Check Timing fire-ить retries послідовно. Додає +1s × 147 = ~2.5min до wall time.

Rationale:
- **Корекція дефолту проти throughput**: на reliably-failing pipeline тribute throughput не варто. Краще пройти повільніше і повністю, ніж зразу.
- **Чому batchSize=1 а не 3-5**: даже на Scale tier 10× concurrent ламається. Не знаємо точну межу. batchSize=1 гарантовано працює і дає clear signal якщо problem зберігається (тоді concurrency — НЕ root cause; вірогідно quota/key).
- **Wait 1.5s — не 0.5s, не 3s**: 0.5 виявився замало (run з'їв usage spike), 3 — overkill для Scale tier. 1.5 — emergency-conservative defaultsidered.
- **Жодних code-змін у Code-нодах**: вчорашній empty-buffer guard + Build Full diagnostics уже на диску, чекають re-import. Не дублюємо роботу.

Tradeoffs:
- **Wall time growth**: 25-35min на лекцію (vs 20m раніше). Якщо стане незручно — повертаємо batchSize=2-3 в окремому commit після підтвердження що concurrency справді була проблемою.
- **n8n UI behavior**: коли user відкриває Loop Over Items у редакторі тепер бачить batchSize=1 explicitly. Це і виховальна користь — gotcha видно явно, не дефолтом.
- **Inner-loop parallelism лишається**: Check Timing шорт/expand retries послідовні per item, але кожен item-обробка все одно 8 TTS calls в гіршому випадку. На batchSize=1 це 8 sequential calls per (segment × lang) → ще одна минута per problem segment. Acceptable.

Conflict with prior decisions: жодних. Доповнює `MEMORY_REFACTOR_W3_BUILD_FULL_AFTER_OOM_KILL` (2026-05-19) і `W3_EMPTY_BUFFER_GUARD_AND_BUILD_FULL_DIAGNOSTICS` (2026-05-20). Кожен з них шар захисту, тепер додався concurrency bound.

Files changed:
- `workflows/W3_Synthesize_v2.json` — `Loop Over Items.parameters.batchSize=1`, `Rate Limit Guard.parameters.amount=1.5`. Дві мікроправки.

Critical user-action item (одноразово):
- **Re-import W3.json у n8n.** Без цього і `batchSize=1` фікс, і вчорашній empty-buffer guard, і Build Full diagnostics просто лежать на диску і не впливають на n8n state. Поточний прогон ламається саме через це — n8n досі тримає версію до `de1ba8c`.

Verification:
- Re-import W3.json → re-run tc_practice_23_ph2-flow-the-ball → у localizations sheet `real_duration_sec > 0` на ~всіх рядках; якщо десь зберігається 0 → `needs_attention=TRUE` (нарешті flag спрацював); файли у Drive output мають голос.
- Якщо ≥50% рядків досі real=0 при batchSize=1 → concurrency НЕ корінь; перевіряти ElevenLabs dashboard на quota / API key status (план кроку 5 у Verification).

Future work (не зараз):
- Resumable W3 (skip-if-real_duration>0) — відкладено за explicit user request. Корисно щоб не перепрогонувати весь лесон коли треба тільки fix 2-3 сегменти.
- Параметризація batchSize через config sheet — якщо знайдемо безпечний higher batchSize-value, винесемо в config щоб тюнити без re-import.

---

### 2026-05-21 — W3_TIGHTEN_PCM_GUARD_FROM_ZERO_TO_100MS_THRESHOLD

Context: Після `a60c7c2` (batchSize=1 + Wait 1.5s) і re-import-у в n8n, прогон знову дає `real_duration_sec=0` + `needs_attention=FALSE` на всіх рядках + audio-файли у Drive нормального розміру (438KB) але silence-only всередині. Тобто фікс batchSize не допоміг, і empty-buffer guard `de1ba8c` не спрацьовує.

**Root cause** (нарешті точна): ElevenLabs повертає **HTTP 200 з мікроскопічним body** (~50-300 байтів) — найімовірніше JSON error blob, redirect, або partial response. n8n materializes це як binary з невеликим, але **не нульовим** payload. Тоді:

- `binaryData?.data` truthy (string з base64)
- `Buffer.from(base64, 'base64')` → Buffer з кількома сотнями байтів (декодуючи JSON-text як bytes)
- `pcm.length === 0` → false → попередній guard не firing
- `pcmDuration(pcm) = pcm.length / 44100 ≈ 0.005s` → `toFixed(3) = "0.005"` АБО для ще меншого buffer-а → "0.000" → parseFloat = 0
- В sheet записується `real_duration_sec: 0`
- Normal pad-path виконується: lead+empty+tail silence WAV
- `needs_attention: FALSE` бо silent-placeholder branch не firing

Виправлення:
1. **Поріг 100ms PCM** (= 4410 байтів @ 22050Hz × 2BPS). Будь-який buffer менше за це треба вважати failure → pcm = null → silent-placeholder branch фірить → needs_attention=TRUE.
2. **Diagnostic console.error** при дропі під поріг — preview перших 200 байтів decoded content. Дозволяє побачити що саме ElevenLabs повертає (JSON error blob? rate-limit msg? empty?). Видно у n8n executions log.
3. **Окремий діагностичний `console.error`** коли `binaryData?.data === undefined` (HTTP node взагалі не attached binary, тобто `onError: continueRegularOutput` повністю проковтав запит). Розрізняє два failure modes.

Code-change ([workflows/W3_Synthesize_v2.json](workflows/W3_Synthesize_v2.json) `Check Timing + Pad`):

```js
const MIN_VALID_PCM_BYTES = 4410;  // 0.1s × 22050 × 2
if (pcm && pcm.length < MIN_VALID_PCM_BYTES) {
  const preview = pcm.length > 0
    ? Buffer.from(binaryData.data, 'base64').toString('utf8', 0, Math.min(200, pcm.length))
    : '(empty)';
  console.error(`TTS response too small for ${segment_id}_${lang}: ${pcm.length} bytes (< ${MIN_VALID_PCM_BYTES} threshold). Content preview: ${JSON.stringify(preview)}`);
  pcm = null;
}
```

Rationale:
- **100ms threshold**: навіть найкоротший склад у TTS ~150ms, тож 100ms — безпечний floor. Меньше — точно error response, не аудіо.
- **Чому diagnostic preview**: без нього ми досі guessing що ElevenLabs повертає. З prev-200-chars видно: `{"error":"rate_limit"}`, або `{"message":"quota exceeded"}`, або щось ще. Це дасть ROOT CAUSE upstream.
- **Залишаємо guard навіть з batchSize=1**: bound concurrency допомагає АЛЕ якщо ElevenLabs має globally-bad day (quota issue), все одно треба правильно flag-ити невдачі.

Tradeoffs:
- **False positives**: якщо ElevenLabs реально повертає короткий валідний PCM (~50ms TTS), цей guard виставить needs_attention=TRUE даремно. На практиці — мінімальний risk; типовий segment ≥1s аудіо.
- **Diagnostic spam**: на повному фейлі (всі 147 items broken) лог буде шумним. Прийнятно для діагностики; після з'ясування root cause можна зменшити verbosity.

Conflict with prior decisions: доповнює `W3_EMPTY_BUFFER_GUARD_AND_BUILD_FULL_DIAGNOSTICS` (2026-05-20) і `W3_BATCHSIZE_GOTCHA_AND_RATE_LIMIT_HARDENING` (2026-05-21). Це третій layer захисту — структурно той самий fix-pattern (guard + log + needs_attention flag) але з реалістичнішим threshold.

Files changed:
- `workflows/W3_Synthesize_v2.json` — Check Timing + Pad guard tightened to 100ms threshold + diagnostic console.error
- `code_nodes/check_timing_and_pad.js` — mirror sync

User-action item (КРИТИЧНО):
- Re-import W3.json у n8n ЩЕ РАЗ (вибач, попередній re-import з batchSize fix теж зробив, тепер потрібен другий — або просто видалити старий і імпортувати свіжий)
- Прогнати ще раз → у localizations sheet тепер БУДЕ `needs_attention=TRUE` на проблемних рядках
- У n8n executions log → дивитись на `console.error` повідомлення з ноди Check Timing + Pad — там буде `TTS response too small for X: N bytes. Content preview: "..."` — це покаже точну ElevenLabs відповідь
- Поділитись цим preview — дасть точний root cause (quota? rate? key issue? API change?)

Future work (після з'ясування ElevenLabs відповіді):
- Якщо JSON error з конкретним кодом → handler у `tts()` retry-loop для exponential backoff на цьому коді
- Якщо 200-with-empty-body → треба переключати ElevenLabs HTTP node на `onError: stopWorkflow` (приймемо швидкий fail замість мовчазного silence)
- Якщо HTTP-level помилка проковтнута без binary → треба міняти `onError` на upstream node

---

### 2026-05-21 — N8N_FILESYSTEM_BINARY_ROOT_CAUSE_FIX

Context: Останній прогон з `0bbe5f2` нарешті дав точну діагностику в `warning` полі:

```
{"hasBinarySlot":true,"hasBinaryDataObj":true,
 "binaryDataKeys":["mimeType","fileType","data","id","fileSize"],
 "hasDataField":true,"dataFieldType":"string","dataFieldLen":13,
 "binaryMimeType":"audio/pcm","binaryFileName":null,
 "pcmBytes":9,"contentPreview":"~)^+-zo"}
```

**ROOT CAUSE finally identified**: ключі `id` і `fileSize` у `binaryDataKeys` + `dataFieldLen=13` — це класичний **n8n filesystem-mode pattern**. При `N8N_BINARY_DATA_MODE=filesystem`:
- `binary.data.data` = **маленький placeholder/reference** (13 символів), НЕ base64 контент
- `binary.data.id` = filesystem reference UUID до реального файлу на диску
- Реальні байти доступні ТІЛЬКИ через `await this.helpers.getBinaryDataBuffer(itemIndex, 'data')`

Усі наші Code-ноди робили `Buffer.from(binary.data.data, 'base64')` — це декодувало placeholder як base64 → 9 байтів сміття → `pcmDuration ≈ 0.0002s` → rounds to 0 → silent placeholder branch → silence WAV.

**Це пояснює ВСІ симптоми попередніх кількох днів**:
- Today's silent audio output + `real_duration=0` everywhere
- Yesterday's "Build Full WAVs are 44 bytes" mystery (точно та сама проблема в другій Code-ноді: Build Full also reads `binary.data.data` directly)
- Чому до 2026-05-19 (до додавання `N8N_BINARY_DATA_MODE=filesystem` per commit 7090296) все працювало — у inline mode `binary.data.data` ДІЙСНО containing base64 content
- Чому ElevenLabs API logs показували нормальні запити з валідними response-ами — TTS реально працював, ми просто не доходили до байтів

Якби з самого початку ми мали діагностичний log для `binary.data.id` чи `binaryDataKeys` — побачили б це ще 2 дні тому. Урок: при будь-якій незрозумілій binary-проблемі — насамперед dump full `binary.data` structure, не тільки `data` field.

Decision: переписати обидві Code-ноди на правильний n8n filesystem-aware pattern.

**Fix 1 — Check Timing + Pad** ([workflows/W3_Synthesize_v2.json](workflows/W3_Synthesize_v2.json)):

```js
let pcm = null;
if (binaryData) {
  try {
    pcm = await this.helpers.getBinaryDataBuffer(0, 'data');
    failureDiag.pcmBytes = pcm?.length || 0;
    // ... preview logic ...
  } catch (e) {
    failureDiag.bufferLoadError = e.message;
  }
}
```

itemIndex = 0 бо Loop Over Items з `batchSize=1` гарантує одне item per Code-execution.

**Fix 2 — Build Full Audio Per Lang** ([workflows/W3_Synthesize_v2.json](workflows/W3_Synthesize_v2.json)):

```js
// На початку:
const indexMap = new Map(items.map((it, idx) => [it, idx]));

// У циклі:
const originalIdx = indexMap.get(e);
const wavBuf = await this.helpers.getBinaryDataBuffer(originalIdx, 'data');
```

Build Full ітерує `items.filter().sort()` — потребує оригінальний `itemIndex` у `$input.all()` для виклику `getBinaryDataBuffer`. Map (item reference → original index) це вирішує.

**Fix 3** — `tts()` inline helper в Check Timing + Pad **залишається БЕЗ змін**. Він робить прямий `this.helpers.httpRequest({ encoding: 'arraybuffer' })` і отримує Buffer напряму через `Buffer.from(resp.body)` — це bypass-ить filesystem-mode storage. Цей шлях завжди працював коректно. Це пояснює чому `seg_005_fr` мав success вчора (expansion_attempts=1 means tts() retry fire-ив, отримав реальний Buffer через httpRequest helper).

Rationale:
- **Корінь проблеми ясний, fix очевидний**: `getBinaryDataBuffer` — задокументований n8n API для саме цього випадку. n8n docs це прямо рекомендують для filesystem-mode workflows.
- **Жодних tradeoffs**: працює і в inline, і в filesystem mode. `getBinaryDataBuffer` сам резолвить storage backend.
- **3 layer-и захисту що додали за останні дні стають коректними**: empty-Buffer guard (тепер catch tiny errors), 100ms threshold (тепер catch real ElevenLabs errors), batchSize=1 (тепер reliable). Усі правильно flag-итимуть needs_attention=true коли потрібно, але **тепер нарешті НЕ FAIL-итимуть** на normal-success path.
- **Diagnostic improvements залишаються**: failureDiag в warning полі, console.warn у Build Full skip cases — на майбутнє якщо ElevenLabs реально падатиме.

Conflict with prior decisions: complementary до `MEMORY_REFACTOR_W3_BUILD_FULL_AFTER_OOM_KILL` (2026-05-19) — той decision ввімкнув filesystem mode (`N8N_BINARY_DATA_MODE=filesystem`), що вирішило memory issue АЛЕ silently зламало binary access у Code-нодах. Тепер обидва concerns закриті: filesystem mode active + Code-ноди correctly use filesystem-aware API.

Files changed:
- `workflows/W3_Synthesize_v2.json` — Check Timing + Pad uses `getBinaryDataBuffer(0, 'data')`; Build Full Audio Per Lang uses indexMap + `getBinaryDataBuffer(originalIdx, 'data')`
- `code_nodes/check_timing_and_pad.js` — mirror sync
- `code_nodes/build_full_audio_per_lang.js` — mirror sync

Verification:
- Re-import W3.json у n8n (n-та раз; обіцяю — це останній фікс для цього зашморгу)
- Прогнати W3 на test_small (1-3 сегменти) — переконатись що `real_duration_sec > 0` і файли мають голос
- Прогнати full lesson tc_practice_23_ph2-flow-the-ball — повна валідація
- Очікувано: ~100% success rate, audible voice, multi-MB full WAVs (не 44 bytes)
- Якщо все ОК → опціонально знизити `Rate Limit Guard` назад з 1.5s на 0.5s (більше не треба cushion, batchSize=1 + correct binary access вирішує) — окремий commit

Lessons learned:
1. **Diagnostic-first debugging**: 3 дні chasing симптоми (empty pcm, empty WAVs, batchSize, rate limits) поки не дамповнули повну `binary.data` structure. Урок — при `binary` проблемах ВІДРАЗУ dump `Object.keys(binary.data)` and check for filesystem-mode markers (`id`, `fileSize`).
2. **n8n filesystem mode docs gotcha**: документація n8n говорить про `getBinaryDataBuffer` але приховує що `binary.data.data` змінює semantics. Easy trap для Code-нод-розробників.
3. **Cross-decision dependency**: enabling filesystem mode requires Code-нод-аудит. Якщо є nodes що читають `binary.data.data` directly — вони ламаються. Слід було ловити це ще під час 7090296 (memory refactor), але без e2e тесту не помітили.

---

### 2026-05-21 — W2_BOUNDED_CONCURRENT_BATCHES

Context: Після стабілізації W3 (всі silent-audio bugs закриті у `9d2b299`), наступне вузьке місце — W2 latency на великих файлах. Користувач спостерігає:
- 2-сегментна лекція: ~1m 4s wall time (переважно GPT-5 latency на one batch + Wait 4s + Sonnet calls)
- Великі файли (~50+ сегментів) **впираються у n8n's 300s task-runner timeout** в одній з QA Code-нод

Користувач НЕ хоче просто бампати `N8N_RUNNERS_TASK_TIMEOUT`. Це band-aid, не fix. Шукаємо elegant approach.

Корінь проблеми: `Verify Translations` і `OpenAI Editor` обидва процесять батчі sequential через `for (const batch of batches) { await callAPI(...) }`. Для 50-сегментної лекції (≈7 батчів при QA_BATCH_SIZE=8):
- Verify (Sonnet 4.5, ~12s/batch): 7 × 12 = ~84с sequential
- OpenAI Editor (GPT-5, ~30s/batch — slow on JSON-mode batched output): 7 × 30 = **~210с sequential**

GPT-5 sequential alone з'їдає majority of 300s budget. Плюс Translate, Adapt, sheet I/O — easy timeout.

Decision: **bounded-concurrent batch processing** — обробляти CHUNK=3 батчі паралельно через Promise.all, sequential між chunk-ами. Existing retry/backoff в callQA/callEditor поглинає occasional 429s.

**Реалізація** ([workflows/W2_Translate_v2.json](workflows/W2_Translate_v2.json), обидві Code-ноди):

```js
const CHUNK = 3;
const corrections = {};
async function runOneBatch(batch) {
  // build userMap, body, call API, parse
  return partialCorrections;
}
for (let i = 0; i < batches.length; i += CHUNK) {
  const slice = batches.slice(i, i + CHUNK);
  const partial = await Promise.all(slice.map(b => runOneBatch.call(this, b)));
  for (const p of partial) Object.assign(corrections, p);
}
```

**Math на 7-batch лекції**:
- Verify: 84s → 36s (3 chunks × 12s)
- OpenAI Editor: 210s → 90s (3 chunks × 30s)
- Combined W2 wall time: easily fits in 300s

Rationale:
- **Cap=3 не unlimited Promise.all**: OpenAI Tier 1 = ~30K TPM на GPT-5. 7 паралельних × 6K input = 42K → 429. 3 паралельних × 6K = 18K — safe.
- **Anthropic Sonnet 4.5 output 8K TPM** на Tier 1: 3 концурентних × ~3K output у тому самому 10s-вікні = 9K — borderline але retry-backoff (4 спроби, 2s/4s/8s) absorb-ить.
- **Existing retry logic не змінюємо**: callQA/callEditor вже мають 4 спроби з exponential backoff. Параллельні запити при 429 retry-ять незалежно — natural rate-limit governor.
- **Не парлелізуємо Adapt Translations**: вже має 7-lang parallel per segment (Promise.all всередині). Outer segment loop sequential → max 7 concurrent Claude calls на будь-який момент. Acceptable.
- **Не парлелізуємо Claude Translate** (HTTP node): n8n item-iteration semantics різні від Code-node loops. Має own retry. Less obvious win, more invasive. Skip for now.

Tradeoffs:
- **Prompt cache hit rate drops**: Anthropic ephemeral cache і OpenAI auto-cache obидва relyю на sequential ordering для cache hits. Параллельні chunk-and 1-3 batches миссують cache бо all fire до того як first завершила створення. Estimated extra cost ~$0.05/big lesson. Acceptable trade.
- **No effect on 2-segment 1m 4s case**: тільки 1 batch — Promise.all no-op. Якщо user пізніше захоче speed up small files, можемо розглянути gpt-5-mini для OpenAI Editor (3-5x faster, deg quality drop).
- **OpenAI Tier 1 actual limits unknown**: my estimate 30K TPM може бути off. Якщо 3-concurrent тригерить 429 кожен прогон → drop CHUNK to 2 в follow-up.

Conflict with prior decisions: complements `ADAPT_TRANSLATIONS_PARALLEL_PER_LANG` (2026-05-20) — той fix паралелізував within-segment (7 langs concurrent), цей паралелізує within-stage (3 batches concurrent). Узяті разом: для 50-seg лекції W2 проходить за ~3 хв замість timeout-у.

Files changed:
- `workflows/W2_Translate_v2.json` — Verify Translations і OpenAI Editor batch loops refactored to chunked Promise.all
- `code_nodes/openai_editor.js` — mirror sync

User-action:
- Re-import W2.json у n8n
- Verification: 2-seg lesson (test4) має пройти за ~same 1m 4s (1 batch, нема speedup, нема regression). 20+ seg lesson має пройти за 2-3хв замість timeout.

Verification:
- JS syntax of W2 Code nodes parses cleanly
- Structural check: CHUNK=3 + Promise.all(slice.map(...)) present in both nodes ✓
- На live test після re-import: cost dashboard має показати slightly менше cached-input savings (extra ~$0.05 на big lesson) — acceptable

Future work:
- gpt-5-mini для OpenAI Editor як спосіб прискорити single-batch latency (small files)
- Якщо великі лекції (100+ segs) стануть нормальними — додати dynamic CHUNK sizing based on batch count і/або rate-limit-aware semaphore замість fixed cap
