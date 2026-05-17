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
