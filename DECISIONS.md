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
