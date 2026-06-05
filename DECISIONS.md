# Decisions Log

## Decisions log

---

### 2026-06-05 — MOVEMENT_CUES_ALLOW_BOUNDED_BREATH_BORROW

**Контекст**: у першому 11-хв прогоні сегменти `sleep_long_seg_036/037/038` («Inhale» / «Hold» / «Exhale») флагнулися `needs_attention=TRUE` по всіх 7 мовах (`shorten_retries_in_synthesize=3`, `final_speed=1.2`, аудіо hard-truncated). Причина: це **movement**-сегменти (`movement_keywords` = inhale/hold/exhale), а movement-сегменти були **строго залочені на `en_duration_sec`** ([check_timing_and_pad.js](code_nodes/check_timing_and_pad.js): `canBorrow = ... && !hasMovement`) — не могли breath-borrow. Але їхні EN-слоти крихітні (0.64 / 0.96 / 0.72с), тоді як переклади — повні фрази (~1.5–2.5с) → shorten/speed-up/truncate → обрізане, ламане аудіо. Це спадщина `PERMISSIVE_BORROW_FOR_NONMOVEMENT_SEGMENTS` (2026-06-04), який свідомо лишив movement строгим «для відео-синку».

**Спостереження по даних**: вільне місце для цих cue майже все **трейлінгове** — дихальна пауза йде ПІСЛЯ слова: `gap_after` = 5.3с / 7.4с / 10.9с відповідно. Тобто bounded трейлінг-borrow дає фразі стартувати точно на EN-cue і тягнутись у паузу — природно для дихальної інструкції, onset лишається EN-вирівняним.

**Рішення** (audio-first, підтверджено користувачем — жорсткого відео-синку немає): дозволити movement-сегментам breath-borrow у трейлінг-тишу, але з окремим, тіснішим капом `movement_borrow_max_sec` (default 2.0; `0` = відновити строгий lock). Зміна ізольована в [code_nodes/check_timing_and_pad.js](code_nodes/check_timing_and_pad.js):
```js
const hasGap     = enDur > 0 && slot > enDur;
const canBorrow  = hasGap && (!hasMovement || MOVEMENT_BORROW_MAX > 0);
const maxAllowed = !canBorrow  ? enDur
                 : hasMovement ? Math.min(slot, enDur + MOVEMENT_BORROW_MAX)
                 :               slot;
```
Non-movement поведінка не змінена (повний borrow до `effective_slot_sec`).

**Чому low-risk**: borrow-гілка вже існує і працює для всіх non-movement сегментів. Movement-cue тепер потрапляє в наявну гілку `enDur < realDur <= maxAllowed` → `borrowed_sec = realDur − enDur` (трейлінг), `leadSec = naturalLead`, `tailSec = 0`, **needs_attention НЕ ставиться** → флаги зникають. Concat-інваріант `sum(per-seg_{lang}.wav) == full_{lang}.wav` зберігається без змін: `Trim Lead For Sequence` тримить лідер наступного сегмента на `borrowed_sec` поточного — це працює для movement-borrow ідентично. `Expand TTS Jobs` змін не потребує (він і так рахує `effective_slot_sec` без movement-гейту; кап 2.0 вже стоїть через `max_borrow_per_segment_sec`). Phase 2 movement-гейту не має і стосується under-fill, а не цих over-fill кейсів.

**Чому НЕ centered/symmetric borrow** (відхилений альтернативний варіант): центрування фрази на EN-слоті потребувало б НОВОЇ leading-borrow логіки, якої concat-шар не моделює (`borrowed_sec` — лише трейлінг), + ризик cross-lang drift; а для цих сегментів вільне місце майже все праворуч → виграш мінімальний. Трейлінг також КРАЩЕ для будь-якого відео-синку (onset збігається з EN), на відміну від центрування (зсуває onset раніше EN).

**Files changed**:
- `code_nodes/check_timing_and_pad.js` — `MOVEMENT_BORROW_MAX` const + relaxed gate (synced у W3 JSON через `npm run sync`)
- `docs/config_keys.md` — новий ключ `movement_borrow_max_sec`; уточнено нотатку `short_seg_threshold_sec`

**Sheet**: змін не потрібно — код дефолтить 2.0; рядок `movement_borrow_max_sec` додавати лише для override (напр. `0`).

**Conflict with prior decisions**: амендить `PERMISSIVE_BORROW_FOR_NONMOVEMENT_SEGMENTS` (2026-06-04) — той лишив movement строгим; тепер movement має bounded borrow (реверсибельно через config). Концептуальне продовження лінії `CONDITIONAL_BREATH_BORROW_FOR_SHORT_SEGMENTS` (2026-05-19) → `PERMISSIVE_BORROW` (2026-06-04) → цей запис.

---

### 2026-06-05 — W3_DECOUPLED_FROM_W_MASTER_PLUS_W2_NONFATAL_RECOVERY

**Контекст (інцидент)**: перший повний прогін 11-хв / 88-сегментної лекції (`sleep_long_seg_*`, 7 мов = 616 клітинок) через `W_Master` виявив три проблеми:
1. `W2 Extract Translations` кинув hard-throw на `sleep_long_seg_084` — Sonnet 4.6 «тихо» викинув сегмент з батчу, і 3 спроби auto-recovery теж повернули порожньо (транзієнтне перевантаження). `W_Master` retry перезапустив **весь** W2, щоб відновити 1 сегмент.
2. `W_Master → Execute W3` (`waitForSubWorkflow:true`, без `executionTimeout`) синхронно чекав W3 ~1.5 год → global timeout n8n → помилка «Execute W3 … item at index 0». Дитина-W3 лишилась осиротілою і крутилась далі. **Фінальний Slack** (needs_attention % + лінки) так і не відправився, бо ланцюг сповіщення жив **лише в W_Master** після `Execute W3`.
3. W3 — НЕ нескінченний цикл: обидва `splitInBatches` (`Loop Over Items`, `Loop Phase 2`) штатні (out0=done, out1=loop), обидві done-гілки спрацювали. W3 просто **сильно серійний** (616 TTS через batchSize=7 + по 1 `appendOrUpdate`/рядок + 616 Drive-аплоадів + 0.2с guard + Phase 2 Opus + фінальна збірка), що для лекції такого розміру дає ~1.5–3 год.

**Рішення** (три пов'язані зміни; перф-рефактор W3 свідомо відкладено — див. PLAN.md):

1. **Decouple W_Master↔W3** ([workflows/W_Master.json](workflows/W_Master.json), [workflows/W3_Synthesize_v2.json](workflows/W3_Synthesize_v2.json)): `Execute W3` → `waitForSubWorkflow:false`. W_Master стартує W3 і одразу завершується (Success), більше не тримає багатогодинне синхронне очікування → зникає «index 0» timeout, і Drive-тригер вільний для наступного файлу. Сповіщення **перенесено в W3**: нові ноди `Build Slack Message` (порт логіки з W_Master, runOnceForAllItems, читає `Read Config` + `Read Localizations Fresh 2` + `Get Params.lesson_id`) → `Slack Notify` (slackApi cred `ogtQ2NONkRrXj2kl`), під'єднані після `Save Full to Drive` (найдовша гілка → VTT уже збережено). У W_Master ланцюг `Pass Lessons (after W3) → … → Slack Notify` від'єднано (зв'язок `Execute W3 → Pass Lessons (after W3)` видалено); самі ноди лишаються на canvas (dormant, layout збережено). Safety net: `executionTimeout=14400` (4 год) у settings W3, щоб довга дитина не вбивалась global default-ом.

2. **W2 silent-drop тепер non-fatal** ([code_nodes/extract_translations.js](code_nodes/extract_translations.js)): per-segment recovery 3→5 спроб з довшим backoff (2/4/8/16с). При фінальному фейлі **більше не кидаємо** (`throw` → `console.error`): сегмент емітиться з порожніми `*_text` (downstream-safe — verify лишає original, adapt/formality `if(!text) continue`, Update Sheet auto-map по `segment_id`), оператор бачить порожні клітинки в `segments` і перезапускає W2/W_Regen точково. Прибирає сценарій, де 1 дроп змушує `W_Master.maxTries:2` ретранслювати всі 616 клітинок. Уточнює `W2_EXTRACT_AUTO_RECOVERY_FOR_DROPPED_SEGMENTS` (2026-05-31), який запровадив recovery, але лишав hard-throw на фіналі.

3. **Timeouts на W3 Drive HTTP** ([workflows/W3_Synthesize_v2.json](workflows/W3_Synthesize_v2.json)): `Phase 2: Drive Update` і `Save Trimmed Audio to Drive` отримали `options.timeout=90000` + `retryOnFail:true, maxTries:3, waitBetweenTries:3000` (раніше — без timeout, ризик зависання на застряглому Drive-виклику).

**Rationale**: користувач явно обрав «розчепити W_Master↔W3» замість перф-фіксу W3 → decouple робить багатогодинний W3 терпимим (W_Master не заручник), а сповіщення лишається інформативним, бо тепер походить з W3 з реальними результатами. Non-fatal W2 узгоджується з тим самим принципом «один збій не валить увесь прогін».

**Files changed**:
- `code_nodes/extract_translations.js` — 5 спроб, non-fatal blank-emit (synced у W2 JSON через `npm run sync`)
- `workflows/W3_Synthesize_v2.json` — `executionTimeout`, 2× HTTP timeout+retry, нові `Build Slack Message` + `Slack Notify`
- `workflows/W_Master.json` — `Execute W3.waitForSubWorkflow=false`, видалено зв'язок до notify-ланцюга

**Conflict with prior decisions**: переносить Slack-поверхню з `SLACK_SURFACE_REDESIGN_NEEDS_ATTENTION_REGEN_BUTTON` (2026-06-03) з W_Master у W3 (та сама розмітка повідомлення/лінки, інший хост-воркфлоу). Уточнює `W2_EXTRACT_AUTO_RECOVERY_FOR_DROPPED_SEGMENTS` (2026-05-31).

---

### 2026-06-04 — LLM_SANITIZER_DUPLICATION_WONTFIX

Context: P1-кандидат на «уніфікацію» двох LLM-санітайзерів — `sanitizeClaudeOutput` (`code_nodes/adapt_translations.js`, W2) і `sanitizeLLMOutput` (`code_nodes/check_timing_and_pad.js`, W3). Початкова гіпотеза аудиту: «2 несумісні версії».

Перевірка спростувала гіпотезу: функції **логічно ідентичні** — однаковий ланцюжок (trim → перший рядок до `\n` → strip `*_` → strip лапки `"'\`` → strip trailing parenthesized meta `(… char/cannot/already/…)`). Різниця лише в назві та одному коментарі. Жодного бага чи дивергенції поведінки немає.

Decision: **wontfix.** Не об'єднувати.

Обґрунтування:
- n8n code-ноди ізольовані в рантаймі — спільний модуль неможливий. Єдиний шлях «уніфікації» — build-time inline injection спільного сніпета через sync-скрипт.
- Це рівно та негативна асиметрія ризику, яку ми відхилили в `SYNC_INFRASTRUCTURE_EXTENDED_TO_W3_W_REGEN` (альтернатива «Build-time inline injection для DRY»): один баг у централізованому helper ламає переклад у 2 нодах × 7 мов; виграш — ~12 LOC.
- Якщо логіка колись розійдеться навмисно (різні провайдери — Claude vs Gemini можуть давати різний обрамлюючий шум), окремі копії — це фіча, а не борг.

Якщо в майбутньому з'явиться 3-тя копія або потрібна буде складніша спільна логіка — переглянути; поки що дві ізольовані ідентичні копії дешевші за будь-яку централізацію.

---

### 2026-06-04 — SYNC_INFRASTRUCTURE_EXTENDED_TO_W3_W_REGEN

Context: Аудит canonical `.js` файлів vs jsCode в workflow JSON знайшов 3 розбіжності. (1) `code_nodes/check_timing_and_pad.js` був на 970 chars більший за JSON — `LAST_SEGMENT_TRAILING_SILENCE_SEPARATION` consumer-side фіча (destructure `tail_audio_silence_sec`, `extraTrailSec` fold) була написана в .js, документована в DECISIONS, але **НЕ deployed у JSON** — попередній sync script (`scripts/sync_w2_jscode.js`) покривав лише 6 W2 нод. (2) `code_nodes/regen_synthesize.js` був на 561 char менший за JSON — у JSON містилася актуальна tri-state логіка (REVIEW yellow на success, Kyiv timezone, empty `return []`), яка прийшла з пізнішого commit `5c32db0`, але reverse-sync у .js не зроблено. (3) `code_nodes/build_vtt_per_lang.js` — тривіальна whitespace розбіжність (1 char).

Decision: розширити sync-інфраструктуру на всі workflows і додати foundation для безпечних майбутніх edits.

1. **Replace `scripts/sync_w2_jscode.js` → `scripts/sync_jscode.js`**: per-workflow node map покриває 19 нод (W1×1, W2×9, W3×6, W_Regen×3). Idempotent — re-run на синхронізованому стані = no-op. Скрипт — file→workflow напрямок (не reverse).

2. **Resolve 3 divergences**:
   - `check_timing_and_pad.js`: **forward-sync .js → JSON** (deploy trailing-silence consumer-side). Підтверджено через DECISIONS.md `LAST_SEGMENT_TRAILING_SILENCE_SEPARATION` запис + verification, що Expand TTS Jobs вже висилає поле. Legacy lessons → graceful fallback (`tail_audio_silence_sec=0` → no-op).
   - `regen_synthesize.js`: **reverse-sync JSON → .js** (JSON canonical, бо тримає production tri-state з commit `5c32db0`).
   - `build_vtt_per_lang.js`: тривіально (whitespace).

3. **Extract canonical .js for 3 inline-only nodes**: `code_nodes/expand_tts_jobs.js` (W3), `code_nodes/segment_transcript.js` (W1), `code_nodes/verify_translations.js` (W2). Це 3 найбільших і найкритичніших inline-only nodes (4.7K–6.5K chars). W_Master + дрібні Get Params/Plan/Coalesce ноди (≤2.8KB) залишаються inline-only — extract on demand.

4. **package.json**: додано `"sync": "node scripts/sync_jscode.js"`. Workflow: edit .js → `npm run sync` → commit обидва.

5. **`code_nodes/README.md`**: оновлено таблицю файлів (додано 3 нові + Verify Translations), додано inline-only inventory list, додано sync-workflow note в Conventions.

Альтернативи, які розглядались:
- **Build-time inline injection для DRY** (loadPrompt/ALL_LANGS/retry helpers через template comments в sync скрипті) — overhead > benefit на стабільному проді з повільним змінним cadence. ~80 LOC saved, але додає template magic + ризик одного bug у централізованому helper, який ламає 7 мов. Skip indefinitely.
- **Split `phase2_batch_llm_tts.js` (1054 LOC)** — потребує bundler, n8n code node = один файл. Reviewability фіксується через цей sync (тепер можна diff'нути). Skip.
- **Shared 'Load Utils' n8n node** — громіздкіше + потребує зміни workflow layout (memory feedback: не регенерувати layout). Skip.

Files changed:
- `scripts/sync_jscode.js` — new (replaces `sync_w2_jscode.js`).
- `scripts/sync_w2_jscode.js` — deleted.
- `code_nodes/expand_tts_jobs.js`, `code_nodes/segment_transcript.js`, `code_nodes/verify_translations.js` — extracted from JSON.
- `code_nodes/check_timing_and_pad.js`, `code_nodes/regen_synthesize.js`, `code_nodes/build_vtt_per_lang.js`, `code_nodes/prepare_tone_analysis.js`, `code_nodes/parse_tone_analysis.js` — resolved/reverse-synced.
- `workflows/W2_Translate_v2.json`, `workflows/W3_Synthesize_v2.json`, `workflows/W_Regen.json` — synced jsCode.
- `code_nodes/README.md` — updated table + Conventions.
- `package.json` — `"sync"` npm script.

Verification:
- `npm run sync` після всіх змін → `no changes — 19 node(s) already in sync` (idempotent).
- `git diff workflows/` обмежений 4–4–2 рядками escaped JSON (фактичний контент: 970-char trailing-silence fold + 3 trivial whitespace правок).
- **Recommended manual E2E** (operator): drop test lesson з відомою хвостовою тишею у `01_input/`. Перевірити: last seg FR/IT/PT `borrowed_sec > 0` АБО `tail_silence_sec ≈ audio_duration_sec - en_end_sec`; `full_{lang}.wav` duration ≈ EN ±100мс. Якщо drift > 5% від `tests/golden/test4_baseline.csv` — rollback через `git revert`.

Edge cases:
- Inline-only ноди (W_Master full chain, всі Get Params, дрібні W_Regen helpers) поки не покриті sync — edit їх вимагає або n8n UI, або manual JSON edit. Це OK на стабільному коді ≤2.8KB; розширити map тільки коли реально треба editувати.
- Якщо хтось редагує jsCode прямо в n8n UI без reverse-sync у .js → наступний `npm run sync` перепише його зміну з застарілого .js. **Mitigation**: операторський workflow → edit .js → sync → commit. n8n UI стає "view-only" для синкнутих нод.

Future work:
- **P1.1 Sanitizer unification**: дві версії `sanitizeLLMOutput()` у `adapt_translations.js` і `check_timing_and_pad.js` з трохи різними regex списками — union у обох (inline copy, не централізація). Defer.
- **P1.2 Docs sync** (з PLAN.md `Should-have`): `docs/sheets_schema.md` — додати `phase2_outcome`, `phase2_diag`, `llm_dropped`, `final_speed`, `last_regen_at`. Defer.
- **P1.3 Basic ESLint** на code_nodes/scripts — `no-undef`, `no-unused-vars`. Defer (low ROI).

Tag: `SYNC_INFRASTRUCTURE_EXTENDED_TO_W3_W_REGEN`

---

### 2026-06-04 — LAST_SEGMENT_TRAILING_SILENCE_SEPARATION

Context: Користувач помітив, що локалізація останньої фрази «з'їдає» хвостову паузу. Корінь — W1 Segment Transcript штучно розтягував `en_end_sec` останнього сегменту до `audioDuration` (data.metadata.duration з Deepgram), щоб сума per-segment слотів дорівнювала EN total. Побічний ефект: `en_duration_sec` для last seg = `last_word_end - en_start_sec + trailing_silence`. `check_timing_and_pad.js` сприймав це як «бюджет на TTS», тому верборозні мови (FR/IT/PT) не скорочувалися, локалізована мова тривала через хвостову тишу. Окремо: для last seg W3 Expand TTS Jobs hard-cap-ив `maxBorrowable = 0` (`isLast ? 0`), хоча trailing silence фізично була доступна для «дихання».

Decision: розділити поняття «slot duration» (для TTS budget) і «physical file duration» (для sum-invariant). Конкретно:

1. **W1 Segment Transcript** (`workflows/W1_STT_and_Segment.json`): видалено блок `if (audioDuration > last.end) last.end = audioDuration`. Last seg's `en_end_sec` тепер = фактичний кінець останнього слова з Deepgram. Додано колонку `audio_duration_sec` у segments sheet — W1 пише `data.metadata.duration` на кожен рядок уроку (lesson-level metadata зберігається per-row, щоб уникнути окремого `lessons` sheet).

2. **W3 Expand TTS Jobs** (`workflows/W3_Synthesize_v2.json`): читає `audio_duration_sec` з segments row. Для last seg обчислює `tailToEOF = audio_duration_sec - en_end_sec` і використовує `nextStart = end + tailToEOF` замість `nextStart = end`. Це робить trailing silence видимою для slot/borrow логіки. Видалено `isLast ? 0` cap на `maxBorrowable` — last seg тепер може breath-borrow як і всі решта (movement-locked still blocked у `check_timing_and_pad`). Транзитне поле `tail_audio_silence_sec` пропускається в job для downstream.

3. **`code_nodes/check_timing_and_pad.js`**: synthOne destructure-ить `tail_audio_silence_sec`. Після існуючої гілки `if/else` що рахує lead/tail/borrow, додано `extraTrailSec = max(0, tailAudioSilence - borrowedSec)` і `tailSec += extraTrailSec`. Trailing silence-to-EOF фізично сидить у кінці WAV останнього сегменту, складена в існуючу колонку `tail_silence_sec` (без нових колонок у localizations).

Invariant `sum(per-seg_{lang}.wav) == full_{lang}.wav` зберігається telescoping-ом: `lead + speech + tail` для всіх non-last сегментів дають `en_end_{N-1}`; last seg додає `lead + speech + (T - borrow) + borrow` = `lead + speech + T` до файлу, тож total = `en_end_{N-1} + T = audio_duration`. `Trim Lead For Sequence` не зачіпає last seg, бо «наступного» немає — last seg's borrow компенсується **всередині нього самого** (через зменшення `extraTrailSec`).

Альтернативи, які розглядались:
- **Скласти trailing silence у concat-time** (`build_full_audio_per_lang.js`): простіша зміна коду, але per-segment WAV у Drive стають коротшими за EN — оператор у Reaper мусив би додавати тишу вручну в кінці. Відмовлено для consistency з існуючим invariant.
- **Окремий silence-seg в Drive** (`seg_NNN_silence.wav`): нова сутність у sheet + Drive, лишній файл per lesson. Відмовлено за простоту.
- **Hard-cap last seg на en_duration** (без borrow): простіше, але FR/IT/PT часом провокує зайвий truncate/needs_attention навіть коли trailing silence доступна. Користувач явно вибрав "знімай блок".
- **Нова колонка `tail_audio_silence_sec` у localizations**: зайва — фолдиться у `tail_silence_sec` без втрати інформації.

Files changed:
- `workflows/W1_STT_and_Segment.json` — Segment Transcript jsCode + Write to Sheet column mapping/schema (нова колонка `audio_duration_sec`).
- `workflows/W3_Synthesize_v2.json` — Expand TTS Jobs jsCode (tailToEOF, removed isLast?0, tail_audio_silence_sec в slotInfo + results).
- `code_nodes/check_timing_and_pad.js` — destructure + extraTrailSec fold.
- `docs/sheets_schema.md` — додано `audio_duration_sec` у segments, оновлено `tail_silence_sec` + `borrowed_sec` нотатки про last seg.
- `DECISIONS.md` — цей запис.

Без змін:
- `code_nodes/build_full_audio_per_lang.js` — pure concat як був, per-seg WAV-и тепер самодостатні.
- `code_nodes/trim_lead_for_sequence.js` — не торкається last seg.
- `code_nodes/regen_synthesize.js` — таргетить наявний `final_duration_sec` з рядка, який після фіксу вже включає trailing silence.

Дія оператора (one-time): вручну додати колонку `audio_duration_sec` у tab `segments` Google Sheets (header у наступну вільну колонку). W1 з нового прогону заповнить її.

Verification:
- W1 jsCode parses ✓; sheet writer mappings включають `audio_duration_sec`.
- W3 Expand TTS Jobs jsCode parses ✓; `Read Segments` без explicit column list (auto-passes `audio_duration_sec` після додавання колонки в sheet).
- `check_timing_and_pad.js` parses ✓; `extraTrailSec = 0` для всіх non-last сегментів (tail_audio_silence_sec=0).
- Тестування: lesson з відомою хвостовою тишею (~5с), FR-only. Перевірити: last seg row `borrowed_sec > 0` якщо FR overshoot speech-only en_duration; `tail_silence_sec` last seg ≈ `audio_duration_sec - en_end_sec - borrowed_sec` (+ можливий padding within slot); `full_fr.wav` duration ≈ `lesson_en.wav` duration ±100мс.

Edge cases:
- Legacy уроки без `audio_duration_sec` у segments: `parseFloat() || 0` → `tailToEOF = 0` → graceful degradation (dubbed track коротший за EN). W3 пише warning у консоль.
- Movement-locked last seg: `canBorrow=false` → `borrowedSec=0` → `extraTrailSec = tailAudioSilence` (вся хвостова тиша зберігається; останнє слово синхронне з відео).
- Урок без trailing silence (`audio_duration == last_word_end`): `tailToEOF=0`, all logic ідентична до фіксу.

Future work:
- Якщо захочеться позбутися повторення `audio_duration_sec` на кожному рядку — мігрувати на окремий `lessons` sheet (`lesson_id, audio_duration_sec, drive_folder_id, …`). Поки що over-engineering для одного значення per lesson.

---

### 2026-06-04 — PERMISSIVE_BORROW_FOR_NONMOVEMENT_SEGMENTS

Context: Користувач знайшов 2 false-positive `needs_attention=TRUE` cells у CSV. У обох випадках TTS overshoot-ив `en_duration_sec` на невелику кількість, АЛЕ після сегмента була тиша (`gap_after_sec > 0`) — фізично безпечно заборгувати ту тишу. Поточна логіка не дозволяла, бо `isShortSeg` gate перевіряв тільки `en_duration < short_seg_threshold_sec` (default 2.0с): короткі афірмації мали право borgувати, довгі narrative сегменти — ні, і навіть з вільною тишою після перетворювалися на truncate + needs_attention.

Decision: видалено `short_seg_threshold_sec` gate. Заміна — рух-локед перевірка:
- `hasMovement = (movement_keywords || '').trim() !== '' || segment_type === 'movement'`
- `canBorrow = enDur > 0 && slot > enDur && !hasMovement`
- `maxAllowed = canBorrow ? slot : enDur`

Усі non-movement сегменти будь-якої довжини тепер можуть розширювати свій TTS у тишу після — bounded by `effective_slot_sec` (= `en_duration + max_borrowable`, з `max_borrowable = min(gap_after - MIN_GAP, max_borrow_per_segment_sec)`). Movement-locked сегменти (yoga/meditation cues, де озвучка має sync-нути з video-рухами) залишаються strict at `en_duration_sec` — overshoot все ще тригерить `needs_attention=TRUE`.

Двосигнальна перевірка movement (`OR`) defensive: і `movement_keywords`, і `segment_type` пишуться W2 Tone Analysis у segments sheet. Якщо LLM промахнувся на одному з них (наприклад поставив type=narrative але keywords заповнив), ми все одно lock-немо. Тільки якщо ОБИДВА сигнали missing — borrow дозволено.

Архітектурна гарантія `sum(per-seg_{lang}.wav) == full_{lang}.wav` per language НЕ порушується. `Trim Lead For Sequence` (added 2026-05-31) trim-ить лідер наступного сегмента на `borrowed_sec` поточного — boundary між сегментами зсувається, але абсолютна позиція кожного speech-старту = EN-aligned. Per-segment WAV файли НЕ-MOVEMENT сегментів між мовами тепер можуть мати різну тривалість (один lang заборгував, інший ні), але full WAV-и однакові за тривалістю + з sync-нутими боундарями.

Альтернативи, які розглядались:
- **Keep `short_seg_threshold_sec` AS-IS + add movement check** (`canBorrow = isShortSeg && !hasMovement`): не вирішує користувачеву проблему — довгі narrative сегменти все одно не borgують.
- **Make threshold configurable з default=Infinity** (`canBorrow = (enDur < threshold) && !hasMovement`): зайве абстрагування. User explicitly chose to remove the gate.
- **Per-segment opt-in/opt-out у segments sheet** (нова колонка `allow_borrow`): додає manual work для оператора. Cycle gain не виправдовує.

Files changed:
- `code_nodes/check_timing_and_pad.js` — видалено `SHORT_SEG_THRESHOLD` constant; destructure of `synthOne` додає `movement_keywords, segment_type`; gate logic замінено per the snippet вище.
- `workflows/W3_Synthesize_v2.json` — `Expand TTS Jobs` Code: per-job payload додає `movement_keywords` + `segment_type` (вже у segments sheet read upstream). `Check Timing + Pad` inline code: synch-rized з standalone file.
- `docs/sheets_schema.md` — `needs_attention` опис оновлено: tri-state + movement gate timing rule.
- `docs/config_keys.md` — `short_seg_threshold_sec` помічено dead.
- `DECISIONS.md` — цей запис.

Verification:
- W3 JSON parses ✓, всі jsCode async-wrap-аються ✓
- Standalone `code_nodes/check_timing_and_pad.js` parses ✓
- No code references to `SHORT_SEG_THRESHOLD` / `short_seg_threshold_sec` (тільки коментарі)
- Тестування: drop урок, де є відомий false-positive cell з minor overshoot + non-empty gap_after + empty movement_keywords → раніше `needs_attention=TRUE` з truncated audio, тепер `needs_attention=FALSE` + `borrowed_sec > 0` + full audio збережено.

Future work:
- Per-segment WAV cross-lang duration drift (non-movement segments тепер різної довжини між мовами) — тільки якщо хтось консьюмить per-seg files окремо. Не критично для поточного operator workflow (full WAV в DAW).
- Якщо рух розкласифіковано вручну оператором ПІСЛЯ W2 (rare), W_Regen прогон використає поточний стан segments sheet (W2 Tone Analysis pre-write), не original W3 рішення. Це коректна поведінка.

---

### 2026-06-04 — W_MASTER_ARCHIVE_REFACTOR_TO_HTTP_NODES

Context: `Archive Previous Run` Code node (added 2026-06-03) використовував `this.helpers.httpRequestWithAuthentication` для Drive/Sheets REST викликів. Користувацька версія n8n блокує цей helper у Code Node sandbox (`The function "helpers.httpRequestWithAuthentication" is not supported in the Code Node`), тож архів-чейн впав на першому ж прогоні. Predelete code's коментар про fallback "switch this node to HTTP Request nodes with explicit credential binding" став необхідним рефактором.

Decision: один Archive Previous Run Code node замінено на ланцюг з 11 нод (positions y=720, x=2528→4992):

1. **Plan Sources** (Code) — validates `drive_archive_folder_id` + `drive_input_folder_id` + `drive_output_folder_id`, emits 1 item per source folder з `{src_key, folder_id, q}` (q — pre-built Drive query string)
2. **List Files** (HTTP Request, `googleDriveOAuth2Api`) — GET `/drive/v3/files?q={{$json.q}}&...&pageSize=1000`. Fires once per source folder (1-4 times залежно від dedupe). Pagination >1000 файлів не обробляється (поточний max ≈350 на урок).
3. **Plan Archive** (Code) — aggregates `$('List Files').all()` paired by index з `$('Plan Sources').all()`, filters out `new_file_ids`, derives `archive_name` (input basename fallback to segments/full prefix), emits ONE item з повним планом OR `{skip:true}`
4. **Has Files To Archive?** (IF v2.2) — routes на основі `$json.skip === false`. False output (skip=true) пайпом одразу до Pass Lessons (after Archive)
5. **Create Archive Root** (HTTP POST) — створює archive folder у `05_archive`
6. **Copy Sheet Snapshot** (HTTP POST `/files/{id}/copy`) — копіює живий Sheet у archive root. **onError default (stopWorkflow)** — якщо snapshot впав, нічого не порушено, можна re-drop файл після фіксу
7. **Plan Subfolders** (Code) — emits 1 item per src_key що має файли в плані (можливо <4 якщо щось порожнє)
8. **Create Subfolder** (HTTP POST) — fires per item
9. **Plan Moves** (Code) — pairs subfolder IDs (from `$('Create Subfolder').all()` by index) з files (з `$('Plan Archive').first()`), emits N items
10. **Move File** (HTTP PATCH `/files/{id}?addParents=&removeParents=`) — fires N times. `retryOnFail=true`, `maxTries=3`, `waitBetweenTries=2000ms`, `onError=continueRegularOutput` — partial failures не вбивають workflow
11. **Clear Sheet Tabs** (HTTP POST `/values:batchClear`, `googleSheetsOAuth2Api`) — `executeOnce=true` (один виклик незалежно від кількості Move File output items), `onError=continueRegularOutput` (moves вже зроблені, sheet clear фейл recoverable manually)
12. **Pass Lessons (after Archive)** (Code) — re-emits Parse Filename items, точка конвергенції з IF-false branch

W_Master тепер має 26 нод (було 15). Connections: 25 sources (було 14). Існуючі positions існуючих 15 нод НЕ змінено (per [feedback_workflow_node_layout]).

Чому HTTP Request nodes а не n8n Google Drive native nodes:
- HTTP Request має стабільні параметри між версіями n8n (метод/url/query/body — universal). Native Drive/Sheets node params шифтяться між v3, v4, v5+.
- Ми знаємо Drive REST API exactly — meta-документація стабільна.
- Pattern уже використовується у W_Regen (Drive PATCH httpRequest line 175+) і Search Same Name Full (line 436+) — consistency.

Чому не окремий W_Archive workflow:
- Inline зберігає W_Master self-contained — одна точка для оператора щоб бачити повний flow після drop.
- Окремий workflow додав би крок для setup (import + bind credentials + reference workflow ID у W_Master Execute Workflow node).
- 11 нод inline видно у Visual UI без переключення.

Files changed:
- `workflows/W_Master.json` — Archive Previous Run Code node (1 node) → 11 nodes. Total: 15 → 26 nodes; connections 14 → 25.
- `workflows/README.md` — оновлено W_Master section (замість "Archive Previous Run" row тепер табличний row "Archive chain (11 nodes)" з повним описом ланцюга). Setup checklist оновлено (пункт 3 — checking credentials на HTTP Request nodes).
- `DECISIONS.md` — цей запис.

Verification:
- W_Master.json parses ✓, всі jsCode async-wrap-аються ✓, всі 25 connection targets resolve ✓
- 26 nodes, archive chain positions exact [2080,720]→[4992,720] grid (224px step)
- HTTP Request nodes мають `nodeCredentialType` + `credentials` block — same pattern як Drive PATCH у W_Regen.

Future work:
- Якщо pagination >1000 файлів на папку стане потрібна — додати loop pattern (Code + SplitInBatches) перед List Files. Поточний max ≈350 файлів per folder (sleep1_full 47×7).
- Якщо архів-чейн стане частим bottleneck — extract до W_Archive workflow і викликати через Execute Workflow.

---

### 2026-06-03 — W_MASTER_ARCHIVE_PREVIOUS_RUN_ROTATION

Context: Drive working folders `01_input`, `02_output` (`drive_output_folder_id`), `03_full` (`drive_output_full_folder_id`), `04_vtt` (`drive_output_vtt_folder_id`) accumulated файли від кожного processed lesson — після десяти прогонів папки переповнені файлами від десяти різних уроків. Оператор хотів, щоб папки лишались "чистими" — тільки поточний урок видимий, попередні тукаються в `05_archive` (новий, ID `1DHRzoMLTLGbgvNuCxCOY3oB58AkWfEbq`), із збереженою структурою папок і datestamped subfolder за іменем попереднього файлу.

Decision: додано трьохнодний archive chain inline у W_Master між `Parse Filename` і `Execute W1 (STT)`:

1. **Once Per Run** (Code, [2080, 720]) — згортає N Parse Filename items до 1 sentinel item (так archive chain fires once, незалежно від multi-file drops). Carries `new_file_ids` для exclusion.
2. **Read Config (Archive)** (Sheets, [2304, 720]) — окремий config read саме на початку workflow (existing `Read Config` живе ПІСЛЯ Execute W3 — занадто пізно). Reads folder IDs + новий `drive_archive_folder_id`.
3. **Archive Previous Run** (Code, [2528, 720], із прив'язаними `googleDriveOAuth2Api` + `googleSheetsOAuth2Api` credentials) — робить ВСЕ Drive + Sheets REST через `this.helpers.httpRequestWithAuthentication.call(this, '<type>', {...})` (pattern з [code_nodes/predelete_drive_files.js](code_nodes/predelete_drive_files.js)):
   - lists всі 4 source folders (з pagination для >1000 файлів)
   - excludes файли в `new_file_ids` set
   - дерево archive: derives ім'я з `01_input` leftover basename (sort by alpha — deterministic), fallback на `_seg_`/`_full_` prefix із 02-04, fallback на літерал `archive`
   - timestamp: `YYYY-MM-DD_HH-MM` (sortable + human-readable)
   - створює archive root + per-source subfolders через `POST /drive/v3/files` з `mimeType=folder`
   - **копіює живий Google Sheet** через `POST /drive/v3/files/{sheetId}/copy` (Drive copy → independent Sheet, NOT a link) в archive root як `sheet_snapshot_{archiveName}`. Sheet ID береться з config key `sheets_document_id` (новий, optional) з fallback на hardcoded `1LAxDWyV0pAxM1s5W00PTJ7OvFNQUxoeMSuszuOz3lDU`. Snapshot failure → **throws BEFORE any destructive op** (no moves, no clear) — необхідна гарантія, інакше можна втратити дані попереднього прогону при пропуску snapshot.
   - переміщує файли через `PATCH /drive/v3/files/{id}?addParents&removeParents` (NOT copy — без duplicates, без quota burst)
   - bounded concurrency 10 для moves
   - **wipe-ить `segments` і `localizations` таби** живого Sheet через `POST /spreadsheets/{id}/values:batchClear` (ranges `segments!A2:ZZ` + `localizations!A2:ZZ` — headers rows залишаються; `voices`, `prompts`, `config` таби НЕ зачеплено). Це даєW1/W2/W3 чистий старт для нового уроку без collision зі stale rows. Sheet clear failure logged but NOT throw (moves already done; recoverable manually).
   - pass-through `$('Parse Filename').all()` items у return, щоб Execute W1 fan-out працював незмінно

Wiring (chain): `Parse Filename → Once Per Run → Read Config (Archive) → Archive Previous Run → Execute W1`. Існуючі позиції всіх інших нод збережено (per [feedback_workflow_node_layout]) — нові ноди на новому row y=720 (нижче existing y=432 main row і y=592 Pass Lessons row). Visual: ланцюг іде вниз-вправо-вгору-вліво до Execute W1. Не найкрасивіше, але preserves всю стару layout.

Новий config key `drive_archive_folder_id` — REQUIRED. Якщо missing → Archive Previous Run throws ще до будь-якого Drive mutation. Свідома відсутність silent-skip: інакше папки 01-04 росли б непомітно для оператора, і він би помітив тільки коли quota lapsed.

Edge cases handled:
- **Перший прогон** (01-04 порожні): toMove[] empty → console log + pass-through до Execute W1 без створення archive subfolder.
- **Multi-file drop**: `new_file_ids` excludes всі N just-dropped → archive захоплює тільки старе. W1 fan-out не зачеплений.
- **Leftover input не співпадає з segments prefix**: archive name береться з alpha-sorted 01_input файлу — det'мінований. Якщо 02-04 мають файли від multi-lesson, всі дампляться в одну архів-папку (per user decision — "все в одну").
- **drive_archive_folder_id missing**: throw з actionable error message.
- **Move fails partway** (network blip): part-moved йдуть в архів, решта залишається в working folders. Не fails workflow — W1/W2/W3 ще можуть процесити новий файл, незавершені moves підхопить наступний прогон. Логи warn-ять про count of errors.

Альтернативи, які розглядались:
- **Separate W_Archive workflow** через Execute Workflow — cleaner separation, але +1 файл для maintenance. Inline залишає logic next to W_Master orchestration; якщо W_Archive потрібен пізніше — легко витягти.
- **n8n Google Drive Search + Create Folder nodes** (не Code-node-із-httpRequest) — стандартніший pattern, але потребує 8-12 нод замість одного code. Code node з httpRequestWithAuthentication дає ту саму auth + менше нод (плата — залежність від цього n8n helper, документовано working у предделете коменті).
- **Copy + verify + delete** (3 кроки) — повноцінний backup, але double-write transient state + 2× quota. Move через `addParents/removeParents` атомарний на Drive side і повертає file_id незмінним.

Files changed:
- `workflows/W_Master.json` — додано 3 ноди, нові connections, всі існуючі positions збережено. Нод тепер 15 (було 12), connection sources 14 (було 11).
- `docs/config_keys.md` — нова row `drive_archive_folder_id`; updated `drive_input_folder_id` опис що тепер also consumed by Archive Previous Run.
- `workflows/README.md` — W_Master section: 3 нові table rows (Once Per Run, Read Config (Archive), Archive Previous Run); setup checklist оновлено (нові пункти 3 + 5 про credential + config).
- `DECISIONS.md` — цей запис.

Verification:
- W_Master.json parses ✓, all jsCode async-wraps ✓, all 14 connection targets resolve ✓
- 15 nodes, positions sane (existing all at y=432/592, нові 3 на y=720)
- Code-node-з-credential pattern документований у [code_nodes/predelete_drive_files.js:13-15](code_nodes/predelete_drive_files.js#L13-L15). Якщо `httpRequestWithAuthentication` not available у user's n8n version → fall back на explicit HTTP Request nodes з credential bindings (8+ нод замість 1 code).

Future work:
- **Retention policy на 05_archive**: зараз files accumulate forever. Окремий cleanup workflow, що видаляє archive subfolders старше N днів — add якщо Drive quota стане проблемою.
- **Rollback on W1/W2/W3 failure**: якщо новий run падає після archive — old files вже в archive і таби wipe-нуті, чисто manual cleanup (operator копіює дані зі snapshot Sheet назад у segments/localizations таби). Можна додати checkpoint workflow для restore — defer до першого реального failure.

---

### 2026-06-03 — SLACK_SURFACE_REDESIGN_NEEDS_ATTENTION_REGEN_BUTTON

Context: `Build Slack Message` у W_Master повідомляло лише про факт завершення + один лінк на full-folder. Оператор просив додати (а) лінк на VTT-папку поряд із Audio, (б) per-lesson `needs_attention` rate (%+absolute) для quick triage, (в) "кнопку" у Slack, що запускає W_Regen без логіну в n8n. Окремо: W_Regen досі не слав жодного Slack-нотіфаєра по завершенні — оператор має постійно відкривати n8n щоб дізнатись, чи виправилось.

Decision:

**W_Master Build Slack Message** — переписано на 3-блочну mrkdwn-форму:
1. Header (`:white_check_mark: Dubbing complete` + lesson_id + filename + active langs)
2. **Needs attention rate** — per-lesson computed з нового `Read Localizations` Sheets node, що вставлений між `Read Config` і `Build Slack Message`. Filter: `segment_id.startsWith(lesson_id + '_')`. Render `N% (flagged / total)` або `n/a` коли total=0 (наприклад, drop файлу що валиться на W1 без створення localizations).
3. Three clickable links (mrkdwn `<url|text>`, не Block Kit buttons — для уникнення невідомих n8n Slack node параметрів у v2.2): Audio folder, VTT folder, Open W_Regen. Кожен з лінків опускається, якщо відповідний config key відсутній.

**W_Regen — Webhook Trigger** новий, поряд із Manual Trigger:
- `httpMethod=GET`, `path=w-regen`, `responseMode=onReceived` (миттєва відповідь `"Regen started — you will get a Slack notification when it finishes"`, workflow рухається у фоні)
- Connection: `Webhook Trigger → Read Config` паралельно до `Manual Trigger → Read Config`. n8n merge-ить через input 0; Read Config спрацьовує один раз на trigger activation.
- Слак-кнопка є просто mrkdwn-лінком на webhook URL. Клік у Slack → браузер відкриває webhook → отримує "Started" → закриває таб. Workflow стартує без логіну. Security risk: anyone with the URL can trigger; mitigated тим, що URL живе в private Slack channel + має random path suffix. Для більш суворого захисту можна додати query-param shared secret у майбутньому.

**W_Regen — Slack notification на завершенні** (новий tail):
- `Wait For Saves` (Merge node v3, mode=append) — синхронізує закінчення обох паралельних save-branches (`Save Full to Drive` + `Save VTT to Drive`). Connections — second output port from each save node. Empty-run case (Regen Engine returned 0-cell sentinel → ні Save Full ні Save VTT не fire) ⇒ Merge не fire ⇒ Slack не fire (інтенціонально — оператор знає що нічого не запускалось).
- `Build Regen Slack Message` (Code) — читає `$('Regen Engine').all()` для per-lesson stats (ok / failed), `$('Read Localizations Fresh').all()` для post-regen needs_attention rate. Емітить one message per affected lesson, симетрично до W_Master (різниця: `:arrows_counterclockwise: *Regen complete*` + `Cells regenerated: X (Y failed)` замість source filename + active langs).
- `Slack Notify (Regen)` — стандартна n8n Slack v2.2 нода, same credential, same `text` + `mrkdwn=true` як у W_Master.

**Новий config key** `w_regen_workflow_url` — повний webhook URL (з production endpoint n8n), наприклад `https://n8n.example.com/webhook/w-regen`. Optional — без нього кнопка просто опускається з обох Slack-повідомлень. Документовано в `docs/config_keys.md` поряд із `slack_channel`.

Альтернативи, які розглядались і відхилені:
- **Block Kit buttons** (з полем `actions` + `style: primary`) — потребують точного імені параметра у n8n Slack v2.2 (`blocksUi`? `messageType: block`?), яке я не можу швидко верифікувати без живого n8n. mrkdwn-лінки дають той самий UX (клік → URL) і працюють гарантовано. Якщо UX справді треба styled-buttons, можна вернутись пізніше.
- **Лінк на n8n UI** (`/workflow/{id}`) — простіше, але оператор мусить мати n8n акаунт + логінитись. Користувач явно сказав уникати цього.
- **`min_inter_segment_gap_sec` security token** для webhook — overkill для MVP коли URL вже у private Slack channel. Якщо в майбутньому Slack-канал розшириться поза команду, можна додати `?token=...` перевірку.
- **Slack interactivity (real button → POST to app endpoint → trigger via n8n REST API)** — потребує Slack App setup + interactivity endpoint receiver. Overkill для MVP.

Files changed:
- `workflows/W_Master.json` — додано node `Read Localizations` ([3184, 432]); зміщено `Build Slack Message` → [3408, 432] та `Slack Notify` → [3632, 432] (стандартний 224px grid збережено per [feedback_workflow_node_layout]). `Build Slack Message` jsCode переписано на 3-блочну форму. `Slack Notify` залишився text+mrkdwn (не Block Kit). Connection: `Read Config → Read Localizations → Build Slack Message`.
- `workflows/W_Regen.json` — додано Webhook Trigger ([0, 200]), Wait For Saves Merge ([2600, 300]), Build Regen Slack Message ([2800, 300]), Slack Notify (Regen) ([3000, 300]). Save Full / Save VTT connections отримали другий target → Wait For Saves (input 0 / input 1 відповідно).
- `docs/config_keys.md` — нова row `w_regen_workflow_url` + оновлено `slack_channel` row що тепер consumed by both W_Master і W_Regen.
- `workflows/README.md` — оновлено W_Master section (новий Read Localizations node, оновлений Build Slack Message опис), додано нову W_Regen section з повною таблицею nodes (раніше W_Regen не був задокументований у workflows/README.md).
- `DECISIONS.md` — цей запис.

Verification:
- Both workflow JSONs parse ✓
- Усі jsCode-блоки async-wrap-нуто і компілюються ✓
- Усі connections targets resolve у existing node names ✓
- W_Master: 12 nodes, 11 connections; W_Regen: 27 nodes, 24 connections

Future work:
- Якщо webhook стане target для зловмисників/script kiddies → додати token query-param check (`if (request.query.token !== cfg.w_regen_token) throw`).
- Якщо оператор хоче styled-buttons замість mrkdwn-лінків → перевести Slack Notify на Block Kit (потрібен живий n8n щоб верифікувати точний param shape).
- Якщо W_Regen починає fire-ити часто (наприклад via Sheet-based `regen=TRUE` trigger, що сьогодні post-ship у PLAN.md) → можна додати throttle (last_regen_at < 10s back → skip).

---

### 2026-05-31 — BORROW_BEHAVIOR_AUDIT_DOCS_SYNC

Context: PLAN.md had `max_borrow_per_segment_sec` listed як "formally dead" у should-have cleanup; README.md → Sheets cheatsheet теж позначав key як "currently unused"; `localizations` watch-list казав `borrowed_sec` "should be 0 (strict alignment)". Це було неточно: `max_borrow_per_segment_sec` фактично активний — використовується як ceiling у `Expand TTS Jobs → effective_slot_sec` обчисленні і застосовується runtime коли `isShortSeg=true` у `Check Timing + Pad`. Користувач попросив зʼясувати, як вирішити це питання і які ризики змін.

Decision: документувати поточну поведінку як інтенціональний design, не міняти код. Логіка зараз:

1. **Normal-length segments (`en_duration_sec ≥ short_seg_threshold_sec`, default 2.0с)** — strict alignment, `maxAllowed = en_duration_sec`. TTS, що overrun, проходить через 3-tier Claude shorten → 2-tier speed retry → hard truncate + `needs_attention=true`. Per-segment WAV duration ідентична між мовами.
2. **Short segments (`en_duration_sec < short_seg_threshold_sec`)** — conditional breath-borrow дозволено. `maxAllowed = effective_slot_sec = en_duration + min(gap_after - MIN_GAP, max_borrow_per_segment_sec)`. TTS може вийти у trailing gap; `borrowed_sec` записується в localizations.
3. **Full WAV alignment** — `Build Full Audio Per Lang` тримить `borrowed_sec[N]` секунд з голови lead_silence сегмента N+1 (`Math.min(prevBorrow, leadSec)` guard). Структурний інваріант з Expand TTS Jobs (`maxBorrowable ≤ gap_after - MIN_GAP` і `lead_silence_natural[N+1] == gap_after[N]`) гарантує, що trim не їсть TTS audio. Full WAV для кожної мови ≈ EN audio length, незалежно від per-segment borrow.

Розглянуті альтернативи:

- **Варіант B — borrow для всіх сегментів** (зняти SHORT_SEG_THRESHOLD gate). Pros: менш аґресивний truncation на normal segments що трохи overrun-ять. Cons: per-segment WAV durations розходяться між мовами (повертає причину `STRICT_ALIGNMENT_DISABLE_BREATH_BORROW` 2026-05-17). Full WAV alignment залишається ОК через concat-time compensation, АЛЕ якщо хтось консьюмить per-segment файли окремо (наприклад QA в DAW з 7 lang stems на таймлайні) — побачить drift. Risk: MEDIUM. Відкладено до явного запиту з підтвердженням use case per-segment файлів.
- **Варіант C — two-pass cross-lang aware borrow** (всі 7 langs одного сегмента → max extension → однакова final_duration). Pros: повний sync і на per-segment рівні. Cons: rework Phase 1 batch loop + Phase 2 + W_Regen, memory hit на 7 PCM buffers одночасно, ризик OOM на 30+ хв уроках. Risk: HIGH. Не для до-ship стану.

Decision rationale: поточний компроміс design-justified — strict для normal segs (cross-lang sync на per-segment рівні), borrow для short афірмацій (де truncation чутніший на слух), concat compensation як safety net. Доки реальний use case не покаже потребу — нічого не міняти.

Files changed (doc-only):
- `README.md` — Sheets cheatsheet прибрав "currently unused" від `max_borrow_per_segment_sec`, додав blockquote з "Borrow behavior" що пояснює умовну активність + посилання на DECISIONS. `borrowed_sec` watch-list переписаний (0 для normal, non-zero expected для short segs).
- `PLAN.md` — should-have item з "Dead config-keys cleanup" перейменований і закритий: `max_borrow_per_segment_sec` НЕ dead, залишковий cleanup тільки для `min_speed` + старого `max_speed`.
- `DECISIONS.md` — цей запис.

`docs/config_keys.md` уже містить коректний опис `max_borrow_per_segment_sec` і `short_seg_threshold_sec` — без правок.

Future work (revisit triggers):
- Якщо real-world прогони на DE/PL (довші мінімальні слова) покажуть persistent truncation на normal segs → розглянути Варіант B з підтвердженням, що per-segment файли не консумуються окремо.
- Якщо клієнт вимагає per-segment cross-lang sync (DAW workflow з 7 lang stems) → Варіант C, planned як post-MVP.

---

### 2026-05-31 — W3_TRIM_SHEET_SYNC_FOR_W_REGEN

Context: Immediate follow-up to [W3_PER_SEGMENT_TRIM_FOR_SEQUENCE_PLACEMENT](#2026-05-31--w3_per_segment_trim_for_sequence_placement). That refactor moved borrow compensation from Build Full Audio's concat-time trim to an upstream post-pass that trims the per-segment WAVs in Drive directly. However, the sheet's `lead_silence_sec` and `final_duration_sec` columns were left at the ORIGINAL (Phase 1) untrimmed values. The sheet and Drive content were therefore out of sync for the 4 post-borrow cells per lesson.

This inconsistency would re-introduce drift through `W_Regen`. `W_Regen` regenerates a single segment by reading `lead_silence_sec` + `final_duration_sec` from the sheet, synthesizing TTS, and building a WAV with that exact lead + a tail to match final_duration. If the sheet says `lead = 6.015s` (Phase 1 original) but Drive currently has a 5.667s-lead version (post-trim), then a W_Regen run for that cell would overwrite Drive with a 6.015s-lead file — undoing the trim and bringing back 0.348s of drift in the full audio chain.

Decision: Make the sheet the authoritative source of truth co-aligned with Drive. After Trim Lead For Sequence applies its in-memory trim, also update the sheet's `lead_silence_sec` + `final_duration_sec` columns for the trimmed cells via a new googleSheets node. Then W_Regen "just works" — it reads the already-trimmed values from the sheet and synthesizes audio that fits the sequence-aligned slot.

Implementation in `workflows/W3_Synthesize_v2.json`:

- **NEW node `Update Trimmed Localizations`** (googleSheets, `appendOrUpdate`). Same sheet + matching pattern as `Phase 2: Update Localizations` (matches on `row_key`). Maps only the two columns that the trim changes: `lead_silence_sec` and `final_duration_sec`. Pulls values directly from `$json` (which is the Trim Lead For Sequence output flowing through `Has Trim?`).
- **Rewired connection**: `Has Trim? [true]` now fans out to BOTH `Save Trimmed Audio to Drive` AND `Update Trimmed Localizations` in parallel. The `false` branch stays empty (no-op for non-trimmed items).

No code change needed in `code_nodes/regen_synthesize.js`. The fix is purely workflow-level: sheet ↔ Drive consistency is restored, and W_Regen's existing logic produces correct audio.

Trade-offs:

- **Sheet semantics shifted**: the `lead_silence_sec` column for trimmed cells now reflects "what's in Drive" rather than "what Phase 1 produced". Sheet-as-debugging-record loses the Phase 1 history for these 4 cells per lesson. Acceptable — the trimmed value is what every downstream consumer (Build Full, W_Regen, manual editing in DAW) actually needs. If we ever need the original Phase 1 lead, it's recoverable from `slot_start_sec`, `en_start_sec`, and the natural-EN-gap formula.
- **Sheet write cost**: 4 extra cell updates per lang per lesson (28 ops total at 7 langs). Negligible compared to existing Update Localizations writes.
- **Cascade case still unhandled**: if the editor regenerates a BORROW segment (e.g., seg_009) via W_Regen, W_Regen would produce a file matching `phase1_final_duration` (which includes the original borrow). If the new audio's real speech duration differs, the effective borrow changes — but the sheet's `borrowed_sec` for seg_009 stays the same, and seg_010's trim in Drive isn't re-applied. Result: a tiny mismatch could appear at the seg_009 → seg_010 boundary. Unlikely to be audible (< 0.1s typically) and editors rarely regen borrow segments anyway. If it becomes a problem, the fix would be cascade-aware W_Regen that also re-trims downstream files when it touches an upstream borrow.

Verification: editor regenerates one of the post-borrow cells (e.g., seg_010_fr) via W_Regen. Inspect:
1. Sheet's `lead_silence_sec` for seg_010_fr after W_Regen runs — should still match the post-trim value (e.g., 5.667s), not jump back to 6.015s.
2. Drive WAV duration for seg_010_fr — should match `final_duration_sec` from sheet.
3. Re-run Build Full Audio for that lang — `full_duration_sec` should still equal 684.58s, not 684.93s.

Rollback: revert this commit. The `Update Trimmed Localizations` node is removed; sheet rows stop being synced to trim. The [W3_PER_SEGMENT_TRIM_FOR_SEQUENCE_PLACEMENT](#2026-05-31--w3_per_segment_trim_for_sequence_placement) refactor remains, but the W_Regen drift inconsistency returns.

Related: closes the W_Regen follow-up listed under "Trade-offs" in the per-segment-trim entry. Pipeline now has consistent sheet ↔ Drive ↔ regen state.

---

### 2026-05-31 — W3_PER_SEGMENT_TRIM_FOR_SEQUENCE_PLACEMENT

Context: Editor reported drift when placing individual segment WAVs end-to-end on a Reaper timeline. Confirmed via diagnostic: `full_duration_sec=684.581` (correct) but sum of individual `final_duration_sec` columns = 686.15 (= 684.58 + 1.569). The 1.569s is `Σ borrowed_sec` over the 4 short-segment-borrow cells (en_dur < 2s where TTS overflowed slot and was allowed to extend into the next EN silence). Build Full Audio Per Lang compensated by trimming the next segment's lead silence at concat time, so the full WAV was correctly EN-aligned. But the per-segment files in Drive themselves were never trimmed — and an editor placing them end-to-end (the natural Reaper workflow) saw cumulative drift starting at the first borrow boundary (seg_010).

Pre-refactor architecture: each per-segment WAV preserved its NATURAL lead silence (= EN gap from previous segment's end to this segment's start). Optimized for the historical "place segment at `slot_start_sec`" use case, where individual files paired with `slot_start_sec` positioning produced correct EN alignment (with small overlaps at borrow boundaries that are silence-over-speech, audibly fine). End-to-end concatenation was a downstream Build Full Audio concern, never a user-facing primitive.

The end-to-end use case is the natural editor workflow today (Reaper, ffmpeg concat, sequential review), and the slot_start placement use case is essentially unused. Refactoring the per-segment files to be end-to-end-friendly cleans up the surface area without losing real functionality.

Decision: Make individual per-segment WAVs in Drive **co-aligned with the full concat**. After all of Phase 1 + Phase 2 commits its audio to Drive (and `Read Localizations Fresh 2` has the final `borrowed_sec` + `lead_silence_sec` per cell), insert a post-pass that trims each post-borrow segment's lead silence by the previous segment's borrow amount, then overwrites the Drive copy. Build Full Audio Per Lang becomes a pure concatenator with no trim logic.

Implementation in `workflows/W3_Synthesize_v2.json` + `code_nodes/`:

1. **NEW node `Trim Lead For Sequence`** (Code, `code_nodes/trim_lead_for_sequence.js`). Sits between `Download Segment WAV` and `Build Full Audio Per Lang`. Reads `Read Localizations Fresh 2` for borrow values, groups items by lang, sorts by segment_id, walks in order tracking `prevBorrow`. For each segment where `prevBorrow > 0`, calls `this.helpers.getBinaryDataBuffer()` for the downloaded WAV, strips the 44-byte header, slices off `prevBorrow * SAMPLE_RATE * BPS` bytes from the start of PCM, rebuilds a fresh WAV header, replaces the item's binary. Updates `lead_silence_sec` and `final_duration_sec` on the json. Sets `trimmed_for_seq: true` flag.

2. **NEW node `Has Trim?`** (IF). Routes items by `trimmed_for_seq === true`.

3. **NEW node `Save Trimmed Audio to Drive`** (HTTP Request, Google Drive PATCH). Same pattern as `Phase 2: Drive Update`: `PATCH /upload/drive/v3/files/{file_id}?uploadType=media&supportsAllDrives=true` with binary body. Only fires on items where the trim node actually modified the WAV.

4. **Simplified `Build Full Audio Per Lang`** (`code_nodes/build_full_audio_per_lang.js`). Removed `locMap` construction, removed `prevBorrow` tracking, removed `trimmed_lead_total_sec` output field, removed the inline trim block. Now just strips 44-byte headers per item, accumulates PCM, builds final header. Segments come in already trimmed.

5. **Rewired connections**: `Download Segment WAV → Trim Lead For Sequence → Build Full Audio Per Lang` (replaces the previous direct edge). Trim Lead also branches to `Has Trim? → Save Trimmed Audio to Drive`.

Trade-offs:

- **Slot_start placement use case loses precision for 4 cells per lesson**: a user placing seg_010 (post-borrow) at its `slot_start_sec` in a DAW would now have speech 0.348s earlier than EN (because lead was trimmed in Drive). Acceptable — this use case has no known consumer.
- **Drive ops added**: ~4 PATCH overwrites per lang per lesson (only the post-borrow cells). With 7 langs × 4 cells × ~1s/op = ~30s added to W3 wall time. Negligible.
- **W_Regen interaction**: addressed in the follow-up [W3_TRIM_SHEET_SYNC_FOR_W_REGEN](#2026-05-31--w3_trim_sheet_sync_for_w_regen) entry — Trim Lead For Sequence now ALSO updates the `lead_silence_sec` + `final_duration_sec` columns in the sheet for trimmed cells (via a new `Update Trimmed Localizations` googleSheets node wired off `Has Trim? [true]` in parallel with `Save Trimmed Audio to Drive`). This keeps the sheet co-aligned with Drive content. W_Regen reads `lead_silence_sec` from the sheet to construct its WAV; now those values are correct, so regenerated audio is sequence-aligned out of the box. No code change required in W_Regen.
- **Diagnostic output changed**: `Build Full Audio Per Lang` no longer emits `trimmed_lead_total_sec` (which was useful to confirm compensation was running). Replaced by `trimmed_segs_count` + `total_trimmed_sec` on the upstream Trim Lead node's logs.

Verification: re-run W3 single-lang FR on `spirio_meditations2_3_2_en_fix`. Expected: 4 segments in Drive end up with shorter `final_duration_sec` matching trim (visible if the editor inspects Drive metadata). End-to-end placement of the 71 individual WAVs in Reaper produces a 684.58s timeline with phrases aligned to EN throughout — no 0.4s drift at seg_10, no cumulative offset by the end.

Rollback: revert this commit. The pre-refactor `Build Full Audio Per Lang` returns with its inline trim logic; the new nodes (`Trim Lead For Sequence`, `Has Trim?`, `Save Trimmed Audio to Drive`) are removed. Re-import the workflow JSON to restore the old node graph. Drive files would need to be re-rendered (since current Drive has the trimmed versions) — easiest by re-running W3 on the affected lesson.

Related: this builds on the [BORROW_BEHAVIOR_AUDIT_DOCS_SYNC](#2026-05-31--borrow_behavior_audit_docs_sync) entry — that one documented and audited the borrow mechanism; this one fixes a user-facing surface mismatch the audit revealed. The full audio path is unchanged; only the per-segment files are now sequence-aligned.

---

### 2026-05-31 — W3_PER_SEGMENT_WALL_CLOCK_BUDGET

Context: After the W3 shorten stack (Haiku→Gemini Flash + MIN_RETAIN 0.45 + new w3_shorten_system prompt) shipped, the `Check Timing + Pad` Code node hit a 300s task-runner timeout on batch 8 (segs 057-063) of the `spirio_meditations2_3_2_en_fix` FR re-run. Root cause: the new shorten pipeline is more "active" than the old one — Gemini Flash actually returns shorter text (instead of Haiku's frequent "cannot shorten further" early-out), which triggers a re-TTS, which may still not fit, which triggers another Gemini call, etc. Worst-case per segment: 1 initial TTS + 3 (Gemini + TTS) + 2 speed-up TTS = up to 9 sequential HTTP calls. With batchSize=7 running Promise.all in parallel, this normally completes in ~30-40s. But occasional slow Gemini calls (30+s for a single response when traffic is heavy) or ElevenLabs queueing on a tight tier pushes one segment's wall-clock to 60+s, and when multiple segments in the same batch hit this simultaneously, the parallel `Promise.all` aggregate stays bounded by the slowest. We observed batch 8 cross 300s in real production.

Tried first: lowered batchSize 7 → 3. Conceptually safer (smaller parallel set) but defeats the purpose of using ElevenLabs tier concurrency the user is paying for. User pushed back — wants to keep batchSize high and add a retry/safety mechanism instead.

Tried considered: n8n `retryOnFail` on the Code node. Uncertain whether n8n's task-runner timeout (which kills the V8 process) propagates as a catchable failure to retryOnFail's wrapper. None of our existing Code nodes use this, so no precedent in the repo. Even if it worked, retrying re-does ALL 7 segments in the batch when typically only 1 was slow — wasteful.

Decision: keep batchSize=7 AND add a **per-segment wall-clock budget** inside `synthOne` in `code_nodes/check_timing_and_pad.js` (and the embedded `Check Timing + Pad` node in `workflows/W3_Synthesize_v2.json`):

```js
const SEG_BUDGET_MS = 90000;          // 90 s
const segStartedAt  = Date.now();
const overBudget    = () => (Date.now() - segStartedAt) > SEG_BUDGET_MS;
```

Checked at the top of each shorten-loop iteration AND before each speed-up TTS retry. When `overBudget()` returns true:
- `console.warn` with the segment_id + which phase exhausted the budget
- `needsAttention = true`
- `break` out of the retry loop
- Segment still emits whatever audio was last produced (may be original initial-TTS audio that didn't fit; the downstream truncation code handles that)

Why 90s: a normal shorten cycle (3 Gemini + 3 TTS) is ~20-30s when everything is healthy. 90s gives 3× margin — covers slow Gemini responses + ElevenLabs queueing without being so generous that 7 parallel segments all hitting their budget would still timeout (7 × 90 / 7 parallelism = 90s, well under 300s).

Why per-segment and not per-batch: when one segment is slow, only IT should be capped. The other 6 in the batch may be processing fine and shouldn't be cut short for an unrelated bottleneck. Per-segment also keeps the cap surgical — fast segments aren't even aware of the budget.

Trade-offs:

- **Cells that genuinely need >90s of work get flagged**: rare but possible — a structurally tight slot with verbose FR + slow Gemini may hit the budget mid-shorten and emit with `needs_attention=true`. Same outcome as if shorten had returned same text 3 times; only the audit trail differs (now logs a "budget exhausted" warning). Editor reviews these on the sheet just like any other flagged cell.
- **Not a config key**: `SEG_BUDGET_MS` is a code constant, not a sheet key. Tweaking it requires a code edit. Made deliberately — it's a safety guard against pathological behavior, not a tuning knob editors should touch. If we ever observe that 90s genuinely caps healthy cells, we'd raise the constant in code.
- **No retry**: if a cell budget-exhausts, we DON'T retry that single cell with a fresh budget. Adding such a retry adds complexity (state tracking, second pass) and the cell is already flagged for human review — the marginal value is low. Could be added later if needed.

Verification: re-run the same FR lesson at batchSize=7. Expected: full 71 segments emit, no 300s timeout. Some cells (the same residual 2-3 we saw at batchSize=3) may still show `needs_attention=true` but with `final_speed=1.06` + `shorten_retries=3` — the LLM hitting its semantic floor, NOT the budget guard. Budget-exhaustion shows different log signature (the `console.warn` line in n8n execution logs).

Rollback: revert this commit. The budget guard is purely additive — removing the lines + restoring batchSize choice returns to prior behavior. No data migration needed.

Related: this completes the `2026-05-31` W3 shorten stack ([W3_SHORTEN_HAIKU_TO_GEMINI_FLASH](#2026-05-31--w3_shorten_haiku_to_gemini_flash) + [W3_SHORTEN_MIN_RETAIN_AND_PROMPT_REWRITE](#2026-05-31--w3_shorten_min_retain_and_prompt_rewrite)). The shorten work got more aggressive in quality (lower MIN_RETAIN + better prompt + better model), then required this guard to stay reliable in throughput. Net result: ~3.6% `needs_attention` rate at full ElevenLabs concurrency, in well under 300s per batch.

---

### 2026-05-31 — W2_EXTRACT_AUTO_RECOVERY_FOR_DROPPED_SEGMENTS

Context: On `spirio_meditations2_3_2_en_fix` re-runs of W2, Sonnet 4.6 in `Claude Translate` occasionally drops one entire batch of segments — returns HTTP 200 + valid-looking JSON but missing some `segment_id` keys. `Extract Translations` detects this and throws `Translator dropped N segment(s) … Re-run W2 to recover` (line 67). HTTP-level retries on the `Claude Translate` node do NOT fire because the response was 200; only Code-throw stops the workflow. Previously the user could just hit "Retry execution" in n8n UI and a fresh run usually returned a complete JSON; recently retries stopped helping (likely because prompt-caching of the system block makes Sonnet's response increasingly deterministic on repeat-cached prefixes within the 5-min TTL window).

Tried first (V1): lower `BATCH_SIZE` in Prepare and Expand from 8 → 4 to reduce the number of segments at risk per drop. Result: still dropped one batch (seg_021-024), just a different one. Conclusion: drops are roughly per-batch-probabilistic, not per-batch-content. Smaller batches don't reduce the rate; they only reduce the cost per drop event (fewer segments to recover).

Decision: Add **auto-recovery** to `Extract Translations`. When dropped segments are detected, instead of throwing immediately, attempt a per-segment Claude retry. Each retry sends ONE segment per Claude call with NO prompt-cache header. Single-segment calls are effectively immune to silent-drop (Claude can't "forget" the only segment it was asked to translate) and no cache prevents the cache-induced determinism the batch path may have hit. Only if individual retries also fail (genuine API error or refusal) does the node throw with the remaining unrecovered list.

Implementation in `code_nodes/extract_translations.js` (and embedded `Extract Translations` node in `workflows/W2_Translate_v2.json`):

- Added `parseClaudeBody(claudeResp)` helper extracted from inline try/catch — reused by both main batch parsing and per-segment recovery.
- Added `retryOneSegment(seg)` async function: builds a one-segment userMap, calls Sonnet 4.6 directly (no `cache_control`), parses, returns translations on success.
- Reads `anthropic_api_key` from config; throws a clear error if missing AND any drops detected.
- Reuses `translate_system` + `tone_of_voice` prompts via the same `loadPrompt` pattern Prepare and Expand uses, so the retry follows the same JSON-shape + ToV contract.
- Honors `active_langs` gate for both the userContent hint and the post-parse "filled langs" check.
- MAX_TRIES=3 per segment with exponential backoff (2s, 4s).
- Final `stillDropped[]` is what gets thrown. Adds "and auto-recovery failed" to the message so the user knows the easy path was already attempted.

Trade-offs:

- **Latency on drop runs**: each recovery is +1 API call (~2-3s). A run that drops 4 segments adds ~12s end-to-end. Acceptable — beats a full W2 re-run (~5-10 min).
- **Cost on drop runs**: each recovery is ~$0.001 (Sonnet 4.6 input ~3K tokens including non-cached system prompt + 200 tokens output). 4 drops = ~$0.004. Negligible.
- **Recovery quality**: a single-segment call lacks the cross-segment context the original batch had. The system prompt (ToV) is identical, so tone won't drift. But subtle within-batch consistency (e.g., choosing the same FR word for "breath" across consecutive segments) may differ slightly between recovery and batch translations. For meditation content this is rarely visible, but for technical/educational content with shared terminology it could matter. If observed, escalate to a 2-segment recovery batch (current segment + nearest non-dropped peer).
- **Loss of the "Re-run W2 to recover" UX habit**: editors who relied on the prior "just hit retry" pattern will now see recovery happen automatically and not realize the workflow had a near-miss. Mitigated by `console.log('Recovered ' + seg.segment_id)` for each recovered cell — visible in n8n execution logs.

`BATCH_SIZE` stays at 4 for now (the V1 change above). It doesn't reduce drop rate but it reduces the per-drop blast radius. Can be reverted to 8 if cost or latency matters more; the auto-recovery handles either.

Verification: re-run W2 single-lang FR on `spirio_meditations2_3_2_en_fix`. Expected outcome on the same drop-prone batches: recovery logs visible in execution, no `Translator dropped` error, all 71 segments emitted. If recovery genuinely fails (e.g., Sonnet refuses certain content even one-at-a-time), the throw message will list the unrecovered segments and the user can fall back to W_Regen with a manual translation.

Rollback: revert this commit. The throw-on-any-drop behavior returns; the user must rerun W2 manually as before.

Related: this fix is upstream of the W3 shorten work (Haiku→Gemini Flash + MIN_RETAIN + prompt rewrite). They're independent — W2 reliability and W3 compression-headroom are separate axes. Both stack into the same end-to-end run.

---

### 2026-05-31 — W3_SHORTEN_MIN_RETAIN_AND_PROMPT_REWRITE

Context: Stacked with the same-day [W3_SHORTEN_HAIKU_TO_GEMINI_FLASH](#2026-05-31--w3_shorten_haiku_to_gemini_flash) swap, BEFORE testing it on the residual 8/71 truncated FR cells. The user requested doing both levers simultaneously: lower the char-floor that lets the shortener return shrinkier output AND revise the system prompt to explicitly authorize aggressive cuts (rephrase, clause-drop, ellipsis substitution) instead of treating every modifier as load-bearing.

Decision: Two coordinated changes on top of the Gemini Flash swap.

1. **Lower `MIN_RETAIN` from 0.60 → 0.45.** In `code_nodes/check_timing_and_pad.js` and the embedded `Check Timing + Pad` node in `workflows/W3_Synthesize_v2.json`. This is the "do not go below" floor passed to the shortener prompt and re-checked when the result comes back:

   ```js
   floorChars = Math.max(0.45 × currentText.length, 0.85 × targetChars)
   ```

   With the old 0.60 floor on a 99-char input + slot target 68 chars: floor = `max(59, 58) = 59` — the percent floor binds. With 0.45 × 99 = 44 — now the target-driven 58 binds for THIS case. The change matters most for inputs where the percent floor was the binding constraint, which is exactly the residual 8 cells. Result: LLM has more latitude to return short rewrites that previously got rejected for going below 0.60 of input.

2. **Revise the `w3_shorten_system` prompt** in the Google Sheets `prompts` tab. The new text is checked into `prompts/proposed_changes/w3_shorten_system.md`. Five substantive changes vs the previous version:

   - Lead paragraph inverts the priority: "faithful approximation under target is ALWAYS preferred to perfect overshoot". Previous prompt's first lines emphasized meaning preservation, which Haiku optimized for at the expense of length.
   - Level `max` is explicitly redefined: it MAY rephrase, MAY drop one non-essential clause, MAY substitute ellipsis for a descriptive phrase. Previous max-level wording was vague about whether structural changes were allowed.
   - Adds concrete connector simplification examples ("dans la façon dont tu" → "comme tu") — these are the exact patterns that block FR shortening. Targets the specific failure mode observed in seg_046.
   - Adds "if already at floor → rephrase first, return same text as LAST resort". Previous prompt let the LLM short-circuit to "no change"; new prompt forces at least one rewrite attempt before giving up.
   - Adds explicit anti-meta rules: no `(already at N chars)` epilogue, no `Shortened:` prefix, no markdown wrapping, no quotes. Tightens the contract so `sanitizeLLMOutput` doesn't have to clean up as much.

   The prompt is plain text + a single `{{tov}}` placeholder, same shape as before. No code change needed to consume it — `loadPrompt('w3_shorten_system', { tov: TOV })` still works.

Why both at once: they address the same root cause from two angles. The MIN_RETAIN lever expands the *contract* (LLM is allowed to go shorter); the prompt rewrite expands the *willingness* (LLM is explicitly told to actually use that latitude). Either alone might be insufficient — Gemini might still refuse to drop modifiers even with a lower floor; or it might want to drop them but be capped by the floor on small texts. Together they should saturate the lever.

Trade-offs:

- **Quality risk on `max` level**: a more aggressive shortener may produce FR that loses subtle nuance ("un peu plus de poids" → "plus de poids" loses the meditative softness). Mitigated by `MAX_RETAIN_EXPANSION` already keeping growth bounded and by the existing Phase 2 expansion path catching cells that go too short. If we observe quality regressions in spot-checks, the lever to pull back is the prompt — keep `max` more conservative.
- **`MIN_RETAIN` is non-config**: hardcoded constant, not a sheet key. Tweaking it requires a code edit. If we end up wanting per-lesson or per-lang tuning, adding `min_retain_ratio` as a config key is straightforward. Not done now to avoid premature config-key proliferation.
- **Prompt revision is in Sheets, not code**: the canonical source of truth is the live `prompts` tab. The repo snapshot in `prompts/proposed_changes/w3_shorten_system.md` is a paste-target and a rollback reference, not the active prompt. If the user pastes a different value, the proposed_changes file goes stale until updated.

Verification (combined with the Haiku→Gemini swap): re-run W2 + W3 single-lang FR on `spirio_meditations2_3_2_en_fix`. Target `needs_attention=TRUE` rate ≤ 4/71 (≈5%). Cross-check that previously-flagged cells now show:
- `text_translated` materially shorter than the CSV 46 version (visible diff in length and possibly in phrasing — rephrase is expected, not just trimming)
- `real_duration_sec < slot_duration_sec` with `tail_silence_sec > 0`
- `final_speed` may drop from 1.06 ceiling to baseSpeed (0.86) on cells where the text now fits without speed-up needed

Rollback: revert this commit + paste the previous `w3_shorten_system` value back into the Sheets cell. Both halves are independent and safe to roll back separately.

Related: this is the third stacked lever after [FR_SPEED_HEADROOM_AND_CPS_LOWER](#2026-05-31--fr_speed_headroom_and_cps_lower) and [W3_SHORTEN_HAIKU_TO_GEMINI_FLASH](#2026-05-31--w3_shorten_haiku_to_gemini_flash). Together they target the FR-tight-slot failure mode from multiple angles: structural (W1 split → smaller slots), mechanical (max_speed_up_delta → more compression via TTS speed), CPS-target (cps_estimate_fr → more aggressive W2 Adapt), model (Haiku → Gemini Flash), floor (MIN_RETAIN), and prompt-license. If the residual rate after all six levers is still >5%, the next lever is per-cell escalation to Sonnet-4.6 for shorten — but that's a larger architectural change (parallel-attempt comparison) and we'd wait until the simpler levers are exhausted.

---

### 2026-05-31 — W3_SHORTEN_HAIKU_TO_GEMINI_FLASH

Context: After [FR_SPEED_HEADROOM_AND_CPS_LOWER](#2026-05-31--fr_speed_headroom_and_cps_lower) the FR `spirio_meditations2_3_2_en_fix` re-run dropped `needs_attention=TRUE` from 39% to 11% (8/71), but 8 residual cells all share the same fingerprint: `shorten_retries_in_synthesize=3`, `final_speed=1.06` (the new ceiling), `real_duration_sec == slot_duration_sec` (hard-truncated). Inspection of one case (seg_046, 99 chars / 6.88 s slot):

- The W3 single-segment shortener (`code_nodes/check_timing_and_pad.js` → `claudeShorten`) was calling Claude Haiku 4.5 with prompts `w3_shorten_system` + a dynamic task description. The function asks Haiku to shorten the current text to `~target_chars` while not going below a floor of `max(0.60 × current, target × 0.85)`.
- For seg_046 the floor was 59 chars — easily reachable. Yet across all 3 retry attempts (`light` → `medium` → `max`), Haiku returned the same 99-char text each time, appending a meta tag `(Already at N characters; cannot shorten further)` which `sanitizeClaudeOutput` strips. So `shortenRetries` ticked up to 3 but the text never actually shrank.
- Root cause: Haiku is conservative on meaning-preserving compression. When meditation FR text has dense modifiers ("un peu plus de poids dans tes pas, plus de présence dans la façon dont tu habites ton corps"), Haiku considers each modifier load-bearing and refuses to drop them, even when prompted at `ATTEMPT LEVEL: max`. The 3-retry loop is wasted because each iteration starts from the same input and Haiku's decision is deterministic at temperature 0.

Decision: Swap the W3 single-segment shortener from Claude Haiku 4.5 to **Gemini 3.5 Flash**, using the existing OpenAI-compatible endpoint (`generativelanguage.googleapis.com/v1beta/openai/chat/completions`) that W2 Editor + Phase 2 Editor already use. Changes:

- `code_nodes/check_timing_and_pad.js`: `HAIKU_MODEL` → `SHORTEN_MODEL = 'gemini-3.5-flash'`; `ANT_KEY` → `GEM_KEY` (reads `gemini_api_key` from config); `callClaude(systemBlocks, userText)` → `callGemini(systemPrompt, userText)` (single system string instead of Anthropic system-blocks array — Gemini's OpenAI-compatible endpoint accepts only one); `claudeShorten` → `geminiShorten`; `sanitizeClaudeOutput` → `sanitizeLLMOutput` (function body unchanged; rename only). The shorten loop call site `await claudeShorten.call(...)` → `await geminiShorten.call(...)`.
- `workflows/W3_Synthesize_v2.json`: same edits applied to the embedded `Check Timing + Pad` node's `jsCode`.
- `docs/external_review_briefing.md`: model reference for `w3_shorten_system` updated from Claude Haiku 4.5 → Gemini 3.5 Flash; brief paragraph updated to reflect new model + reason for swap.

Why Gemini 3.5 Flash specifically, not Sonnet:

- **Cost**: Gemini Flash is ~3× cheaper per call than Haiku and ~30× cheaper than Sonnet. The shorten loop fires only on cells where W2 Adapt left text too long for the slot (typically 5-15 cells per lesson per lang), so absolute cost is small either way — but cheaper-by-default is right when quality is similar.
- **Reuse of existing infra**: `gemini_api_key` is already in config (W2 Editor + Phase 2 Editor depend on it). No new credential setup, no new failure modes from misconfigured keys.
- **Behavioral hypothesis**: Gemini Flash follows numerical instructions ("shorten to ~68 chars, min 59") more literally than Haiku, which over-indexes on meaning preservation. Real test on next re-run will confirm. If Gemini also refuses to shrink, the fallback is option (A) lowering `MIN_RETAIN: 0.60 → 0.45` (gives the LLM more room to drop modifiers) or option (C) raising `max_speed_up_delta: 0.20 → 0.25` (gives more speed headroom).

Trade-offs:

- **Lost prompt caching**: Anthropic `ephemeral` cache_control on the static `SHORTEN_STATIC` block was saving ~80% on input tokens for repeat shorten calls within a lesson. Gemini has no equivalent, so each call pays full input cost. Per-call delta is tiny: SHORTEN_STATIC is ~1.7K chars + ~6.5K chars tone-of-voice; ~2K input tokens × $0.30/M = ~$0.0006 per call. Net cost is still lower than Haiku.
- **Loss of `system-blocks` structure**: Anthropic accepts `system: [block1, block2, …]` with per-block cache_control. Gemini's OpenAI-compatible endpoint accepts only one system message. Resolved by concatenating `SHORTEN_STATIC + '\n\n' + dynamicPart` into one system prompt.
- **One more dependency on Gemini availability**: if Gemini API has an outage, W3 shorten silently degrades to "no shorten" (each shorten attempt returns empty string → loop body keeps current text and increments `shortenRetries`; speed-up + truncate still fire). Same failure mode as Haiku outage was; just shifted vendor.

Verification: re-run W2 + W3 single-lang FR on `spirio_meditations2_3_2_en_fix` (W1 already produced the segments). Compare `needs_attention=TRUE` rate to 8/71 = 11%. Specifically check if the 8 previously-truncated cells (seg_021, 040, 044, 046, 050, 054, 063, 070) now have `text_translated` materially shorter than before (post-Gemini shorten) and `real_duration_sec < slot_duration_sec` with `tail_silence_sec > 0`.

Rollback: revert this commit. Both the standalone code node file and the workflow JSON revert atomically. Code defaults from before resume (Haiku 4.5 + anthropic_api_key from config sheet).

Related: this fix is about the LLM's behavior, not the prompt or the retry budget. If even Gemini Flash refuses to shrink, next levers are (A) lower `MIN_RETAIN` floor, (B) revise `w3_shorten_system` prompt to explicitly authorize dropping modifiers + using ellipsis. The prompt itself lives in the Google Sheets `prompts` tab; no code change needed for prompt revisions.

---

### 2026-05-31 — FR_SPEED_HEADROOM_AND_CPS_LOWER

Context: After [W1_INTRA_SENTENCE_SPLIT](#2026-05-31--w1_intra_sentence_split) the `spirio_meditations2_3_2_en_fix` lesson re-ran on FR single-lang produced 71 segments (from 63 — split worked) but `needs_attention=TRUE` rate stayed at 28/71 ≈ 39% (vs 19/63 ≈ 30% pre-split). Inspection of the flagged cells revealed:

- Almost every TRUE cell was `final_speed=1.01` AND `shorten_retries_in_synthesize=3` AND `real_duration_sec ≈ slot_duration` (hard-truncation at the slot ceiling).
- Many had CPS well above target — e.g. seg_013 "Ressens le doux mouvement de montée et de descente." 51 chars in a 2.4 s slot = 21.3 CPS.
- Root cause is the COMPOUND ceiling on the speed lever: FR voice runs at `voice.speed=0.86` (configured for FR prosody), and `max_speed_up_delta=0.15` set the speed ceiling to `0.86 + 0.15 = 1.01`. Effective compression vs an unspeed-up baseline is `1.01 / 0.86 ≈ +17%` — half the headroom a 1.0-base voice has (`1.15 / 1.0 = +15%`, but expressed differently: 0.86 voice has ~14% room to 1.0, then only 1% past). Phase 1 shorten exhausts its 3 LLM rewrite attempts AND both speed-up steps, then truncates.
- Adapt was also configured with `cps_estimate_fr=11` (the user had lowered it from 15 in an earlier calibration pass). Even at 11, W2 Adapt's char-budget was occasionally too loose because real observed FR CPS during meditation reads at 0.86 voice is ~9-10. So Adapt sometimes left text 10-20% over what fits — handing W3 an impossible job.

Decision: Two coordinated levers, both small enough that prosody stays acceptable:

1. **Raise `max_speed_up_delta` from 0.15 → 0.20.** Updates: `code_nodes/check_timing_and_pad.js`, `code_nodes/phase2_batch_llm_tts.js`, `code_nodes/regen_synthesize.js`, and the same defaults baked into `workflows/W3_Synthesize_v2.json` (2 occurrences) and `workflows/W_Regen.json` (1 occurrence). With 0.20: FR ceiling becomes 1.06 (+23% vs 0.86, vs +17% before). 1.06 is still well below the perceptual threshold for "fast voice" on a meditation read (~1.10). The default-1.0 voices' ceiling moves 1.15 → 1.20 — minor change, also acceptable. Live `config` sheet must also be updated to `max_speed_up_delta=0.20` (code defaults are fallbacks; sheet value takes precedence).

2. **Lower `cps_estimate_fr` from 11 → 10** in the live `config` sheet. Forces W2 Adapt to compute a tighter `target_chars` budget for FR, which makes the shorten loop more aggressive earlier (in W2, where LLM has full sentence-rewrite latitude) rather than punting the over-budget text to W3 (where only stepwise shorten + speed-up are available and the slot is already tight). Trade-off: occasional FR sentences may lose nuance that 1 extra char-budget point would have preserved. For meditation/wellness this is a good trade — clarity-of-pace beats word-precision when the voice is gentle and the slots are tight.

3. **No change to `voice.speed` for FR.** Keeping the 0.86 base preserves the "calm, settled" tone the editor chose. Moving it up to 0.90 would give more headroom but flatten the prosodic gentleness that the FR voice was tuned for.

Why both at once: independent levers stacked. (1) widens the speed ceiling for cases where text is already minimal but TTS overshoots. (2) reduces the frequency of (1) firing in the first place by making text shorter before TTS. Together they should push the FR `needs_attention` rate from 39% to a target <15% without re-tuning voice prosody.

Verification: re-run W2 + W3 single-lang FR on `spirio_meditations2_3_2_en_fix` after updating the two config sheet rows. Compare `needs_attention=TRUE` count: target ≤ 11/71. Spot-check 3 previously-truncated short slots (seg_013, seg_023, seg_030) to confirm they now end with audio < slot duration and tail silence > 0.

Rollback: revert the doc + code default changes; reset sheet to `max_speed_up_delta=0.15`, `cps_estimate_fr=11`. Code defaults are fallback-only — sheet values override regardless.

Related: this fix only helps the speed-headroom + text-budget axis. Sentences without internal pauses (the W1 split skipped them) and sentences with extremely high information density (CPS > 15 even after shorten) remain hard cases. Future levers: per-target-lang `max_segment_duration` (smaller for FR), per-content-type CPS overrides (educational vs narrative), or moving FR to 0.90 voice base.

---

### 2026-05-31 — W1_INTRA_SENTENCE_SPLIT

Context: A confidence-meditation lesson (`spirio_meditations2_3_2_en_fix`, 63 segments) hit 19 `needs_attention=TRUE` cells (~30%) on FR single-lang run. Diagnosis showed two compounding root causes:

1. FR voice base speed = 0.86; with `max_speed_up_delta=0.15` the ceiling is only 1.01 — almost no compression headroom (vs 1.15 ceiling for a 1.0 voice). Speed lever alone can't fit verbose FR into tight slots.

2. **W1 segmentation has no intra-sentence split.** Deepgram occasionally returns very long single sentences (real example: seg_063 = 28.9 s, seg_038 = 15.4 s). The existing `Segment Transcript` Code node only merges short consecutive sentences — it never breaks a long sentence into pieces. The result: an EN slot that is structurally impossible for FR (or any verbose target lang) to fit, even after Adapt/shorten/speed-up exhaust their levers — audio gets hard-truncated, losing the last syllable.

Of the 19 flagged cells, ~8 had multi-clause EN sentences ≥10s long with natural word-pauses between clauses — split-able. The remaining ~11 were short slots (4–6 s) with verbose FR; for those, only speed-headroom or text-rewrite fixes apply.

Decision: Add an intra-sentence split pass in W1's `Segment Transcript` node, between Deepgram parsing and the existing short-sentence merge loop. Greedy "largest-gap-first" algorithm:

1. For each Deepgram-returned sentence, if `duration ≤ MAX_SEG_DURATION` — keep as a single piece.
2. Otherwise, look at word-level timestamps (`alt.words[]`). Find every gap between consecutive words. Filter: `gap ≥ MIN_INTRA_PAUSE` AND each resulting half ≥ `MIN_PIECE_DURATION`.
3. Pick the largest valid gap. Split the sentence at that boundary — left half uses word ranges up to (and including) the gap-opening word; right half starts at the gap-closing word.
4. Re-evaluate each piece. If still over MAX, repeat. Stop when every piece fits or no more valid gaps exist.
5. Text per piece is reconstructed from `word.punctuated_word` joined by spaces (preserves original capitalisation + punctuation per word).

After split, the existing merge loop runs as before, with one ADDED constraint: combined segments must also satisfy `combined_duration ≤ MAX_SEG_DURATION`. Without this duration cap on merge, the very pieces produced by split would be eagerly re-merged back by the char-based merge rule (which only checked `MAX_CHARS=150 && gap≤1s`), defeating the split. So the split-then-merge pair now has matched semantics: both stages respect the per-segment duration ceiling.

Three new config keys (all optional, all with code defaults):

- `max_segment_duration_sec` — default `12`. Hard cap on segment duration. Any Deepgram sentence longer than this triggers split. Also applies as merge ceiling. Lower (8–10) for content with verbose target langs + slow voice profiles; higher (15) to behave closer to pre-fix.
- `min_intra_sentence_pause_sec` — default `0.25`. Minimum word-to-word gap considered as a valid split point. Below this, the silence isn't audibly a pause and splitting mid-flow would feel choppy.
- `min_segment_piece_duration_sec` — default `1.5`. Each side of a split must be ≥ this. Prevents creating micro-segments (e.g. a 0.3 s "Just." piece) that would feel abrupt.

Verification (mock unit tests in `/tmp/test_w1_split2.js`):
- 18 s sentence with one major 0.7 s pause + several smaller pauses, MAX=12: split into 8.3 s + 9 s (both ≤ 12, the major pause was picked).
- 12 s sentence with 0.4 s comma-pauses, MAX=10: split into 8.6 s + 4 s (largest pause within range picked).
- 12 s sentence, MAX=12: no split (already fits).

Trade-offs:
- More segments per lesson → more TTS calls (~+10–20% cost on lessons with many long sentences). Acceptable: re-TTS is ~$0.001/call.
- Build VTT cues become shorter, possibly more rapid-fire visually. For meditation/wellness this matches natural breathing rhythm; for educational content might feel choppy.
- Splits introduce a clean "pause break" in the dubbed audio at the split boundary, sized to the EN pause minus voice-rhythm. Since we split at natural pauses (≥0.25 s), this matches what the EN narrator did.
- Sentences without internal pauses ≥ MIN_INTRA_PAUSE stay un-split. For those, the existing speed-up + shorten loops are the only levers; this fix doesn't help them. Pair with raising `max_speed_up_delta` if needed.
- Per-language verbosity is global today. Future enhancement: per-target-lang `max_segment_duration` (smaller for FR/IT/PT, larger for DE which is verbose but matches EN structure more closely).

Verification on a re-run: rerun W1 on the same audio for `spirio_meditations2_3_2_en_fix`. Expect: total segment count rises from 63 → ~70 (the long sentences become 2–3 pieces). Re-run W2 + W3 single-lang FR. Expect: `needs_attention=TRUE` count drops from 19 → ~5–8 (only the structurally tight short-slot cases remain).

Rollback: revert this commit. `Segment Transcript` reverts to merge-only logic. The 3 new config keys are optional, so deleting them from the config sheet returns to defaults that are equivalent in spirit to the old MAX_CHARS-only rule.

---

### 2026-05-28 — W_REGEN_DRIVE_DEDUPE_ON_SAVE

Context: First W_Regen design called `Save Full to Drive` and `Save VTT to Drive` (cloned from W3) to upload regenerated full WAV / VTT files. The n8n googleDrive Upload node, by default, creates a NEW file every time — Google Drive does not auto-overwrite by name, so a folder accumulates duplicates: `sleep1_full_full_de.wav`, `sleep1_full_full_de (1).wav`, `sleep1_full_full_de (2).wav` and so on after each regen run.

For W_Regen this is unacceptable: the whole point is to publish a fixed audio bundle to a known location. The content editor expects the canonical file at the canonical path. Duplicates also break any downstream consumer that picks "the file by name" (course platform, Slack share link, etc).

The original DECISIONS 2026-05-10 DRIVE_OVERWRITE_NOT_SUPPORTED noted this gap and deferred the fix to "Week 4: auto Search → Delete → Upload". This entry lands that fix, scoped to W_Regen first.

Decision: Insert a `Pre-Save Cleanup` Code node between each Build/Save pair in W_Regen. The Cleanup node uses Drive API directly via `httpRequestWithAuthentication` (with the `googleDriveOAuth2Api` credential) to:

1. For each input item, infer target folder from file extension: `.wav` → `drive_output_full_folder_id`, `.vtt` → `drive_output_vtt_folder_id` (with fallback to `drive_output_folder_id` if the dedicated folder keys are missing).
2. List Drive files with `name = '<file_name>'` in that parent folder (`trashed = false`).
3. For each match: HTTP DELETE (hard delete, not trash) via `/drive/v3/files/{id}`.
4. Pass input items through unchanged so the downstream Save node uses the original binary.

Two instances added to W_Regen:
- `Pre-Save Cleanup Full` between `Build Full Audio Per Lang` and `Save Full to Drive`.
- `Pre-Save Cleanup VTT` between `Build VTT Per Lang` and `Save VTT to Drive`.

Both reference the same `code_nodes/predelete_drive_files.js` source. The folder selection is based on the item's `file_name` extension, so one shared code path handles both. `executeOnce: true` mirrors the Build/Save nodes — fires once after all per-row updates.

Per-segment WAVs (`{segment_id}_{lang}.wav` in `drive_output_folder_id`) are NOT affected by this change — they're already overwritten in place via Drive PATCH against `audio_drive_file_id` (no duplicate possible because the file_id is the address).

Implementation notes:
- The single-quote escape (`fileName.replace(/'/g, "\\'")`) in the Drive `q` query handles file names containing apostrophes (rare in lesson IDs but safe).
- `supportsAllDrives=true` + `includeItemsFromAllDrives=true` cover both My Drive and shared drives.
- `httpRequestWithAuthentication.call(this, 'googleDriveOAuth2Api', ...)` is the n8n Code-node helper for OAuth-credentialed HTTP calls; same credential type the Save nodes use, so no separate credential setup needed.

Rationale: Drive API doesn't have native upsert-by-name. The two alternatives — storing file IDs in a sidecar sheet and PATCHing by ID, or building a conditional IF-create-else-update graph — both add either persistence layers or multiple new HTTP nodes per save. The search-delete-create approach in a single Code node is the smallest delta and lives entirely inside W_Regen.

Trade-offs:
- Brief window between Delete and Create where the file doesn't exist (~1-2s). A consumer hitting the folder at exactly that moment would see "file not found" temporarily. Acceptable for editor-driven manual regen; not a high-throughput service.
- If `Save` fails after `Delete` succeeded, the file is lost until next regen. The downstream Save node has its own error surfacing in n8n; operator sees the failure and can re-run W_Regen. Original file content survives if it's referenced anywhere (e.g. cached in CDN); but the Drive copy is gone.
- This change is W_Regen-only. W3 normal run still creates duplicates on re-run. Out of scope for this commit; can apply same pattern to W3's Save Full / Save VTT in a follow-up.
- Hard delete (not trash). Operator can't recover from Drive Trash. Acceptable because the canonical content is being replaced immediately; if Save fails, operator just re-runs.

Verification: re-run W_Regen twice on the same lesson with one row flagged each time. Expect (a) the Drive full/ and vtt/ folders contain exactly one file per (lesson_id, lang, file_type) — no `(1).wav` or `(2).vtt` duplicates, (b) console logs `Pre-Save Cleanup: deleted 1 existing files, 0 errors` on the second run (and `deleted 0` on the first if folder was empty), (c) the new file has a fresh `file_id` (because we deleted-and-created, not patched), (d) consumers reading by file name still find one canonical file.

Rollback: remove the two Cleanup nodes from W_Regen, rewire Build → Save directly. The Cleanup is purely additive; removing it returns to the duplicate-creating behavior. Code file `code_nodes/predelete_drive_files.js` can stay (unused) or be deleted.

---

### 2026-05-28 — W_REGEN_MANUAL_CELL_REGENERATION

Context: For production launch (28 videos/month, content editor as primary operator), there must be a low-friction way to fix individual cells without re-running the full W_Master → W2 → W3 pipeline (which takes ~15-25 minutes per lesson and costs ~$6 in API calls). Pre-launch the only "fix" was: edit the text in the segments tab and re-run W_Master end-to-end. For a content editor reviewing ~280 cells per lesson and finding maybe 3-10 to fix, that's prohibitively expensive in both time and money.

User explicitly asked for a manual-trigger workflow where editor selects what to regen via sheet flags then clicks a button to execute. Also asked about adding "comments" to influence the regeneration. Decision below splits the editor flow into MVP (ships now) and v2 (LLM-driven rewrite from comments, defers).

Decision: Build a new standalone workflow `W_Regen — Manual cell regeneration` with the following shape:

**Schema additions to `localizations` sheet** (operator must add columns before first use):
- `needs_retts` (TRUE/FALSE) — editor's regen flag.
- `regen_comment` (text) — editor's note. Audit-only in MVP; not consumed by pipeline.
- `last_regen_at` (ISO timestamp) — bookkeeping, set by W_Regen.

**Editor flow:**
1. Open localizations sheet, find row(s) to fix.
2. Edit `text_translated` (and any other content fields).
3. Set `needs_retts=TRUE`. Optionally add `regen_comment`.
4. Open W_Regen in n8n, click **Execute Workflow**.

**Workflow architecture (15 nodes):**

```
Manual Trigger
 → Read Config → Read Voices → Read Localizations Initial
 → Get Params (Code: resolves single lesson_id from flagged rows, errors if multi-lesson, prepends sentinel item with lesson_id for Build Full/VTT)
 → Regen Engine (Code: filters needs_retts=TRUE, per-row ElevenLabs TTS, Phase 1-style timing — speed-up retry on overshoot + slowdown-to-fill on residual silence — bounded parallel via `regen_concurrency` config)
 → Has Audio? IF
   ├── [true]  → Drive PATCH (overwrite per audio_drive_file_id) → Merge Branches
   └── [false] → Merge Branches
 → Update Localizations Row (Sheets appendOrUpdate by row_key; writes new metrics, clears needs_retts, sets last_regen_at, preserves regen_comment for audit)
 → Read Localizations Fresh (executeOnce — single re-read after all updates)
 → Build Full Audio Per Lang (cloned from W3, executeOnce, reads lesson_id via Get Params sentinel) → Save Full to Drive
 → Build VTT Per Lang (cloned, executeOnce) → Save VTT to Drive
```

**Key design choices:**

1. **Manual trigger, not polling.** User explicitly chose this — editor controls when regen fires. Operationally simpler than polling cron + scheduler maintenance, and instant feedback on errors (operator sees error in n8n UI immediately).

2. **Single-lesson constraint per run.** Get Params throws if flagged rows span multiple lessons. Build Full and VTT need a single `lesson_id` to filter what to concatenate. If editor needs cross-lesson regen, run W_Regen separately per lesson. Acceptable MVP trade-off; covers 95% of expected use (editor reviews one lesson at a time).

3. **Get Params sentinel pattern.** Existing W3 code (Build Full / Build VTT) reads `$('Get Params').first().json.lesson_id`. Rather than rewriting that code, W_Regen's Get Params prepends a synthetic item carrying `lesson_id` so the W3 read pattern works unchanged. Other downstream nodes see the sentinel as a regular item but filter it out (no `needs_retts`).

4. **Inline Drive PATCH (per-item HTTP), not Loop+Update batch.** Each flagged cell's audio_drive_file_id flows through Drive PATCH HTTP node, which iterates items by default. Same pattern as Phase 2's Drive Update. Sequential (n8n default for HTTP nodes) at ~1-2 calls/sec — fine for 5-10 cells per run.

5. **Auto rebuild Full Audio + VTT after regen.** `executeOnce: true` on Read Localizations Fresh + Build Full + Save Full + Build VTT + Save VTT ensures these fire ONCE after all per-row Updates complete (not once per item). Operator gets fully-rebuilt lesson audio + VTT in one click.

6. **Phase 1-style timing in Regen Engine.** Mirrors `check_timing_and_pad.js` synth logic: initial TTS at voice.speed, speed-up retry `[+Δ⅔, +Δ]` if overshoot, slowdown-to-fill toward `voice.speed - max_slow_down_delta` if remaining silence > `slowdown_min_gap_sec`. Targets `phase1_final_duration` as exact slot length so the rebuilt full WAV stays EN-aligned across all langs.

7. **`needs_attention` re-evaluated on regen.** If regen output is `ratio < 0.70` of `en_duration`, flag is re-raised. Editor can then re-edit + re-flag if needed. Mirrors Phase 2 acceptance threshold.

8. **`regen_comment` deferred.** User wanted "comment" mechanism to influence regeneration. MVP saves it for audit (visible in sheet) but doesn't process. Three reasons: (a) 90% of editor fixes are direct text edits (add "...", fix typo, change word, fix gender) — no LLM needed; (b) LLM-rewrite from comment is a substantial feature that needs its own prompt + testing; (c) shipping MVP without it now is better than blocking on comment-rewrite. V2 can add an LLM "Apply Comment" stage between Get Params and Regen Engine.

**New code files:**
- `code_nodes/regen_synthesize.js` — Regen Engine logic (TTS + pad + WAV build per row, with bounded parallelism via `regen_concurrency` config, default 5).

**Reused code (cloned from W3):**
- Read Config / Read Voices / Read Localizations Fresh — Sheets read configs.
- Phase 2: Drive Update → Drive PATCH (URL template uses `$json.audio_drive_file_id`).
- Phase 2: Update Localizations → Update Localizations Row (column mapping rewritten to use `$json.X` instead of `$('Phase 2: Batch LLM+TTS').item.json.X`; added new columns `needs_retts`, `last_regen_at`, `regen_comment`).
- Build Full Audio Per Lang + Save Full to Drive — concat + upload.
- Build VTT Per Lang + Save VTT to Drive — subtitles + upload.

**New config key (optional):**
- `regen_concurrency` (default 5) — bounded parallelism for per-row TTS calls in Regen Engine. Tune up on Scale tier, down for throttling.

**Cost per regen run:**
- ElevenLabs: N × (1-3 TTS calls per cell, depending on speed-up retries) — ~$0.01-0.05 per cell.
- Sheets: ~3-4 API calls per cell + 2 full reads.
- Drive: 1 PATCH per cell + 2× saves (full WAV + VTT).
- Total: ~$0.05-0.20 per regen of 5 cells. Negligible.

**Wall-clock per regen run** (10 cells in a 47-segment lesson):
- TTS: ~10 cells × ~3-5s with speed-up = ~30-50s (parallelized at concurrency=5).
- Drive PATCH: ~10 × ~1s = ~10s.
- Sheet updates: ~10 × ~0.5s = ~5s.
- Full rebuild: ~30-60s (concat + VTT + Drive uploads).
- Total: ~75-130s, well under 300s task-runner limit.

Trade-offs:
- Single-lesson constraint adds friction for multi-lesson cross-fixes (rare; documented).
- `regen_comment` deferred means editor can't use natural-language instructions for now — must directly edit text. Acceptable workaround documented.
- W_Regen workflow JSON is 15 nodes — added to repo as `workflows/W_Regen.json`. Operator must import once.
- Operator must add 3 new columns (`needs_retts`, `regen_comment`, `last_regen_at`) to the live localizations sheet before first use — one-time setup, documented in `docs/sheets_schema.md`.

Verification: dry-run by setting `needs_retts=TRUE` on one row in a test lesson, click Execute on W_Regen. Expect: (a) the row's Drive WAV gets overwritten in place (same file ID, new content), (b) row's `real_duration_sec` / `tail_silence_sec` / `final_speed` updated, (c) `needs_retts` cleared, (d) `last_regen_at` populated, (e) `{lesson_id}_full_{lang}.wav` and `.vtt` files in Drive's full folder rebuilt with the regenerated cell.

Rollback: delete `workflows/W_Regen.json` and the 3 new sheet columns. The rest of the pipeline (W1 / W2 / W3 / W_Master) is unchanged — W_Regen is purely additive.

---

### 2026-05-28 — W3_PHASE2_FALSE_FRIEND_LINT

Context: After the LLM_REFUSAL_DETECTION fix shipped, the sleep1_full run's `seg_019_es` showed another class of cross-cell contamination that LLM-level safeguards (`LANGUAGE ISOLATION` section in expand prompts, Verify CLASS 1 false-friend rules, Editor CLASS A anglicism) had failed to catch:

> "...sino porque es essencial. Recuerda lo primeiro que te dicen cuando estás ansiosa..."

- "essencial" is the **Portuguese** spelling (double-s) of "essential"; Spanish uses "esencial" (single-s).
- "primeiro" is the **Portuguese** word for "first"; Spanish uses "primero".

Both leaked from the PT cell of the same segment in Opus's batched JSON output. The defenses in place — `LANGUAGE ISOLATION` block in `w3_expand_batch_system` warning Opus not to bleed Romance spellings, plus Verify's CLASS 1 false-friend check on Sonnet — are prompt-based and probabilistically miss one-cell-per-batch slips, exactly the failure shape the project's DECISIONS log has documented before (R6.c, PHASE2_TUNING_POSTRETRY, formality_lint introduction).

The pattern from Formality Lint (2026-05-27) applies here directly: deterministic regex detector + targeted LLM fix, run at the synthesis gate. 100% recall on listed markers; false-positives are harmless because the fix prompt returns text unchanged when already clean.

Decision: Add a `False-Friend Lint` deterministic pass in `phase2_batch_llm_tts.js`, called from `runReTtsTasks` BEFORE `fixFormalityInTasks` (so formality detector sees post-fix text). Three new components:

1. **`FALSE_FRIEND_PATTERNS`** — per-target-language regex arrays focused on Romance cross-contamination (ES, PT, IT, FR). Patterns chosen for HIGH PRECISION — they never match valid target-language text:
   - **ES** (Spanish): `[ãõ]` (PT diacritics), `\bessenc` (PT "essencial"), `\bprimeir[oa]\b` (PT word), `\bnecessári[oa]\b` (PT spelling), `\bmissão\b`, `\banche\b` (IT), `\bmolto\b` (IT).
   - **PT** (Portuguese): `[ñ]` (ES letter), `\besencial\b`, `\bprimer[oa]\b`, `\bnecesari[oa]\b`.
   - **IT** (Italian): `[ãõçñ]` (PT/ES/FR diacritics), `\bessenc` (IT uses essenz-), `\bprimer[oa]\b`, `\bmuy\b`, `\bahora\b`.
   - **FR** (French): `[ñãõ]`, `\bnecessary\b` (EN), `\besenci`.
   - DE/PL/TR: distance from Romance large enough that cross-leak is rare. Empty for now; add patterns if observed.

2. **`hasFalseFriend(lang, text)`** — single-match-any boolean. Used by the lint loop to mark cells for fix.

3. **`fixFalseFriendsInTasks(tasks)`** — mirrors `fixFormalityInTasks` exactly: collects flagged cells per (sid, lang), sends them in one batched Anthropic call (`claude-sonnet-4-6`, cached system prompt), applies returned corrections in place on task.newText. Logs flagged count per lang + applied fix count + stillContaminated count (cells where fix didn't clear the marker, for follow-up).

4. **`false_friend_fix_system`** prompt — optional Sheets row, with built-in default. Default lists common contaminations per direction (PT→ES, ES→PT, ES/PT→IT, EN/ES→FR) and explicit substitution rules. Returns text UNCHANGED when target lang is already clean — so over-flagging is harmless.

Integration in `runReTtsTasks`: `fixFalseFriendsInTasks` runs FIRST (cross-lang first), then `fixFormalityInTasks` (formality second, sees post-fix text). Both run before any re-TTS call, so the audio synthesized always reflects post-fix text.

Test coverage (synthetic + real, 9/9 pass):
- ✓ Real seg_019_es ("essencial" + "primeiro") → detected
- ✓ Normal ES translation → not flagged
- ✓ Normal PT translation (with proper ã/õ) → not flagged
- ✓ PT contamination with ñ → detected
- ✓ IT contamination with "essenc" → detected
- ✓ Normal IT ("essenziale") → not flagged
- ✓ IT contamination with "ahora" → detected
- ✓ Normal FR ("essentiel") → not flagged
- ✓ ES with PT proper noun "João" → detected (edge case; could whitelist if needed for proper nouns)

Rationale: The false-friend leak class is exactly what Formality Lint already addresses for formal-address creep — same architectural pattern (deterministic detector + targeted LLM fix) is reused here. The two lints together cover ~all known categorical leaks in Phase 2 output before re-TTS.

Trade-offs:
- +1 batched Anthropic call per Phase 2 iteration when at least one cell is flagged (rare). Cost negligible. Cached system prompt → ~$0.001-$0.005 per fix-call.
- Proper-noun edge case: a PT name like "João" appearing inside an ES translation triggers the `[ãõ]` pattern. The LLM fix prompt is smart enough to keep proper nouns (it's instructed to preserve meaning/length), but if observed false-positive correction, can whitelist via a "do not change inside quoted spans" rule in the prompt.
- DE/PL/TR are not currently covered. Romance contamination of DE/PL/TR is structurally unlikely (different alphabets/grammar), but if observed in production, add per-lang pattern lists.
- Some legitimate cross-lang technical terms (e.g. Sanskrit "prana" — appears in DE/ES/PT/IT/FR alike) are NOT in the pattern lists, so unaffected.

Verification: re-run sleep1_full lesson. Expect (a) seg_019_es text rewritten to "esencial"/"primero" — observe in localizations sheet, (b) console logs `Phase 2 false-friend: 1 flagged cells, fixing before re-TTS {"es":1}` followed by `applied 1 fixes`, (c) no new false-positive corrections on the other ~570 cells, (d) `phase2_outcome=accepted` for the affected cell with the corrected text.

Rollback: revert this commit. Lint is non-invasive — removing it returns to pre-fix behavior. Patterns and fix prompt are self-contained in the Phase 2 node; no other workflow nodes depend on it.

---

### 2026-05-28 — W3_PHASE2_LLM_REFUSAL_DETECTION

Context: First full sleep1_full lesson run on the patched W3 stack (Opus 4.7 on Phase 2 Expand + diff-first + diversity + gender prompts + SplitInBatches loop) surfaced a critical production failure: `seg_020_fr` shipped with `text_translated` set to an English meta/refusal message:

> "You're absolutely right to flag this. I cannot complete this task as written because the "CURRENT TRANSLATION" input doesn't correspond to the "ORIGINAL EN TEXT" at all."

Opus 4.7 detected what it considered a mismatch between EN source and the `current` French translation, and instead of doing the requested expansion it "broke character" and emitted English refusal text. This text passed through `Verify` (Sonnet 4.6) and `Editor` (Gemini Flash) unchanged — both prompts target language-quality and semantic correction, not LLM-meta detection — and reached `reTtsOne`, which synthesized it via ElevenLabs. The resulting audio is English refusal text spoken in a French voice, shipped to production Drive.

For a content editor doing minimal-effort review (the production launch operator model), this slip would be hard to catch from sheet skim alone: the row has `phase2_outcome=accepted`, no `needs_attention` flag, `final_speed` looks normal. Only a deep text-level audit catches it.

Decision: Add deterministic refusal detection in `phase2_batch_llm_tts.js`, applied right before each re-TTS task batch is built (both attempt 1 and the retry path). Output text matching English refusal/meta patterns is rejected; the cell falls back to Phase 1 audio.

Implementation:

1. **`REFUSAL_PATTERNS` array** — 9 high-precision regexes covering common LLM refusal/meta phrasings:
   - `\bI (?:cannot|can'?t|am unable to|will not|won'?t|need to|have to|should not|shouldn'?t)\b`
   - `\bYou(?:'re| are)\s+(?:absolutely\s+)?right\b`
   - `^Note:\s` (multiline, catches `Note:` preambles)
   - `\b(?:input|task|translation|output|CURRENT|ORIGINAL EN|prompt)\b[^.\n]*\b(?:doesn'?t|does not|cannot|can'?t|won'?t)\b`
   - `\bI(?:'ll| will)\s+(?:need|have)\s+to\b`
   - `\bSorry,?\s`
   - `\bAs an AI\b`
   - `\bI apologize\b`
   - `\bThis (?:translation|text|input|task) (?:doesn'?t|does not|is not|isn'?t)\b`

2. **`looksLikeRefusal(text)` function** — early-returns false for short text (<20 chars), else returns true on any pattern match. Single-match sufficient (chose high precision; observed real-world refusal matched 3+ patterns).

3. **Attempt 1 integration** — in the `reTts1Tasks` build loop, after `final1TextMap[sid][lang]` is constructed (post-Verify + post-Editor), check `looksLikeRefusal(newText)`. If true: push synthetic outcome `{ sid, lang, outcome: 'llm_refusal' }` to `droppedResults1`, log to console, store sample (up to 5) in `phase2Diag.refusalsAttempt1`. The cell is excluded from re-TTS; `pickFinal` will fall through to attempt 2 (if accepted) or Phase 1 audio.

4. **Retry integration** — in `runRetryGroup`'s `reTtsRetryTasks` build loop, same check. If retry text is a refusal: don't add to retry tasks, don't record attempt 2 (so attempt 1 stands if it was accepted). Log + sample tracked in `phase2Diag.refusalsRetry`.

5. **No retry of refusal cells from attempt 1** — refused attempt 1 outcomes are NOT pushed into `harderTasks` (the retry classifier only pulls `no_change`, `still_short`, `overshoot`). Intentional: if Opus refused once, retry-harder is unlikely to succeed on the same input. Phase 1 audio fallback is the safe answer.

6. **Diagnostics** — `phase2Diag.refusalsAttempt1` and `phase2Diag.refusalsRetry` arrays capture up to 5 samples each (sid, lang, first 200 chars of refusal). Surfaced on first emitted item's `json.phase2_diag`.

Test coverage (synthetic + real samples, 8/8 pass):
- ✓ Real seg_020_fr refusal text → detected (true)
- ✓ Normal FR, ES, DE translations → not flagged (false)
- ✓ Short IT phrase ("Sì.") → not flagged (length guard)
- ✓ ES translation containing 'no puedo' → not flagged (Spanish phrase, not English refusal)
- ✓ Apologize variant → detected
- ✓ `Note:` meta → detected

Rationale: Refusal-output detection is one of the few classes of LLM failure that's hard for content editors to catch from a sheet skim — the row looks "accepted", text is grammatically clean (just in the wrong language), and the failure manifests only in the audio. A deterministic regex check at the synthesis gate is the right safety net: it converts a silent quality failure into a visible `phase2_outcome=llm_refusal` flag + Phase 1 audio fallback. Phase 1 audio for these cells contains the W2 translation (not Opus), which by construction doesn't refuse.

Trade-offs:
- False positives: rare but possible. A legitimate translation containing English quoted speech could trigger. In meditation/wellness content, English quotes are virtually never in target translations, so risk is low. If observed, extend `looksLikeRefusal` to require quote-context absence.
- False negatives: if Opus refuses in target language, English-only patterns miss. Empirically Opus refuses in English even when target is non-English. If observed, extend with per-lang refusal phrasing.
- Refusal cells lose Phase 2 improvement (restoration, ToV decoration, gender fix). Phase 1 W2 translation kept instead. Acceptable — Phase 1 text is content-correct, just shorter.

Verification: re-run sleep1_full. Expect (a) seg_020_fr (and similar) emit with `phase2_outcome=llm_refusal`, `text_translated` reverted to Phase 1 W2 translation, (b) audio in Drive unchanged from Phase 1, (c) console logs `Phase 2 attempt 1: LLM refusal detected for X_Y`, (d) `phase2_diag.refusalsAttempt1` lists samples, (e) zero new false-positive refusals on rest of lesson's cells.

Rollback: revert this commit. Detection is non-invasive — removing it returns to pre-fix behavior.

---

### 2026-05-28 — W2_ACTIVE_LANGS_GATE

Context: `active_langs` historically gated only W3 — translation/QA/editor/adapt always ran on all 7 langs regardless. Single-lang dry-runs (e.g. test a new ToV with just `de`) still paid the full Claude/Gemini bill (~$0.05–0.10 per lesson on W2 alone). The cost is dominated by output tokens on Translate + input+output on Verify/Editor/Adapt, all of which scale linearly with lang count.

Decision: Push the `active_langs` filter into every W2 stage. Implementation:

- **Prepare and Expand** — reads `configMap.active_langs`; when restricted, prepends a per-batch user-content instruction (`"IMPORTANT: For this batch, output translations ONLY for these language codes: de"`) so Claude emits only the requested lang keys. System prompt (in the `prompts` sheet) is untouched — user-level override is sufficient and avoids prompts-sheet edits. Also emits `active_langs` on each batch item for downstream debugging.
- **Extract Translations** — `REQUIRED_LANGS` narrows to active set; output items carry `*_text` only for active langs. Inactive lang columns in `segments` are preserved because `Update Sheet` uses `autoMapInputData` (writes only columns present in items, never blanks absent ones).
- **Verify Translations / Gemini Editor / OpenAI Editor / Adapt Translations / Formality Lint** — all narrow their `LANGS` array via the same `(configMap.active_langs || '').trim().split(',').filter(l => ALL_LANGS.includes(l))` snippet; `userMap` builds and iteration loops only include active langs.

Failure mode: empty/invalid `active_langs` after filter (e.g. `active_langs=xx`) → each node throws fast with "active_langs filter produced empty lang list — check config" rather than silently translating to zero langs.

Cost impact (single-lang dry-run, `active_langs=de`):
- W2 Claude Translate output tokens: −85% (one lang in output instead of seven)
- W2 Verify + Gemini Editor input+output: −85% (six langs not sent in userMap)
- W2 Adapt: −85% wall-clock + Claude calls (six langs of cells never enter the task list)
- W2 Formality Lint: −85% scan surface
- W3 TTS: −85% (gate already existed)
- Estimated total per lesson: ~$0.02–0.04 instead of ~$0.10–0.25

Sync tooling: `scripts/sync_w2_jscode.js` mirrors `code_nodes/*.js` → corresponding `parameters.jsCode` strings in `workflows/W2_Translate_v2.json`. Idempotent. Verify Translations lives only inline in the workflow JSON (no reference file under `code_nodes/`); its `jsCode` was patched directly.

Re-run cost: re-running W2 with a wider `active_langs` later does NOT re-translate already-populated lang columns — Read Pending Segments filters on `status`/translation completeness. To regenerate a specific lang, clear that cell in the segments sheet first.

---

### 2026-05-28 — W3_PHASE2_SPLIT_IN_BATCHES

Context: Immediately after `W2_ADAPT_SPLIT_IN_BATCHES` shipped, the same 300s task-runner timeout hit `Phase 2: Batch LLM+TTS` on the 82-segment lesson. Phase 2 is significantly more work-dense than W2 Adapt:

- LLM stages: Expand (Opus 4.7, ~3x slower than Sonnet) → Verify (Sonnet) → Editor (Gemini) — each parallelized via `CHUNK=6`, ~30-60s total
- Re-TTS: every accepted candidate gets a base TTS call + optional speed-up retry (1-2 extra calls if overshoot) + optional slowdown retry (1 extra if silence remains). For 100 accepted cells = ~150-300 ElevenLabs calls.
- Retry pass (attempt 2): full pipeline again on a subset (still_short, overshoot, no_change cells).

Wall-clock for 82-segment lesson: estimated ~250-400s including Opus latency + speed-up TTS explosions. Hit ceiling.

Same architectural answer as W2 Adapt: wrap in `SplitInBatches` so each iteration runs under 300s. But Phase 2 has more downstream complexity — its emit fans through `Has Binary?` → `Drive Update`/direct → `Merge Branches` → `Update Localizations`, which is then read by `Download Segment WAV` + `Build VTT Per Lang`.

Decision: Wrap the entire Phase 2 chain (Batch LLM+TTS → Has Binary? → Drive Update → Merge → Update Localizations) in a `SplitInBatches` loop, with sheet roundtrip to persist state across iterations. Two new W3 nodes:

1. **`Loop Phase 2`** (`n8n-nodes-base.splitInBatches` v3, batchSize=105) — placed between `Read Localizations Fresh` and `Phase 2: Batch LLM+TTS`. batchSize=105 because Phase 2 input is per-row (segment×lang), and 15 segments × 7 langs = 105 rows fits the "~15 segments per batch" target that worked for W2. Each iteration runs the full attempt-1 + attempt-2 + emit chain.

2. **`Read Localizations Fresh 2`** — cloned config from existing `Read Localizations Fresh`. Reads the localizations tab AFTER all Phase 2 iterations complete, giving Download + Build VTT the fully-updated row set (all 574 rows with their post-Phase-2 audio_drive_file_id, phase2_outcome, text_translated, etc).

Wiring change:
- `Read Localizations Fresh` → `Loop Phase 2` (was: → Phase 2 directly)
- `Loop Phase 2[output 1, body]` → `Phase 2: Batch LLM+TTS` → Has Binary? → Drive Update → Merge → `Phase 2: Update Localizations` → `Loop Phase 2` (loop-back)
- `Loop Phase 2[output 0, done]` → `Read Localizations Fresh 2` → `Download Segment WAV` + `Build VTT Per Lang` (parallel fan-out, was directly from Phase 2: Update Localizations)

Wiring NOT changed:
- Has Binary? / Drive Update / Merge Branches / Update Localizations connection topology — they all stay in the loop body.
- Update Localizations explicit field mappings using `$('Phase 2: Batch LLM+TTS').item.json.X` — pairedItem chain is preserved within each iteration.

Code change to `phase2_batch_llm_tts.js`: **none**. Same as W2 Adapt — it reads `$input.all()` and emits per row, works on any batch size. The `passthrough` emit logic correctly handles partial input (each batch's non-candidates are emitted as passthrough; across all iterations, the full 574-row set still reaches Update Localizations and via sheet roundtrip).

Math: 15 segments × 7 langs = 105 rows per batch. Typical candidates per batch: ~30 cells. Per-batch wall-clock:
- LLM (Expand Opus + Verify Sonnet + Editor Gemini, CHUNK=6 parallel): ~30-60s
- Re-TTS attempt 1 (~30 cells × avg 6s with speed-up/slowdown, ELEVENLABS_CHUNK=5 parallel): ~40-80s
- Retry pass (~5-10 cells subset): ~20-40s
- Sheet write (Update Localizations appendOrUpdate, ~105 rows): ~5-10s
- Per-batch total: ~95-190s. Comfortable buffer under 300s.

For an 82-segment lesson (6 batches): ~10-19 min total Phase 2 wall-clock. For 90-seg lesson (6 batches): ~12-20 min. Same scaling as pre-fix but without ceiling risk.

Rationale: Mirrors the W2 Adapt fix one-for-one and matches W3 Phase 1's existing `Loop Over Items` pattern. The sheet roundtrip at the end is identical to what Read Localizations Fresh already does upstream — symmetry. The decision to use TWO separate reads (original + 2) instead of re-firing the first is for explicit dataflow: Read Loc Fresh kicks off Phase 2, Read Loc Fresh 2 confirms post-Phase-2 state for downstream concat.

Trade-offs:
- Sequential outer batches (n8n SplitInBatches default): we lose intra-Phase-2 parallelism that previously ran all batches in one Code-node execution with `CHUNK=6` parallel. Wall-clock total is similar (sum of sequential batches ≈ original parallel-then-serial work) but without the ceiling risk.
- +1 sheet read per lesson (Read Loc Fresh 2 instead of zero). Minimal cost.
- Sheet writes happen per outer batch instead of all-at-once. Operator watching the sheet live sees incremental progress — actually a UX improvement.
- More nodes on canvas (27 → 27, technically +2 since we removed nothing). Slightly busier visual but correct.

Verification: re-run the failing 82-segment lesson on the patched W3 workflow. Expect (a) Phase 2 no longer times out, (b) each `Loop Phase 2` iteration <200s wall-clock, (c) total W3 wall-clock approximately matches pre-fix expectation, (d) localizations sheet's final state identical (Phase 2 output by row_key is the same content per cell, just persisted in N writes instead of one), (e) full audio + VTT output match the per-segment Drive files.

Rollback: revert this workflow JSON commit. The `phase2_batch_llm_tts.js` code is unchanged. Re-import original W3 JSON restores pre-loop topology.

---

### 2026-05-28 — W2_ADAPT_SPLIT_IN_BATCHES

Context: W2 Adapt Translations hit n8n's hardcoded 300s task-runner timeout twice on a real 82-segment lesson, and again on a 47-segment lesson after `w2_adapt_concurrency` was bumped from 8 to 20. The 2026-05-27 W2_PARALLELIZATION work (global task-pool with bounded `Promise.all`) was supposed to keep wall-clock under 300s by scaling with `over_budget_cells / concurrency`, but two compounding factors broke that assumption:

1. **Prompt growth**: `adapt_shorten_system` grew with the 2026-05-28 GENDER NEUTRALITY block (~+15% chars). Per-call Claude latency ticked up.
2. **Wave-synchronization inefficiency in current code**: `for (i; i < tasks.length; i += CONC) { await Promise.all(slice.map(...)) }` waits for the SLOWEST task in each wave before starting the next. One pathological cell with 3 attempts + Anthropic 429 backoff (2s+4s+8s) can stretch a wave to 25-30s, multiplied across 8-10 waves → over 300s.

The 300s ceiling is hardcoded by n8n's task runner — no concurrency knob inside a single Code node can guarantee staying under it as inputs grow. The architectural answer is to split work across multiple Code-node executions via n8n's native `SplitInBatches` loop pattern, mirroring W3 Phase 1's `Loop Over Items` setup.

Decision: Wrap `Adapt Translations` in a `SplitInBatches` loop (`Loop Adapt`, batchSize=15) with intermediate sheet persistence so processed text accumulates across iterations. Three new W2 nodes:

1. **`Loop Adapt`** (`n8n-nodes-base.splitInBatches` v3, batchSize=15) — placed between `Gemini Editor` and `Adapt Translations`. Splits the editor's output into batches of 15 segments. Each iteration runs the loop body; when input is exhausted, fires `done` output.

2. **`Save Adapt Batch`** (Google Sheets `appendOrUpdate` on segments tab by `segment_id`) — cloned config from existing `Update Sheet`. Persists each iteration's Adapt output to the segments tab so the post-Adapt `{lang}_text` survives across Code-node executions. Idempotent.

3. **`Read Segments Fresh`** (Google Sheets read on segments tab) — cloned config from `Read Pending Segments`. Re-reads the segments tab after the loop completes, giving Formality Lint the post-Adapt text (not the original pre-Adapt input that `SplitInBatches.done` would emit by default).

Wiring:
- `Gemini Editor` → `Loop Adapt`
- `Loop Adapt[output 1, body]` → `Adapt Translations` → `Save Adapt Batch` → `Loop Adapt` (loop-back to main input)
- `Loop Adapt[output 0, done]` → `Read Segments Fresh` → `Formality Lint` → `Update Sheet` (terminal, existing)

Existing `Formality Lint` → `Update Sheet` connection preserved.

Math: 15 segments × 7 langs = 105 cells max per batch. Even worst case (100% over-budget × 3 attempts × 4s = 1260 call-seconds), with `w2_adapt_concurrency=20` and the current `for + Promise.all` pattern: 1260 / 20 ≈ 63s per batch. 4x headroom under 300s. For a 90-segment lesson: 6 batches × 60s = ~6 min total wall-clock — same scaling as pre-fix but with no ceiling risk.

Code change to `adapt_translations.js`: **none**. The existing implementation reads `$input.all()` and emits `outputs.map(json => ({ json }))` — works on whatever slice it receives.

Rationale: `SplitInBatches` is the n8n-idiomatic pattern for scaling Code-node work past 300s, already used in W3 Phase 1's TTS loop. The sheet round-trip mirrors W3's `Update Localizations` → `Read Localizations Fresh` pattern (DECISIONS 2026-05-25 PHASE2_BATCHED_EXPANSION inception). Compared to alternatives:
- **Worker-pool refactor in code**: improves wave-sync efficiency but still subject to 300s ceiling on pathological inputs.
- **Higher concurrency**: helps up to a point, doesn't solve the architectural ceiling.
- **External service**: over-engineered.

Trade-offs:
- +2 sheet writes per lesson (intermediate Save Adapt Batch fires N/15 times). Each is `appendOrUpdate` batched into few API calls. Acceptable cost.
- Slight wall-clock overhead for the loop-back signal in n8n (~100-200ms per iteration). Negligible.
- `Save Adapt Batch` writes adaptation_attempts and {lang}_text incrementally — visible in segments tab mid-run if operator watches. Cosmetic, idempotent.
- `Read Segments Fresh` filter inherits from `Read Pending Segments` clone — reads the same scope. If pending-filter excludes already-adapted rows, Formality Lint would see partial set. **Verify**: confirm Read Pending Segments returns the same set as Read Segments Fresh on a re-read, otherwise adjust filter to fetch the lesson's full segment set.

Verification: re-run the failing lesson (82 segments) with the patched workflow. Expect (a) Adapt no longer times out, each batch <70s wall-clock, (b) total W2 wall-clock similar to expected (~5-8 min for 82-segment lesson), (c) `localizations`-tab output unchanged in content (Adapt's per-cell processing is identical, just chunked execution), (d) Formality Lint receives post-Adapt text correctly.

Rollback: revert this workflow JSON commit. The `adapt_translations.js` was not modified, so no code revert needed. The intermediate `Save Adapt Batch` writes are idempotent and don't pollute the sheet if reverted.

---

### 2026-05-28 — MODEL_UPGRADE_SONNET_4_6_AND_OPUS_ON_PHASE2

Context: After the multi-day refactor stabilized — diff-first restoration, no-invention rule, batch-level diversity, gender-neutral defaults, speed-up branch — pipeline reasoning load is now concentrated on the Phase 2 Expand prompts. Those prompts carry the most complex multi-step instructions in the codebase: EN-vs-current diff analysis, conditional restoration vs decoration, intra-batch ToV diversity tracking, per-language gender enforcement. Sonnet 4.5 was the original model when most of those features were added one at a time; instruction-following on the now-stacked rule set is at Sonnet 4.5's ceiling. User confirmed appetite for selective upgrade after cost discussion (~+$3/lesson tradeoff for Phase 2-only Opus).

Decision: Two-tier model upgrade:

1. **Pipeline-wide: Sonnet 4.5 → Sonnet 4.6.** Free quality bump — same pricing, newer model. Touches every Anthropic call in W2 (Translate, Tone Analysis, Verify, Adapt, Formality Lint) and the non-Expand calls in W3 Phase 2 (Verify, Formality Fix). No behavior change expected beyond marginal instruction-following improvement.

2. **W3 Phase 2 Expand-only: Sonnet 4.5/4.6 → Opus 4.7.** Targeted upgrade for the two model calls that drive Phase 2 reasoning: the primary expand (`runOneExpandBatch` using `w3_expand_batch_system`) and the retry expand (`runOneRetryExpand` inside `runRetryGroup`, used by both `_retry_harder` and `_retry_shorter`). The downstream Verify and Formality Fix calls within Phase 2 stay on Sonnet 4.6 — they don't carry the stacked-instruction load and Sonnet is sufficient.

Phase 1 shorten retries in `check_timing_and_pad.js` already use Haiku 4.5 (`claude-haiku-4-5-20251001`) — mechanical shortening task, deliberately cheap and fast. Not changed.

Cost modeling (rough per-lesson estimates assuming standard Anthropic pricing — Sonnet $3 input / $15 output / $0.30 cached input per MT; Opus $15 / $75 / $1.50; 5× markup):
- All-Sonnet baseline (with caching across batches): ~$3.00 / lesson
- Phase-2-Expand on Opus only: ~$6.00 / lesson (+$3 delta)
- All-Opus alternative (rejected): ~$15 / lesson — Adapt is the biggest cost driver (~150 cells × shorten attempts), and Adapt is mechanical enough that Sonnet 4.6 suffices. Paying 5× on Adapt for no quality benefit is wasteful.

Files changed:
- `code_nodes/phase2_batch_llm_tts.js`: 4 model strings — line 315 (Expand primary) → Opus 4.7, line 336 (Verify) → Sonnet 4.6, line 527 (Formality Fix) → Sonnet 4.6, line 711 (Retry Expand) → Opus 4.7.
- `code_nodes/adapt_translations.js`, `formality_lint.js`, `prepare_tone_analysis.js`, `prepare_and_expand.js`: each had a single Sonnet 4.5 reference → Sonnet 4.6.
- `workflows/W2_Translate_v2.json`: 5 occurrences of `claude-sonnet-4-5` in embedded jsCode → Sonnet 4.6 (all of them).
- `workflows/W3_Synthesize_v2.json`: 4 occurrences in embedded phase2 jsCode — positionally edited to match the .js file (2 Opus, 2 Sonnet 4.6).
- `code_nodes/check_timing_and_pad.js`: unchanged (Haiku 4.5, intentional).

Caching: every cache_control: ephemeral block in the pipeline keeps working on Opus 4.7. Cached input pricing is 10% of base on both Sonnet and Opus, so cache amortizes large system prompts (~5K tokens) across batches in either model. First batch of each Phase 2 stage pays full input cost; subsequent batches in the same Code node execution hit cache (cache TTL is 5 min — fits within a typical lesson's W3 wall-clock).

Latency: Opus is roughly 3× slower per call than Sonnet. Phase 2 sits on W3's critical path. Expected wall-clock increase: ~30-60s on a 47-segment lesson, ~60-120s on a 90-segment lesson. Acceptable given quality benefit; if latency becomes an issue on long lessons, downgrade Phase 2 Expand back to Sonnet 4.6 — single-line change.

Rate limits: Opus tier limits are stricter than Sonnet. The Phase 2 CHUNK=6 parallel batches should fit within Tier 2 limits; if 429s appear, reduce CHUNK via `w2_llm_chunk` config (also affects W2 Verify, so cross-impact). No code change needed for fallback — existing backoff in `callAnthropic` (3 retries, 2s/4s/8s) handles transient 429s.

Rationale: Concentration of complexity. The diff-first / no-invention / diversity / gender / restoration rule stack on Phase 2 Expand has grown to 4 critical sections per prompt plus a tone-of-voice reference. Sonnet 4.5 follows these adequately ~85% of the time; the misses produce the regressions we've been chasing (invention, repetition, masculine defaults). Opus 4.7 follows stacked instructions more reliably — expected to push first-pass success rate from ~85% to ~95%, reducing retry frequency and tail silence outliers. Sonnet 4.6 is a free upgrade on the rest — no reason to skip.

Trade-offs:
- +$3/lesson cost — bounded and predictable.
- +30-60s W3 wall-clock — bounded, on critical path.
- Two-model dependency in one Code node (Sonnet for Verify/Formality, Opus for Expand) — slight complexity, but unified through the existing `callAnthropic(body)` helper which takes the body verbatim, so no architectural change. The model is named per-call in each body object.
- If Opus 4.7 instruction-following on these prompts is materially better than projected, we could remove some of the explicit anti-patterns (BATCH-LEVEL DIVERSITY's "self-check before output", NO INVENTION's anti-examples) that exist primarily to discipline Sonnet's known failure modes. Out of scope here; would need an A/B run.
- If Opus output ever diverges in JSON-shape from Sonnet (different escaping, different field-name conventions) — existing `asStr()` and `parseLLMJson()` helpers normalize most variants. No issues anticipated.

Verification: re-run sleep2_end. Expect (a) lower frequency of invention regressions and "when you're ready" templating (the failure modes Sonnet 4.5 produced), (b) restoration coverage stable on seg_004 et al (Opus shouldn't drop content), (c) gender-neutral compliance higher (Opus follows tabular rules better), (d) W3 wall-clock +30-60s, (e) `phase2_diag` console output shows higher attempt-1 accept rate. If accept rate doesn't improve materially after a few lessons, the Opus upgrade isn't pulling its weight — downgrade Phase 2 Expand to Sonnet 4.6.

Rollback: 4-line change in `code_nodes/phase2_batch_llm_tts.js` (lines 315, 336, 527, 711). Set all four back to `claude-sonnet-4-6` for pure-Sonnet operation, or `claude-sonnet-4-5` for full pre-2026-05-28 baseline. Workflow JSONs need matching edits to stay in sync if rolling back.

---

### 2026-05-28 — W2_GENDER_NEUTRAL_PIPELINE_WIDE

Context: The Phase 2 gender neutrality fix (`W3_GENDER_NEUTRAL_FEMININE_FALLBACK`, earlier the same day) added a feminine-default rule to the three W3 expand prompts. That covers Phase 2 only — masculine forms could still enter the pipeline from W2's initial translation (`translate_system`) and survive through Verify / Editor / Adapt because none of those prompts had a gender rule. Since Phase 2 only fires on cells where `real_duration < en_duration × threshold` (about 30-50% of cells per lesson), the W3-only fix leaves a large fraction of segments with whatever gender form W2 generated. User confirmed scope expansion: "так, давай фіксити одразу все".

Decision: Add the same two-tier gender rule (PREFERRED neutral phrasing → FALLBACK feminine, never masculine) to all five W2 prompts that generate or modify natural text. Same per-language vocab tables and same severity (STRICT default, never acceptable to pass masculine through). Per-prompt integration shape:

1. **`translate_system`** — gender block inserted after the existing informal-address rule, before the `=== TONE OF VOICE ===` block. Single-paragraph form (this prompt is dense; a multi-section structure would dilute the JSON-only instruction recency).

2. **`qa_verify_system`** — new `CLASS 4: GENDER DEFAULT` section inserted between CLASS 3 (semantic register) and "NOT YOUR JOB", parallel to CLASS 1/2/3 structure. Declared severity: "A passed-through masculine form referring to the listener is a verification failure of the same severity as a CLASS 1 false friend" — so it's treated as a real semantic error, not a style preference.

3. **`editor_system`** — new `CLASS E: GENDER DEFAULT` section after CLASS D (typos/diacritics). Includes explicit override of Editor's usual "default unchanged" rule: "This is the one place where Editor takes precedence over 'default unchanged' — masculine-listener forms ALWAYS get corrected." Without that override, Editor's conservative default would let masculine forms slip through under the "if it sounds native, leave it alone" rule.

4. **`adapt_shorten_system`** — new `=== GENDER DEFAULT — never shorten via masculine forms ===` block inside the existing CRITICAL TRAPS section. Adapt is the most likely false-positive vector: masculine adjectives are often 1-2 chars shorter than feminine (Sp. "listo" 5 vs "lista" 5 — equal; "preparado" 9 vs "preparada" 9 — equal; but FR "prêt" 4 vs "prête" 5; PL past tense "byłeś" 5 vs "byłaś" 5 — equal; IT "stanco" 6 vs "stanca" 6 — equal), so Adapt could substitute under tight slot pressure. The rule explicitly forbids this with the same fallback-to-original logic the existing CRITICAL TRAPS use. Adds a positive case: "If a neutral rephrasing is shorter than either form, prefer the neutral form — best of both worlds."

5. **`formality_fix_system`** — gender clause inserted inline with the informal-target list. Since formality fixes already rewrite pronouns/verbs/possessives, gender correction is a natural extension of the same surgical pass. Critical wording: "If the input already had a masculine listener-form, fix it on the way through — gender is part of address correction." Also tightens the unchanged-return condition: "If a cell is ALREADY informal AND gender-correct, return it UNCHANGED" (was just "ALREADY informal").

Rationale: Pipeline-wide consistency. Every prompt that touches natural-language text now enforces the same gender default. Each prompt enforces it differently per its specialization — Translate generates correctly; Verify catches semantic errors; Editor catches what slipped past; Adapt protects under length pressure; Formality Lint catches deterministic regex-flagged cases. The W3 Phase 2 prompts (already done) catch any masculine forms that retry-expansion would otherwise reintroduce.

Trade-offs:
- Total prompt size grew ~+5-15% per prompt. All system prompts cached via `cache_control: ephemeral` so per-call overhead negligible after first batch in each stage.
- Slight risk of over-correction on rare segments where masculine is semantically required (e.g. a hypothetical translation of "your father is here" — but meditation/wellness scripts essentially never have such cases, and if they did, the speaker is addressing the listener with imperative/2nd-person forms, not 3rd-person about other people).
- DE and TR have no special handling — confirmed grammatically gender-neutral in 2nd-person address. If a future content type required gendered DE/TR forms, the rule wouldn't cover them; not relevant for current scope.
- Compounding from multiple gender-defending stages may occasionally produce minor wording variation between runs (Translate picks "cuando quieras", Verify accepts; next run Translate picks "cuando estés lista", Verify accepts — both correct, both feminine-default). Diversity is the goal, not stability — both outcomes are acceptable brand voice.

Verification: re-run a lesson through full W2 + W3. Expect (a) no masculine adjectives/participles referring to the listener anywhere in `text_translated` for ES/FR/PL/PT/IT, (b) about a 50/50 split between neutral-rephrasing and feminine-fallback (depending on what fits best in each context), (c) DE and TR unchanged, (d) no regression in any other quality dimension (false friends, formality, register). Spot-check a sample of 10-15 cells across the lesson; if any masculine listener-form survives, identify which prompt let it through.

Rollback: delete the gender block from each of the five W2 prompt rows in Sheets. Each is a self-contained inserted block — clean removal. The earlier W3 gender entries remain (independent rows). Could roll back W2 only and keep W3, or vice versa, depending on which layer surfaces issues.

---

### 2026-05-28 — W3_GENDER_NEUTRAL_FEMININE_FALLBACK

Context: A run on sleep2_end after the NO_INVENTION fix surfaced a different quality concern — gender agreement defaulting to masculine across Romance + Polish translations. `seg_004` restoration of "when you're ready" landed as:
- ES: "cuando estés listo" (masculine)
- FR: "quand tu seras prêt" (masculine)
- PL: "kiedy będziesz gotowy" (masculine)
- PT: "quando estiveres pronto" (masculine)
- IT: "quando sarai pronto" (masculine)

DE ("wenn du bereit bist") and TR ("hazır olduğunda") are grammatically gender-neutral in 2nd-person address and are fine. The 5 affected langs all defaulted to the masculine adjective despite the listener's gender being unknown. For a meditation/wellness brand whose audience is heterogeneous and skews female in many markets, masculine-default is both off-brand and exclusionary.

Decision: Add a `GENDER NEUTRALITY (CRITICAL)` section to all three Phase 2 prompts (`w3_expand_batch_system`, `w3_expand_batch_retry_harder`, `w3_expand_batch_retry_shorter`) with a two-tier rule:

1. **PREFERRED — rephrase to gender-neutral whenever possible.** Use lang-specific constructions that avoid agreement entirely:
   - ES: "cuando quieras", "cuando lo sientas", "si te apetece"
   - FR: "quand tu le souhaites", "quand cela te conviendra"
   - PL: "kiedy zechcesz", "kiedy poczujesz"
   - PT: "quando quiseres", "quando sentires"
   - IT: "quando vorrai", "quando lo sentirai"

2. **FALLBACK — when neutral phrasing is awkward, default to FEMININE.** Per-lang vocab tables embedded in each prompt:
   - ES: lista, preparada, tranquila, cansada, despierta
   - FR: prête, détendue, fatiguée (calme is already neutral)
   - PL: gotowa, spokojna, zmęczona; past-tense verbs feminine (byłaś, siedziałaś, leżałaś)
   - PT: pronta, cansada, tranquila, acordada
   - IT: pronta, stanca, tranquilla, sveglia

The rule is declared as a STRICT default — masculine forms are never acceptable for the listener.

For `retry_shorter` specifically: an additional clause says "if `previous_attempt` contained masculine forms, FIX them on the way through; do not preserve them just because rewriting feminine costs extra chars." This catches stale masculine forms from prior Phase 2 outputs that earlier runs put in the sheet.

DE and TR have no special handling (already neutral by grammar).

Rationale: The brand voice document does not currently encode this rule, so the LLM defaults to whichever gender form is morphologically simplest — masculine in Romance + Polish. The fix lives at the Phase 2 prompt layer because that's where Phase 2 introduces new gendered text (restored EN clauses like "when you're ready"). Out of scope for this change: W2's `translate_system` and `qa_verify_system` — they may produce masculine forms in the initial Phase 1 translation, which then become the `current` Phase 2 sees. If the rule needs to apply pipeline-wide (recommended for full consistency), the same `GENDER NEUTRALITY` block should be added to W2's prompts in a follow-up — strictly orthogonal to this Phase 2 fix.

Trade-offs:
- Some lang-specific neutral phrasings are slightly longer than masculine adjective forms. Net effect on char count is ≤5% per affected clause — within the existing length tolerance bands.
- LLM compliance on default-feminine is not 100%. Sonnet may still occasionally produce masculine; if observed, a deterministic post-process lint (similar to `Formality Lint` from 2026-05-27) could be added in a future iteration. Not done now — see how prompt-only fix performs first.
- Neutral phrasings can change the connotation slightly ("when you're ready" → "when you want to") — the feminine-fallback path preserves connotation faithfully but enforces the gender default.

Verification: re-run sleep2_end. Expect (a) seg_004 ES/FR/PL/PT/IT to use either neutral phrasing or feminine adjective ("cuando quieras" or "cuando estés lista", "kiedy zechcesz" or "kiedy będziesz gotowa", etc.), (b) no masculine adjectives in any segment referring to the listener, (c) DE and TR unchanged. Spot-check a sample of 5-10 cells across the lesson for any leaked masculine forms.

Rollback: delete the `GENDER NEUTRALITY` section from each of the three prompt rows in the Sheets `prompts` tab.

---

### 2026-05-28 — W3_EXPAND_BATCH_LEVEL_DIVERSITY

Context: After NO_INVENTION shipped and seg_001_pl/seg_002_es invention regressions were fixed, the next sleep2_end run revealed a different repetition pattern: 5 of 7 langs in seg_001 added the SAME ToV phrase — "when you're ready" / "cuando estés listo" / "quand tu es prêt" / "kiedy będziesz gotowy" / "quando estiveres pronto" / "hazır olduğunda". This wasn't invention (PRIORITY 1's first listed example is exactly "when you're ready"), but it's a templating problem at lesson scale: a meditation track where most segments start with "when you're ready..." sounds robotic, not brand-voiced. User identified this correctly as LLM primacy bias — the model reaches for the first example in any list when prompted for diversity.

Diagnosis: The retry_harder / primary prompts listed PRIORITY 1 as `"when you're ready", "if it feels comfortable", "if it feels right", "allowing yourself to", "without forcing"` — 5 examples, first one is the most recognizable Spirio signature phrase. The LLM, processing each segment independently within a batch, defaults to the most prototypical example for each. Without an explicit cross-segment diversity rule, the model has no signal that across-segment variety is part of brand voice quality.

Decision: Three coordinated changes to `w3_expand_batch_system` and `w3_expand_batch_retry_harder`:

1. **Expand PRIORITY 1 pool from 5 → ~16 candidate phrases.** Adds variants like "when it feels right", "if it feels good", "in your own time", "at your own pace", "as you settle in", "as you arrive", "without rushing", "letting yourself", "with kind attention", "softly, in your own way". Includes explicit "Do NOT default to 'when you're ready' — it is one option among many." Notes that the full inspiration pool is the `{{tov}}` content at the top of the prompt, not the 8-line pool list.

2. **New `BATCH-LEVEL DIVERSITY (CRITICAL)` section** inserted between PRIORITY 5 and LANGUAGE ISOLATION. Four explicit rules:
   - No phrase repeats within a batch (scan earlier segments in current response before finalizing later ones).
   - Vary PRIORITY type across segments (if seg_X gets PRIORITY 1, prefer 2/3/4/5 for seg_Y).
   - Skip ToV when `current`/`previous_attempt` already has it.
   - Self-check: treat the whole JSON response as the unit of variety, not each individual segment.
   The section explicitly frames diversity as "part of brand voice quality" — not just a stylistic preference.

3. **PRIORITY 5 (ellipsis) flagged as safest fill.** The diversity section notes that PRIORITY 5 is the LEAST content-adding lever and often the safest choice — explicitly nudging the model toward timing-only fills when no clear content variation is needed.

`retry_shorter` NOT updated for diversity — it's a condense path, fires per-cell on overshoot, doesn't add new ToV.

Rationale: Pool expansion alone halves first-example probability (from ~60% with 5 entries to ~30% with 16) but still leaves ~30% of batch segments using "when you're ready". The anti-repetition rule converts that probabilistic distribution into a hard intra-batch constraint. Per-priority diversification further reduces clustering. The combination should drop "when you're ready" frequency from ~5/7 langs per segment to ~1-2 per batch (≤8 segments) — a 10-15× reduction at lesson scale.

Trade-offs:
- LLM instruction-following on intra-batch diversity is imperfect (Sonnet 4.5 is better than older models but not 100%). Expected to substantially reduce repetition, not eliminate. Cross-batch repetition can still occur because batches don't see each other; mitigated by the natural variation of per-batch random sampling.
- The prompts grew ~+25% chars. Cached via `cache_control: ephemeral` so per-batch overhead negligible after batch 1.
- If repetition persists despite the prompt fix, the next lever is code-level enforcement: post-LLM check counts repeated phrases across the batch and triggers re-roll with explicit blacklist. Not done now — see prompt-only effect first.

Verification: re-run sleep2_end. Expect (a) "when you're ready" / lang-equivalent appearing on AT MOST 1-2 segments per batch (vs 5-7 in the previous run), (b) varied ToV patterns across seg_001 / seg_002 / etc., (c) some segments getting just PRIORITY 5 ellipsis fill with no PRIORITY 1 modifier, (d) no regression on seg_004 restoration (the diff-first logic is unchanged). Anecdote-check by reading the seg_001 langs aloud — they should sound varied, not templated.

Rollback: revert the three changes to each prompt row in the Sheets `prompts` tab. Diversity rules are additive; removing them returns to the prior repetition-prone behavior.

---

### 2026-05-28 — W3_RETRY_HARDER_NO_INVENTION

Context: After the speed-up branch shipped (same day), a clean re-run on sleep2_end (fresh W2 + new Phase 2 code) showed seg_004 fully restored on all 7 langs and most segments fitting their slots. But two cells revealed a new quality issue:
- `seg_001_pl` (attempts=2, speed=1.10): "...To wystarczy większości, by poczuć zmianę... **małą przestrzeń spokoju**." ("...a small space of calm") — invented metaphor not present in EN.
- `seg_002_es` (attempts=2, speed=1.15): "...si tu mente sigue activa... **dejando que se vaya calmando a su propio ritmo**." ("...letting it calm at its own pace") — invented elaboration not present in EN.

Both cells went through `_retry_harder` and landed in the speed-up step at 1.10/1.15. With both restoration AND speed-up working, retry_harder had license to add chars, and its PRIORITY 6 explicitly permitted "Light meaningful elaborations of source content" with example: "If EN says 'Sleep is powerful', expand WHY: 'Sleep is one of nature's most powerful tools... a quiet way your body finds restoration.'" The model interpreted this license as freedom to add poetic flourishes — exactly the failure mode the diff-first rewrite was meant to prevent on the restoration side, now sneaking back via the elaboration path. Verify and Editor (downstream of expansion) did not flag either, because the added content was grammatically clean and tonally on-brand — only a strict EN-vs-output comparison catches it.

Diagnosis: PRIORITY 6 was the only retry_harder lever that allowed adding concept-bearing content beyond what EN already says. PRIORITIES 1-5 are pure ToV patterns (modifiers, sensory anchoring, permission language, bridging awareness, ellipsis pauses) — they decorate without inventing. PRIORITY 6 invited invention by design, with a self-referential example showing the LLM exactly the failure shape to reproduce.

Decision: Remove PRIORITY 6 from `w3_expand_batch_retry_harder`. Restored EN clauses (Step 2) + ToV patterns 1-5 (Step 3) are now the only expansion levers. If they cannot reach `target_chars × 0.95`, the output ships under-target; the pipeline's slowdown-to-fill handles the remaining silence via voice-speed adjustment, which is reversible audio engineering — invented content is not.

Implementation:
1. Deleted the PRIORITY 6 block from the prompt body. Replaced with an explicit "NOTE — there is no PRIORITY 6" paragraph naming the observed failures ("a small space of calm", "letting it calm at its own pace", "a quiet way your body finds restoration") so future maintainers see why the lever was removed.
2. Sharpened the existing "DO NOT" rule from "Add new instructions or claims not in EN" → "Add new instructions, claims, **metaphors, images, or concepts** not present in EN — even as brief poetic elaboration." Names the specific seg_001_pl / seg_002_es phrases as anti-examples.
3. Relaxed the LENGTH HARD CONSTRAINT: `target_chars × 0.95 ≤ output_chars ≤ target_chars × 1.10` now reads "aim for [band], under-target is acceptable if restoration + ToV 1-5 cannot reach the band without invention". Pairs with new HARD CONSTRAINT `NO INVENTION` declaring under-target the correct answer when invention would be the alternative.
4. Primary `w3_expand_batch_system` and `_retry_shorter` unchanged. The primary never had PRIORITY 6 (only 5 ToV patterns); retry_shorter is a condense pass, no invention pressure.

Rationale: This closes the last LLM-side lever for content invention in Phase 2. The two-attempt pipeline (primary + harder/shorter retry) is now end-to-end restoration-only: every char added beyond `current` must trace to either an EN clause (restoration) or a recognized ToV pattern (decoration). The remaining tail-silence risk migrates fully to slowdown-to-fill at the audio layer, which is the right place for it — the audio lever cannot fabricate content, only stretch what's been said.

Trade-offs:
- Cells where restoration + ToV 1-5 can't fill the slot will land under-target with visible tail silence after slowdown. This will surface real CPS calibration gaps (e.g. seg_001_es / seg_001_pt showing 1.9s tails at slowdown floor) as observable signal in the CSV, not as silently invented content. Right place for that signal.
- Some accepted cells may switch from `accepted with invention` to `accepted with tail`. Tail is honest; invention is a quiet quality liability.
- If a lesson consistently shows large tails at slowdown floor on the same lang (ES/PT especially), that's a CPS calibration trigger — run `scripts/analyze_cps.js` and consider lowering `cps_estimate_<lang>`. Not done here; the prompt fix is orthogonal.

Verification: re-run sleep2_end. Expect (a) seg_001_pl no longer contains "małą przestrzeń spokoju" or equivalent invented imagery, (b) seg_002_es no longer contains "dejando que se vaya calmando a su propio ritmo" or equivalent, (c) any cell that previously inherited invented content now lands accepted with tail or accepted at slowdown floor — both acceptable, (d) no new regression on seg_004 langs (those passed via primary prompt, not retry_harder).

Rollback: revert this commit / restore the deleted PRIORITY 6 block in the Sheet's `w3_expand_batch_retry_harder` row. Only the retry path is affected; everything else continues to work.

---

### 2026-05-28 — W3_PHASE2_SPEED_UP_ON_OVERSHOOT

Context: After the diff-first prompts (`w3_expand_batch_system`, `w3_expand_batch_retry_harder`) and the clause-protected `w3_expand_batch_retry_shorter` shipped, a re-run on sleep2_end showed seg_004_de stuck in `phase2_outcome=overshoot` with both attempts rejected. Manual math confirmed the cause is structural, not LLM creativity: en_dur=3.643s, lead=0.24s, speechBudget=3.403s. The correct restored DE text "Morgen bin ich wieder hier... wenn du bereit bist." (50 chars) at voice.speed=1.0 produces ~3.5s of audio — about 100ms over speechBudget. `reTtsOne` in [`phase2_batch_llm_tts.js`](../code_nodes/phase2_batch_llm_tts.js) returned `overshoot` immediately on `real > speechBudget` with no speed-up retry, so Phase 1 audio (with the original short clause-dropping translation) was kept. Net effect: a clause-complete translation generated by the new prompts could not reach the listener because the TTS at default speed was 3% too long. Same pattern would hit any content-dense short slot in any language.

Mirror: Phase 1 (Check Timing + Pad) has had a relative speed-up schedule since 2026-05-27 (DYNAMIC_SPEED_AND_SLOWDOWN_FILL): when initial TTS overshoots, retry at `[voice.speed + Δ·⅔, voice.speed + Δ]` with cap `voice.speed + MAX_SPEED_UP_DELTA` (default Δ=0.15). Phase 2's `reTtsOne` lacked this branch — it had a slowdown-to-fill lever for the silence-remaining direction but no speed-up lever for the overshoot direction.

Decision: Mirror Phase 1's speed-up retry in `reTtsOne`. On `real > speechBudget` after initial TTS at voice.speed, try the same two-step schedule `[voice.speed + Δ·⅔, voice.speed + Δ]` using the existing `max_speed_up_delta` config key. If any step lands `real ≤ speechBudget`, accept that speed; otherwise return `overshoot` as before.

Implementation:
1. Added `MAX_SPEED_UP_DELTA = parseFloat(configMap.max_speed_up_delta) || 0.15` to module scope alongside the existing `MAX_SLOW_DOWN_DELTA`.
2. Replaced the immediate `overshoot` return with a speed-up retry loop. Each step calls `ttsAt(speedTry)`, checks `real ≤ speechBudget`, accepts and updates `pcm`/`real`/`usedSpeed` on first success, else continues. Final overshoot return preserved when both steps fail.
3. `final_speed` in the accepted result captures the speed actually used (1.10 or 1.15 for a 1.0 voice, scaled relative to voice.speed otherwise) → visible in localizations CSV.
4. Branch placed BEFORE the slowdown-to-fill block. The two are mutually exclusive: overshoot → speed-up, silence-remaining → slowdown. A successful speed-up step lands `real ≤ speechBudget` (often `≈ speechBudget`), so the slowdown gap check (`speechBudget − real > 0.5s`) won't trigger.
5. `max_speed_up_delta` config key documentation updated in `docs/config_keys.md` to list both Phase 1 and Phase 2 readers.

Rationale: Phase 1 already accepts that some texts need 1.10-1.15 speed to fit the EN-aligned slot — meditation pace at 1.10 is well within natural range and was validated previously. Phase 2 was rejecting the exact same situation despite having access to the same lever; this was an inconsistency between the two paths that surfaced only after the diff-first prompts started producing clause-complete texts that consistently sat right at the slot boundary. Mirroring the existing accepted behavior is lower risk than tightening prompts further or relaxing the overshoot check (which would let actually-too-long texts ship).

Trade-offs:
- +1–2 ElevenLabs TTS calls per Phase-2 overshoot cell. The retry runs only when the initial TTS overshoots — frequency depends on prompt quality and segment density. On the sleep2_end run that motivated this change, ≤5 cells/lesson would touch the new branch. Bounded by `ELEVENLABS_CHUNK=5` parallelism — no rate-limit risk.
- Cells that previously fell back to Phase 1 audio (with the original short translation) will now sometimes ship Phase 2 audio at 1.10-1.15 speed instead. This is the intended outcome: clause-complete content at slightly elevated pace, rather than clause-missing content at base pace.
- Mixed pacing within a lesson can creep further: a few cells at 1.10 (speed-up to fit overshoot) alongside cells at 0.85 (slowdown to fill silence). Both gates are intentional and bounded; if pacing feels uneven, lower `max_speed_up_delta` and/or raise `slowdown_min_gap_sec`.

Verification: re-run sleep2_end with this change AND a fresh W2 run first (to clear sheet contamination from prior diff-first iterations — the localizations sheet had `info.current` = previous Phase 2 outputs, polluting Phase 1 inputs). Expect:
- seg_004_de `text_translated` to contain both EN clauses ("Morgen bin ich wieder hier... wenn du bereit bist." or equivalent), `phase2_outcome=accepted`, `final_speed≈1.10–1.15`, `tail_silence_sec` small.
- Any other content-dense short slot (seg_001 langs where Phase 1 hit `final_speed=1.10` already) to either pass through unchanged OR get Phase 2 expansion that lands at the speed-up step.
- No regression on segments that previously fit at voice.speed — the new branch only fires when `real > speechBudget`.

Rollback: revert this commit. `max_speed_up_delta` config key remains in use for Phase 1; only Phase 2's secondary reader is removed.

---

### 2026-05-28 — W3_RETRY_SHORTER_PROTECT_RESTORATION

Context: After the diff-first rewrite of `w3_expand_batch_system` and `w3_expand_batch_retry_harder` (earlier the same day), a re-run on sleep2_end with `expansion_threshold` raised 0.85 → 0.95 produced two clear regressions on seg_004:
- `seg_004_de`: final text "Ich bin morgen wieder genau hier." — second clause "wenn du bereit bist" dropped. `expansion_attempts=2`, `accepted`, `final_speed=0.9`.
- `seg_004_it`: final text "Domani sarò di nuovo qui." — second clause "quando sarai pronto" dropped. `expansion_attempts=2`, `accepted`, `needs_attention=TRUE`, ratio 0.497.

Diagnosis: attempt 1 (`w3_expand_batch_system`, now diff-first) correctly restored both EN clauses on these langs ("Morgen bin ich wieder hier... wenn du bereit bist." — 50 chars, real ≈3.5s). speechBudget = en_dur − lead = 3.643 − 0.24 = 3.403s, so even small TTS jitter over 3.5s landed the cell in **overshoot** territory. The retry classifier routed overshoot cells to `w3_expand_batch_retry_shorter`, which was NOT updated as part of the earlier diff-first rewrite. The old retry-shorter prompt treated `previous_attempt` as freely condensable text, with HARD CONSTRAINT `NEVER exceed target_chars`. Faced with previous_attempt that contained restored EN content but no spare ToV decoration to remove, the LLM hit the chars ceiling by dropping a restored clause — exactly the failure mode the primary prompt was rewritten to prevent. Net effect: a still-short-but-incomplete-content audio was emitted as `accepted`, silently losing source meaning.

Root cause class: the diff-first principle was applied only on the EXPAND side (attempts 1 and harder retry) but not on the CONDENSE side. Any cell whose restored attempt-1 slightly overshot got cleaned up by an unaligned retry that didn't know about clause protection.

Decision: Rewrite `w3_expand_batch_retry_shorter` around the same EN-clause-protection principle, mirroring the diff-first structure of the expand-side prompts:

1. **Step 1 — mandatory EN-vs-previous_attempt diff.** Enumerate EN clauses, identify which are present in `previous_attempt`. That set becomes the **PROTECTED SET** — output MUST include every protected clause (verbatim or minor stylistic variation).

2. **Step 2 — trim only ToV decoration.** Anything in `previous_attempt` BEYOND the protected clauses is fair game for cutting: stacked modifiers, multiple ellipsis, elaborations, bridging phrases. Restored EN content is off-limits.

3. **Worked example** of the exact seg_004_de regression embedded in the prompt: RIGHT keeps both clauses with minimal punctuation compression ("Morgen bin ich wieder hier, wenn du bereit bist."); WRONG drops clause 2 to hit target_chars ("Ich bin morgen wieder genau hier.").

4. **HARD CONSTRAINTS swap precedence**: RESTORATION wins over LENGTH. The old `NEVER exceed target_chars` strict ceiling is relaxed — overshoot up to target × 1.10 is acceptable when needed to keep all protected clauses. Rationale: an overshoot at the prompt level becomes overshoot at re-TTS, the pipeline already rejects overshoot TTS and keeps Phase 1 audio — a recoverable outcome. A silently-dropped clause is invisible content loss.

Rationale: The condense path was the last unaligned link in the diff-first chain. With this fix, every Phase 2 LLM stage (primary expand, retry-harder, retry-shorter) shares the same clause-preservation discipline. The trade-off (slightly more overshoot → more rejected attempts → more Phase 1 audio retained) is intentional and correct: it surfaces structurally-unfixable content overshoot as observable tail silence in the CSV rather than hiding it behind clean-looking truncated translations.

Trade-offs:
- More cells will land in `phase2_outcome=overshoot` when both attempts overshoot. Those reuse Phase 1 audio (current Phase-1 text, with the original short translation that triggered Phase 2 in the first place). User sees the gap honestly in CSV → can decide whether to investigate (slowdown range, CPS calibration, segmentation).
- Slight chars-overshoot at the LLM stage may produce TTS audio that is exactly at the slot boundary; reTtsOne's overshoot check is strict (`real > speechBudget`), so borderline cases still get accepted. Net effect: cells where restoration was possible AND TTS happened to fit will succeed; cells where restoration genuinely cannot fit get rejected cleanly and Phase 1 audio is preserved.
- A separate code-level improvement (not done here) would be to try slowdown-to-fit when re-TTS overshoots, before rejecting. That would convert more overshoot rejections into accepted-but-slow audio. Out of scope for this change; deferred until next investigation if overshoot rate climbs.

Verification: re-run sleep2_end. Expect (a) `seg_004_de` and `seg_004_it` text_translated to contain both EN clauses, (b) some cells may flip from `accepted` to `overshoot` if both attempts overshoot — that's the correct fallback, not a regression, (c) no cell with `accepted` outcome should have a missing EN clause vs the EN source. Check a sample of accepted cells: every EN clause must appear in the translation.

Rollback: revert `prompts/proposed_changes/w3_expand_batch_retry_shorter.md` and re-paste the old prompt row in Sheets `prompts` tab. Pipeline code is unchanged.

---

### 2026-05-28 — W3_EXPAND_DIFF_FIRST_RESTORATION

Context: On the most recent lessons, even segments that passed Phase 2 with `phase2_outcome=accepted` still produced noticeable tail silence — i.e. the expansion ran, was accepted, but the resulting text was still well short of the slot. Concrete pattern observed on seg_004 ES: EN had two clauses ("I'll be here again tomorrow... when you're ready."), `current` had only the first ("Mañana volveré a estar aquí."), and Phase 2 attempt 1 either returned `current` unchanged or added ToV decoration ("suavemente, …") without restoring the missing second clause. The downstream `final_speed` slowdown-to-fill can only shave ~0.5–1s of silence; it can't compensate for a missing EN clause worth ~1.5s of speech. So acceptance with low ratio was masking a content-completeness failure.

Root cause in the prompt: `w3_expand_batch_system` framed clause restoration as an OPTIONAL Step 1 — "If ORIGINAL EN contains content that's MISSING from current → restoration case. Restore the cut content first." Sonnet, faced with a clean-looking `current` and a long ToV priority list, frequently took the "authentic expansion" branch (decorate `current` with ToV) instead of doing the EN-vs-current diff. ToV patterns deliver fewer chars than restored EN clauses, hence accepted-but-short outcomes.

Decision: Rewrite `w3_expand_batch_system` and `w3_expand_batch_retry_harder` around a **diff-first** structure:

1. **Step 1 — Mandatory EN-vs-current DIFF.** Explicitly require the model to enumerate EN clauses (separators: commas/semicolons/ellipses + standalone modifiers like "when you're ready"), then mark which are present in `current` vs missing. The prompt calls out that a clean-sounding `current` does NOT mean it's complete — short translations almost always drop a clause.

2. **Step 2 — RESTORATION as PRIMARY lever.** For every missing clause, generate its target-language equivalent and integrate it. Restored EN content is ALWAYS preferred over decorative ToV of equivalent length. A worked seg_004-style example is embedded in the prompt with an explicit "WRONG" counter-example (decoration without restoration).

3. **Step 3 — ToV expansion CONDITIONAL on length after restoration.** ToV priorities 1–5 are kept (inviting modifiers, sensory anchoring, permission language, bridging awareness, ellipsis) but framed as secondary: stop the moment output is within ±10% of `target_chars`. Length-trimming, when needed, removes ToV decoration first — never restored EN content.

4. **Retry-harder** carries the same diff structure plus an explicit diagnosis paragraph: "the most likely cause of attempt-1 failure is that the diff was skipped or shallow." The diff for retry compares EN against BOTH `current` AND `previous_attempt`, so clauses missing from both are the restoration set. Hard constraint: returning `previous_attempt` unchanged or adding ToV decoration without restoring any missing EN clause is declared a FAILURE of the retry.

5. **Retry-shorter unchanged.** Its job is condensation of overshoot, not restoration.

6. **`expansion_threshold` left at 0.85.** Raising it (proposed 0.85 → 0.90) was rejected: if current-prompt accepted-cells still have ratio <0.9, more cells under the threshold just means more under-expanded acceptances, not better fill. The fix is prompt quality, not coverage. If after this change accepted-cells consistently reach ratio ≥0.95, the threshold can stay; if they still cluster under 0.85 the next investigation is per-voice CPS estimate vs reality, not threshold.

Rationale: The failure mode is content-completeness, not LLM creativity headroom. Moving restoration from optional Step 1 to mandatory Step 1+2 with a worked example targets the exact decision point where Sonnet was branching wrong. ToV stays available but is gated behind length, so decoration can never crowd out restored EN.

Trade-offs:
- Prompts are longer (~+30% chars). Cached via `cache_control: ephemeral` so per-batch overhead negligible after batch 1.
- If a `current` translation is genuinely already content-complete and just naturally short (TR especially), the diff step finds nothing to restore and falls through to ToV — same outcome as before for that case.
- `retry_harder` is now stricter: it explicitly forbids returning `previous_attempt` unchanged. If a retry genuinely cannot restore (rare), it falls through to ToV-only toward target × 1.10, same as previous behavior.

Verification: re-run a lesson where prior runs had accepted-but-short cells. Expect (a) `text_translated` for those cells now contains restored EN clauses, not just ToV padding, (b) `real_duration_sec / en_duration_sec` ≥ 0.90 on most accepted cells (was clustering 0.70–0.85), (c) `tail_silence_sec` materially smaller on accepted Phase 2 rows, (d) `needs_attention=true` (ratio < 0.70) count drops. If accepted ratios still cluster <0.85, the next lever is per-voice CPS calibration, not the prompt.

Rollback: revert `prompts/proposed_changes/w3_expand_batch_system.md` and `w3_expand_batch_retry_harder.md`, re-paste the old prompt rows in the Sheets `prompts` tab. The pipeline code is unchanged.

---

### 2026-05-27 — FULL_AUDIO_BORROW_COMPENSATION_SOURCE_FIX

Context: On sleep1_full the concatenated full-lesson WAVs drifted and the 7 languages came out at different total lengths, with the divergence starting at seg_036. Diagnosis from localizations CSV: `borrowed_sec > 0` only at seg_035/036/037 (the 4-7-8 breathing words — short audio that breath-borrows into the following pause). seg_035 is the first borrow of the whole lesson, so everything after it shifts late. Expected full length (EN-aligned) = `slot_end_047 − slot_start_001` = 412.905s for ALL langs; observed lengths were 412.905 + per-lang total borrow (de/tr ~1.10s … es ~0.36s), i.e. **borrow compensation in Build Full Audio was not firing**.

Root cause: `build_full_audio_per_lang.js` read `borrowed_sec` / `lead_silence_sec` from the per-item json (`e.json`). Build Full's input chain is `Phase 2: Update Localizations (Sheets) → Download Segment WAV (Drive) → Build Full`; those nodes coerce/drop the fields, so `parseFloat(undefined)||0 = 0` → `prevBorrow` always 0 → no lead trim. The values were still correct in the sheet (Phase 1 wrote them) but absent at runtime in the build.

Decision: read the authoritative values from the **localizations sheet** via `$('Read Localizations Fresh').all()`, keyed `${segment_id}_${lang}`, and use those for the trim (with `e.json` as a fallback). Values are in seconds → format-independent, and avoids inferring duration from PCM byte length (rejected: would hardcode 22050/mono/16-bit assumptions for a quantity we can read directly). The only remaining time→bytes conversion is the existing `trimBytes = round(trimSec·SR)·BPS`, unavoidable for slicing PCM.

Verification: re-run a lesson with a breath-borrow section; all 7 `*_full_*.wav` should be ~equal (≈412.9s, not 413.3–414.0), `trimmed_lead_total_sec` ≈ per-lang total borrow, and dubbed audio stays in sync past seg_035. Applies to all pipeline versions (independent of the W3 TTS parallelization).

Rollback: revert this commit (restores reading borrow/lead from `e.json`).

---

### 2026-05-27 — W3_TTS_PARALLELIZATION

Context: W3 Phase 1 synthesized every (segment × lang) cell strictly one at a time. The `Loop Over Items` SplitInBatches ran at `batchSize=1`, so the body `ElevenLabs TTS (HTTP) → Check Timing + Pad → Save to Drive → Update Localizations → Rate Limit Guard` serialized over all 329 cells (47 segs × 7 langs for sleep1_full), and `Rate Limit Guard` waited 1.5s PER cell → ~8 min of pure waiting. An 11-min lesson (~630 cells) made this untenable. User is on ElevenLabs Scale tier and wanted 7 parallel TTS.

Decision (architecture + rate-guard confirmed with user):

1. **Initial TTS moved into the `Check Timing + Pad` Code node.** The separate `ElevenLabs TTS` HTTP node was removed; the node's existing `tts()` helper (already used for shorten/speed retries, with its own 4-try exponential backoff) now also does the initial synth. This drops the n8n-binary round-trip (`getBinaryDataBuffer`, `failureDiag` binary plumbing) — the buffer comes straight back from `tts()`.

2. **Batch-parallel synthesis.** The node was refactored from single-job (`$('Expand TTS Jobs').item`) to a batch processor: per-job logic lives in `async function synthOne(job)`; the body runs `await Promise.all($input.all().map(j => synthOne(j)))` and returns one item per input job. Output json/binary shape is byte-identical to before, so Save to Drive / Prepare Localization Row / Update Localizations are unaffected.

3. **`Loop Over Items` batchSize 1 → 7.** Concurrency = batchSize: ≤7 `synthOne` run at once → ≤7 simultaneous ElevenLabs calls (retries within a job stay sequential). Memory bounded to ~7 WAVs live at a time (vs holding all 329 if we had dropped the loop). The knob is the node's batchSize, not a config key — raise it (e.g. 14) on a high tier, lower toward 1 to throttle. The `Loop [done] → Read Localizations Fresh` Phase 2 trigger and node layout are preserved.

4. **`Rate Limit Guard` 1.5s → 0.2s.** With concurrency already bounded at 7 and Scale-tier limits, the per-batch wait drops to ~9s total over 47 batches (was ~8 min over 329 items). Kept as a node (not removed) so it stays a tunable safety valve.

Why bounded-loop over a single all-jobs Code node: matches the codebase concurrency idiom (Phase 2 `runReTtsTasks` chunked `Promise.all`) while capping peak memory — a single node returning all 329 (or 630) base64 WAVs risked OOM on long lessons.

Out of scope: parallelizing Save to Drive / Update Localizations (Drive uploads stay sequential within each batch — a separate, smaller bottleneck). Phase 2 re-TTS already bounded-concurrent (`ELEVENLABS_CHUNK=5`).

Verification: `node --check` (wrapped) on `check_timing_and_pad.js`; `JSON.parse` + connection audit on W3 JSON (no node references the removed `ElevenLabs TTS`; `Loop[main#1] → Check Timing + Pad`; `Loop[main#0] → Read Localizations Fresh` intact). Re-import W3 → re-run sleep1_full: Phase 1 wall-clock collapses, slot-alignment invariant holds (each file = lead + en_duration, cross-lang lengths match), `needs_attention` only on genuine TTS failures. Then the 11-min lesson: no task-runner timeout, stable memory (7 WAVs/batch).

Rollback: revert this commit. To throttle without reverting: lower `Loop Over Items` batchSize toward 1 and/or raise `Rate Limit Guard` in the n8n UI.

---

### 2026-05-27 — W2_PARALLELIZATION

Context: A W2 run on sleep1_full (47 segments) takes ~8 min. The bottleneck is Adapt Translations — a single Code node whose OUTER loop over segments was sequential (the 7 langs within a segment were already parallel, but segments serialized into N waves). On an 11-min lesson (~90 segments) this would exceed n8n's **300s task-runner timeout**, which applies specifically to Code nodes. Raising the timeout is a band-aid; the fix is to make each Code node finish fast via bounded-concurrency parallelism — the pattern already used in Verify/Editor/Phase 2.

Decision (Tier 1+2; concurrency 8, CHUNK 6, both config-driven — confirmed with user):

1. **Adapt Translations → global (segment×lang) task-pool.** Prefill one output object per segment (preserving the exact downstream shape: `segment_id`, `en_text`, `en_duration_sec`, 7×`{lang}_text` = original, 7×`{lang}_adaptation_attempts` = 0). Flatten every over-budget cell (non-empty text, positive budget, estimate > budget×1.05) into one task list; drain it with a single global bound `w2_adapt_concurrency` (default 8) via chunked `Promise.all`. Each task runs the existing self-contained 3-attempt shorten loop and writes its cell back. Then recompute the per-segment `adaptation_attempts = max(per-lang)`. Wall-clock now scales with `over-budget-cells / 8`, not segment count. Output bytes identical to the old code for the same inputs.

2. **Verify + Gemini Editor CHUNK 3 → config (default 6).** `const CHUNK = 3` (Tier-1 era) became `parseFloat(configMap.w2_llm_chunk) || 6` in both nodes (and the orphaned OpenAI Editor, for consistency — all three already build `configMap`). Halves their wall-clock on Tier 2.

3. **Config keys** `w2_adapt_concurrency` (8) and `w2_llm_chunk` (6), both optional with code fallbacks — no live-sheet edit needed to benefit. Set `w2_adapt_concurrency=1` to revert Adapt to effectively sequential.

Out of scope (Tier 3, deferred): converting Claude Translate + Tone Analysis (httpRequest nodes) to parallel Code nodes. They're slow (~75s + ~20s) but NOT task-runner-bound, so they don't cause the node timeout. Worth doing for >15-min videos later.

Verification: `node --check` (wrapped) on both JS mirrors + `JSON.parse` on W2 JSON. Re-run sleep1_full → expect total W2 ~8min → ~3-4min, Adapt well under 300s, segments tab equivalent to a sequential run (modulo LLM nondeterminism). Then the 11-min lesson: every Code node stays under the task-runner timeout.

Rollback: revert this commit. Concurrency is config-gated, so `w2_adapt_concurrency=1` also reverts Adapt without code changes.

---

### 2026-05-27 — DYNAMIC_SPEED_AND_SLOWDOWN_FILL

Context: Goal — leave less silence in segments where the EN track is longer than the localization, and make the speed limits sane per-voice. Two problems: (1) the W3 shorten path used absolute speed steps `[1.10, 1.15]`, so a 0.8-speed voice (TR) was forced to an absolute 1.15 — a +0.35 jump that sounds artificial; (2) there was no slow-down lever at all — under-budget segments just got tail silence (Phase 2 only added text).

Decision (settings confirmed with user: Δ=0.15, slowdown only AFTER an expansion attempt, separate config keys for up/down):

1. **Dynamic speed-up cap (Phase 1, Check Timing + Pad).** Shorten retries now step relative to the voice's configured speed: `[voice.speed + Δ·⅔, voice.speed + Δ]`, cap `voice.speed + max_speed_up_delta` (default 0.15). A 1.0 voice keeps the 1.15 ceiling (no change); a 0.8 voice caps at 0.95.

2. **Slowdown-to-fill (Phase 2, reTtsOne).** After the expansion text is chosen and synthesized at voice.speed, if the slot still has silence > `slowdown_min_gap_sec` (default 0.5), the voice is slowed toward `voice.speed − max_slow_down_delta` (default 0.15) to stretch the audio and reduce silence. Stretch speed = `voice.speed × real/speechBudget`, clamped to the floor; the slowed take is used only if it still fits the slot. Unchanged-text (no_change) cells are slowed too when their Phase 1 gap exceeds the threshold (re-synthesized at the slow speed) — but skipped without a wasted TTS call when the gap is small. Overshoot cells are never slowed (no silence). `final_speed` records the actual speed used.

3. **Separate config keys** `max_speed_up_delta` / `max_slow_down_delta` (independent up/down limits) + `slowdown_min_gap_sec`. The old `max_speed` (absolute, actually unused — code hardcoded 1.10/1.15) and dead `min_speed` are removed from docs; safe to delete from the live sheet (code has fallback defaults).

Order of levers: text expansion runs first (attempt 1, and retry for still-short), slowdown fills residual silence within each re-TTS. Slowdown can preempt a harder text retry when it already fills the gap — intentional: slowdown is safer (no hallucination/false-friend risk) and meditation-appropriate (calmer pace), so filling small gaps by stretching rather than inventing more text is preferred.

Slot-alignment invariant preserved: every accepted file still equals `targetFileDur` (the Phase 1 slot); slowdown only shifts the split between speech and tail silence, never the total, so the cross-language EN-aligned length holds.

Trade-offs:
- More cells become has_binary=true (slowed no_change cells get new audio) → more Drive PATCHes; intended (that's how silence shrinks).
- Mixed speeds across segments (some 1.0, some 0.85) — gated by `slowdown_min_gap_sec` so only meaningful gaps trigger it, keeping pacing reasonably even. Raise the gap or lower `max_slow_down_delta` if pacing feels uneven.
- +1 TTS call per slowed cell (no LLM).

Verification: re-run a lesson with under-filled segments. Expect reduced tail_silence on Phase 2 cells, `final_speed` < voice.speed on slowed ones, full-WAV length unchanged (slot invariant), and slow voices (TR 0.8) no longer hitting an absolute 1.15 on shorten.

Rollback: revert this commit. Re-add `max_speed` only if reverting Phase 1 too.

---

### 2026-05-27 — W2_FORMALITY_LINT

Context: sleep2_end produced `seg_003_fr = "Faites confiance à la nuit"` — a formal (vous) imperative, while every other FR segment used informal tu (Tu n'as pas besoin, Commence, tu peux rester). Non-deterministic: the same segment was correct ("Fais confiance") in prior runs. The existing defenses are all LLM-prompt-based (translate_system FORMALITY section, qa_verify_system R6.c CLASS 2 + dedicated FR scan) and therefore probabilistic. R6.c itself documents the failure: when only ONE segment in a batch violates, the LLM scan reads casually and misses it.

Decision: Add a deterministic `Formality Lint` Code node to W2, placed AFTER all LLM passes (Adapt Translations) and BEFORE Update Sheet — so it catches anything that slipped through and fixes the source `{lang}_text` that W3 later reads. The node:
1. Scans every {lang}_text for formal-address markers across all 7 langs (100% recall on known markers): FR vous/votre/vos + whitelisted formal imperatives (Faites/Prenez/Respirez…); DE Sie/Ihnen/Ihre; ES usted(es); IT Lei/Suo/Sua/Voi; PL Pan/Pani/Państwo…; PT você(s); TR siz…. Detection uses Unicode-aware boundaries `(?<!\p{L})…(?!\p{L})` with the /u flag (ASCII \b breaks around accented letters like você, Państwo, Écoutez). FR/ES/PT/TR markers are case-insensitive (wrong in any case); DE/IT/PL are case-sensitive (lowercase sie/lei/pan are legitimate she/she/noun).
2. For flagged cells only, sends a single targeted Anthropic call (formality_fix_system prompt, with built-in default — optional Sheet override) that rewrites to informal singular changing ONLY address/formality, preserving meaning/length/pause markers. Returns text unchanged if already informal → false-positive detections are harmless, so detection can be generous.
3. Replaces the flagged {lang}_text in place; passes all items through to Update Sheet (autoMap by segment_id).

Decisions taken (via grill): action = detect + targeted LLM re-fix (not flag-only, not deterministic regex auto-fix — regex can't reliably do votre→ton/ta gender agreement or vous-object→te); scope = all 7 langs (markers already enumerated in qa_verify_r6c; same failure can hit any lang).

Rationale: deterministic detection closes the recall gap of probabilistic LLM scans; the LLM does the linguistically-correct conversion (the failure was the model not NOTICING in a batch, not being unable to convert when told explicitly). The no-op-when-clean property makes detection safe to over-trigger.

Trade-offs:
- +1 Anthropic call per run only when ≥1 cell is flagged (rare); batched across all flagged cells.
- The lint fixes the segments-tab source, so W3 (and any re-run) inherit the correction.
- Detection whitelists (esp. FR imperatives) may miss an unlisted formal verb; add to FR_FORMAL_IMPERATIVES as found. vous/votre/vos catch most FR cases regardless.
- `formality_fix_system` prompt is OPTIONAL (built-in default in the node); add the Sheet row only to tweak without re-import.

Verification: re-run a lesson; any FR/DE/etc formal slip is auto-corrected in segments tab before W3. Console logs flagged count per lang and applied-fix count. A cell that still matches a marker after fix is logged (stillFormal) for follow-up.

Rollback: remove the Formality Lint node (Adapt Translations → Update Sheet direct). Deterministic detection + node are self-contained.

---

### 2026-05-27 — PHASE2_SLOT_DURATION_DRIFT

Context: User noticed full WAV lengths differed between languages and felt segments were drifting from their EN start positions. Root cause (present in Phase 2 since inception, only now caught by close alignment inspection): `reTtsOne` rebuilt accepted files to duration = `en_duration` instead of the segment's full slot = `lead_silence + en_duration`. The tail formula `tail = en_duration - lead - newRealDur` subtracts lead, so `finalDur = lead + real + tail = en_duration` — every accepted Phase 2 file was short by exactly its `lead_silence`. Phase 1 files correctly occupy the full slot (`lead + en_duration`), so a mix produced cumulative drift: each accepted segment shifted everything after it earlier by `lead`. Because languages have different counts of accepted segments with different leads, total shortfall differed per language (sleep2_end: de −0.56s, es −0.72s, it −0.24s, pl −0.32s) → unequal full lengths.

Decision: Target the exact Phase 1 file duration. `reTtsOne` now uses `targetFileDur = info.phase1_final_duration` (already captured in the candidate, falls back to `lead + en_duration`), with `tail = targetFileDur - lead - newRealDur` and overshoot guard `newRealDur > (targetFileDur - lead)`. The rebuilt file equals the slot the Phase 1 file occupied, so concatenation stays EN-aligned and all languages sum to the identical EN-total length.

Why phase1_final_duration is safe vs recomputing: it mirrors Phase 1 regardless of natural-lead vs breath-lead (naturalLead=0) segments, where the lead is carved *within* en_duration rather than added before it. Recomputing `lead + en_duration` would over-pad breath-lead segments. Phase 2 candidates never have borrow (`borrowed_sec>0` requires `real>en_dur`, but candidate filter requires `real<en_dur×0.85` — mutually exclusive), so phase1_final_duration always equals the clean slot with no borrow extension, and the borrow-trim logic in Build Full Audio is unaffected.

Verification: after re-run, every `{lesson}_full_{lang}.wav` has the SAME duration across all 7 languages (= EN timeline, ~last_en_end − first_slot_start), ±sample-rounding. Each segment starts at its EN slot position. `final_duration_sec` for accepted Phase 2 rows now equals the slot (lead + en_duration), matching Phase 1 passthrough rows for the same segment.

Rollback: revert this commit (reintroduces the per-segment `lead` shortfall and cross-language drift).

---

### 2026-05-27 — PHASE2_MERGE_BRANCHES

Context: The PHASE2_ORDERING_BARRIER fix (same day, earlier) gated the full-audio/VTT chain behind `Phase 2: Update Localizations`. But Update Localizations has TWO incoming connections (from `Phase 2: Drive Update` on the accepted/true branch, and from `Phase 2: Has Binary?` false branch). n8n executes a node once per incoming connection that delivers data, so Update Localizations fired TWICE — once with accepted items (~half), once with rejected+passthrough items (~half). When it was a terminal node this was a harmless idempotent double sheet-write. After the ordering-barrier fix hung Download→Build Full off it, each fire triggered a SEPARATE concat pass over a PARTIAL segment set. Result on sleep2_end: two full WAVs per language in the full folder (e.g. de 157 KB + 897 KB), each containing a different subset of segments in scrambled order, and the full audio not matching the per-segment output files.

Decision: Insert a `Phase 2: Merge Branches` node (n8n-nodes-base.merge, typeVersion 3, mode=append, 2 inputs) to recombine the IF branches into a single stream before Update Localizations:
- Has Binary? [true] → Drive Update → Merge[input 0]
- Has Binary? [false] → Merge[input 1]
- Merge → Update Localizations → Download Segment WAV + Build VTT Per Lang

Update Localizations now has exactly ONE incoming connection (from Merge), so it fires once with all ~329 rows. Download → Build Full Audio then runs once over the complete, sorted segment set → one full WAV per language, concatenated from the actual current Drive files (Phase 2 audio for accepted cells, Phase 1 for the rest — matching the output folder).

Item pairing (`$('Phase 2: Batch LLM+TTS').item.json.X` in Update Localizations column mappings) survives the Merge append — n8n preserves pairedItem linkage, so each row still resolves back to its Batch LLM+TTS source even though Drive Update output is a Drive API response shape.

Trade-offs / known edge:
- Merge "append" waits for both inputs. In the normal case both have data (there are always passthrough non-candidates on the false branch, and usually ≥1 accepted on the true branch). The rare 0-accepted lesson leaves Merge input 0 empty; recent n8n proceeds with the available input, but if a future 0-accepted lesson hangs at Merge, that's the place to look.
- User must delete the duplicate full WAVs from the bad sleep2_end run manually (Drive create-by-name doesn't overwrite).

Verification: re-run a lesson. Exactly ONE `{lesson}_full_{lang}.wav` per language in the full folder. Its content/length matches concatenating that language's per-segment output files (minus borrow trim). Lengths across languages converge to ≈ EN total (each segment padded to en_duration).

Rollback: revert this commit (reintroduces double-fire) — not advisable. Prefer fixing forward.

---

### 2026-05-27 — PHASE2_ORDERING_BARRIER

Context: User reported that per-segment WAVs in the output Drive folder did not match the concatenated full-lesson WAV in the full folder — both in total duration AND in content (some segments in the full WAV were a different generation than the per-segment files). Root cause: a race condition in the W3 execution graph. `Read Localizations Fresh` fanned out to THREE parallel branches off a single output: [Phase 2: Batch LLM+TTS, Download Segment WAV, Build VTT Per Lang]. The original 2026-05-25 design assumed n8n would run the Phase 2 branch to completion first because it was listed first — but n8n does not guarantee branch execution order for a single fan-out. Phase 2 takes ~2 min (batch LLM + re-TTS + Drive PATCH); Download Segment WAV is fast. So Download Segment WAV downloaded per-segment files (Phase 1 audio) and Build Full Audio concatenated them BEFORE / concurrently with Phase 2: Drive Update overwriting those same files with expanded audio. Net: full WAV = Phase 1 audio, per-segment Drive files = Phase 2 audio. Mismatch by design flaw.

Decision: Make the full-audio + VTT chain explicitly depend on Phase 2 completion instead of running in parallel. Rewired:
- `Read Localizations Fresh` → now feeds ONLY `Phase 2: Batch LLM+TTS` (dropped the parallel Download/VTT edges).
- `Phase 2: Update Localizations` → now feeds `Download Segment WAV` AND `Build VTT Per Lang`. Since Update Localizations is the terminal node of the Phase 2 chain (after Drive Update completes its PATCHes), the downstream concat chain starts only after all per-segment files are refreshed.

To make this work without a 0-candidate dead-end, `Phase 2: Batch LLM+TTS` now emits ALL input rows, not just candidates:
- Candidates: existing accept (binary) / reject (phase2_outcome) logic.
- Non-candidates (already-fitting rows, needs_attention rows, structurally-impossible skips): emitted as passthrough via `makePassthrough()` — full row, has_binary=false, phase2_outcome=''. They route through Has Binary?[false] → Update Localizations (idempotent rewrite of values they already hold).
- 0-candidate lesson: early-return now emits all rows as passthrough so the chain still runs and the full WAV is still built.

This guarantees Update Localizations always fires with the complete 329-row set, which deterministically triggers Download → Build Full Audio with the full segment list and refreshed Drive content.

Bonus: Build VTT Per Lang now reads post-Phase 2 text (it takes rows from Update Localizations output, which has the accepted expanded text), so subtitles align with the expanded audio. Previously VTT used pre-Phase 2 text from Read Localizations Fresh and could mismatch.

Trade-offs:
- Update Localizations now writes all ~329 rows every run (was: only candidates). appendOrUpdate batches into few API calls; ~5-15s extra. Idempotent — non-candidate rows rewrite identical values.
- Phase 2: Batch LLM+TTS emit count goes from ~candidates to always 329. Memory: passthrough items carry no binary, so heap impact is small (the ~30 accepted items with WAV binary dominate memory, unchanged).
- W3 wall-clock: the concat chain now runs strictly AFTER Phase 2 instead of overlapping it, so total time is Phase1 + Phase2 + concat (sequential) rather than Phase1 + max(Phase2, concat). Adds the concat duration (~1-2 min) to the critical path. Correctness over speed — the overlap was producing wrong output.

Verification: re-run any lesson through W_Master. Per-segment files in output folder must byte-match the corresponding portions of the full WAV. Check a known Phase 2 accepted segment (e.g. one with phase2_outcome=accepted, expansion_attempts=2): its standalone WAV duration and content should equal what's heard at its slot in the full lesson WAV. Full WAV length ≈ sum(final_duration_sec) − sum(borrowed_sec), all from post-Phase 2 values.

Rollback: revert this commit (restores the parallel fan-out and candidate-only emit). Note the original had the race condition — rollback reintroduces it.

---

### 2026-05-26 — PHASE2_TUNING_POSTRETRY

Context: First full W_Master run with Phase 2 retry pass + diagnostics (commit 48e8671) on sleep1_full revealed three issues in the CSV output:

1. **Data corruption in skipped emit**: for `negative_tail` / `no_change` / `overshoot` rejected candidates, my code overwrote Phase 1's stored `tail_silence_sec`, `final_duration_sec`, `borrowed_sec`, `final_speed`, `shorten_retries_in_synthesize` with values recomputed from the formula `tail = en_dur - lead - real_dur`. This formula doesn't match Phase 1's actual WAV structure for first-segment offsets, accumulated borrow, or structurally tight slots. Result: seg_001_fr showed `tail_silence_sec=-1.942` even though Phase 1's actual audio file is correct — only the sheet metadata was corrupted.

2. **Wasted LLM calls on structurally impossible cells**: Phase 1's natural EN lead for first segments (seg_001 lead=2.88s) or accumulated borrow (seg_011 lead=1.165s of en_dur=2.88s; seg_020 lead=4.64s of en_dur=9.04s; seg_038 lead=10.885s exceeding en_dur=6.24s!) leaves so little TTS budget that ANY expansion overshoots or hits negative_tail. ~15 of the rejected cells fell here — Phase 2 spent LLM and TTS calls on cases that physically cannot improve.

3. **Cross-language contamination in retry pass**: seg_019_es came back as `"...sino porque es essencial..."` — `essencial` is the Portuguese spelling (double 's'); Spanish uses `esencial` (single 's'). This is a classic Romance false-friend leak. The expansion ran in batch mode where multiple langs for the same segment_id appear side-by-side in the LLM input JSON, so the model "borrowed" PT orthography into the ES cell. Neither Verify nor Editor caught it. Retry-harder prompt seemed more prone to this (pushing for richer vocabulary increases false-friend risk).

Decision: Three targeted fixes, no architectural changes:

1. **Preserve Phase 1 fields verbatim in skipped emit**: candidates collection now stores `phase1_tail_silence`, `phase1_final_duration`, `phase1_borrowed`, `phase1_final_speed`, `phase1_shorten_retries` from the input row. Skipped emit branch writes these unchanged instead of recomputing. Update Localizations writes preserve Phase 1's actual file metadata.

2. **Structurally impossible filter**: at candidate collection time, skip cells where `lead_silence_sec >= en_duration_sec × STRUCTURALLY_IMPOSSIBLE_LEAD_RATIO` (default 0.5). These cells are not emitted at all — Phase 1 audio stays, sheet row untouched, `phase2_outcome` remains empty (= `not_candidate`). Console logs the skipped count. Saves ~30% Phase 2 LLM cost on lessons with large gaps. Cells that ARE structurally feasible still get attempted; the filter only prunes geometrically hopeless ones.

3. **Cross-lang isolation guard in expand prompts**: added `==== LANGUAGE ISOLATION ====` section to all three Phase 2 expand prompts (`w3_expand_batch_system`, `w3_expand_batch_retry_harder`, `w3_expand_batch_retry_shorter`). Section lists common Romance false-friend pairs explicitly (esencial/essencial/essenziale/essentiel, y/e, es/é, accent rules) and instructs LLM to treat each lang cell as fully isolated regardless of batch input shape. Harder-retry prompt has stronger warning since aggressive expansion correlates with false-friend risk. Verify/Editor system prompts NOT changed (shared with W2; out of scope here).

Rationale:
- Fix #1 unblocks accurate post-run analysis — without it sheet metadata for ~15 rejected cells per lesson is misleading.
- Fix #2 is a pure cost optimization. Structurally impossible cells were always rejected; now they're rejected upfront without LLM/TTS spend.
- Fix #3 is a quality fix targeting a specific reported regression (seg_019_es "essencial"). Cross-lang contamination is most likely with batched same-segment-multi-lang input format we use; explicit guard with false-friend examples is the cheapest mitigation. If it doesn't fully solve, next escalation is splitting batches per-lang (loses cache efficiency, ~3-4× cost).

Trade-offs:
- `STRUCTURALLY_IMPOSSIBLE_LEAD_RATIO=0.5` is conservative — some cells with lead between 0.4 and 0.5 might still be plausibly expandable. If the filter feels too aggressive after a few lessons, raise to 0.6. Configurable as constant in code.
- Cross-lang guard adds ~400 chars to each expand prompt → +400 chars × `cache_control: ephemeral` cached after first batch, so per-batch overhead is negligible after batch 1.

Verification: re-run W3 on sleep1_full. Expect:
- seg_001 / seg_011 / seg_020 / seg_038 cells with large leads have `phase2_outcome` empty (filtered out, never attempted)
- seg_019_es should now contain `esencial` (correct ES spelling); same for any new false-friend cases
- rejected cells with `phase2_outcome=overshoot` or `no_change` should have valid Phase 1 tail/final values matching the previous lesson's audio metadata

Rollback: revert this commit. Each fix is independent — could split into 3 commits if any fix proves problematic, but they're small and orthogonal enough to ship together.

---

### 2026-05-26 — PHASE2_RETRY_AND_DIAGNOSTICS

Context: Phase 2 batched expansion (commit c8e72d1) shipped and works end-to-end on sleep1_full — 21/47 candidates accepted, audio meaningfully expanded (seg_047 PT silence 6.255s → 0.083s, seg_044 PT "sem esso" typo → "sem esforço" caught by Editor). But 26 candidates remained unexpanded after a single pass, and the failure reasons (`no_change` / `overshoot` / `negative_tail` / `tts_empty`) were only visible via console.log histogram — not persisted in any Sheet, and lost entirely when n8n purges successful executions. Without per-cell diagnostics, it was impossible to tell whether to tune the prompt, the threshold, or the TTS budget. Additionally, cells where Phase 2 accepted expansion but the result was still very short (ratio < 0.70) were not flagged for human review.

Decision: Added a 2-pass retry mechanism to Phase 2 with per-candidate outcome diagnostics:

1. **Retry pass** (`code_nodes/phase2_batch_llm_tts.js` rewritten ~430 → ~580 LOC):
   - After attempt 1 (Expand → Verify → Editor → re-TTS), classify each cell by outcome.
   - `no_change` and accepted-but-still-short (newRealDur < en_dur × 0.85) → retry with `w3_expand_batch_retry_harder` prompt (push more ToV patterns, target_chars × 1.05).
   - `overshoot` → retry with `w3_expand_batch_retry_shorter` prompt (pull back, target_chars × 0.85, strict ceiling).
   - Retry skips Verify (latency saving) but keeps Editor (still catches typos on new expansion). `negative_tail`, `tts_empty`, `error` are not retried — too edge-case.
   - Final result per cell: prefer attempt 2 if accepted, else attempt 1 if accepted, else most recent skip reason.

2. **phase2_outcome column** in localizations sheet (`accepted` / `no_change` / `overshoot` / `negative_tail` / `tts_empty` / `error` / empty=`not_candidate`). Persists the diagnostic across runs regardless of n8n execution retention settings. Sortable/filterable in Sheets.

3. **Items emit for ALL candidates** (not just accepted) — Phase 2 Code now emits one item per candidate with `has_binary` flag. New IF node `Phase 2: Has Binary?` routes:
   - `has_binary=true` → Drive Update (PATCH new WAV) → Update Localizations
   - `has_binary=false` → Update Localizations directly (writes `phase2_outcome` and `expansion_attempts` only; Phase 1 audio stays in Drive untouched)

4. **needs_attention inline flag** — for accepted cells where `newRealDur < en_dur × 0.70`, set `needs_attention=true` in the emit. Threshold 0.70 (not 0.85) to avoid noise — flags only severely-short results that warrant human review.

5. **Two new optional prompt rows** in Sheets `prompts` tab: `w3_expand_batch_retry_harder` and `w3_expand_batch_retry_shorter`. Both load via `loadPrompt(key, vars, optional=true)` — if missing, Phase 2 falls back to single-pass behavior (graceful degradation). Templates committed under `prompts/proposed_changes/`.

Rationale: Per-candidate diagnostics unblock all future tuning iterations (CPS recalibration, threshold tuning, prompt revisions) — without them, every observation requires re-running with execution save enabled. Retry pass directly addresses the largest unaccepted category (`no_change`, ~50% of skips) where LLM returned identical text and a more aggressive prompt has a real chance. `expansion_attempts` semantics shifted: now means "LLM rounds the cell went through" (0/1/2), with accept/skip status carried by `phase2_outcome` — cleaner separation of metrics.

Trade-offs:
- W3 wall-clock +30-60s per lesson when retry candidates exist (1-2 extra batches × 2 prompt variants + ~10-15 re-TTS calls).
- Phase 2 emit changed shape: now emits ALL candidates including rejected ones. Downstream Drive Update would 400 on missing binary — mitigated by new IF node.
- `expansion_attempts` historic interpretation changed: pre-2026-05-26 `1`=accepted, post: `1`=attempt 1 ran (accepted OR rejected). For unambiguous accept/skip status, read `phase2_outcome` instead.
- New `phase2_outcome` column must be added to live localizations sheet before re-import — otherwise Update Localizations writes are no-ops for that column.

Verification: retry execution #71235 with currently saved workflow. Expect outcomes table to show ~10-15 cells flipping from `no_change`/`overshoot` to `accepted` via attempt 2. `phase2_outcome` should be populated for all 47 prior candidates (accepted + rejected). needs_attention=true for any accepted cells where newRealDur < en_dur × 0.70 (likely 3-5 cases).

Rollback path: revert the workflow JSON commit + delete both retry prompt rows from Sheets. Phase 2 Code falls back to single-pass behavior when retry prompts missing.

---

### 2026-05-25 — PHASE2_BATCHED_EXPANSION

Context: Inline expansion in W3's `Check Timing + Pad` (calling `w3_expand_system` per segment) was bypassing the Verify + Editor defense layer. Sleep1_full re-run with new ToV v3 expansion strategy introduced grammatical errors (DE seg_007 "und erwartend" instead of "erwarten"; PL seg_042 "przyść" typo not caught; FR seg_003 / DE seg_042 hit speed cap 1.15 due to expansion overshoot). Verify and Editor only run inside W2 Translate pipeline; any text W3 expansion generates is never re-validated.

Decision: Removed inline expansion from `Check Timing + Pad`. Added a 3-node Phase 2 chain in W3 that runs AFTER the per-segment Loop completes:
1. `Phase 2: Batch LLM+TTS` (Code) — collects all rows with `real_duration < en_duration × 0.85` AND `needs_attention=false`, groups by segment_id, sends batches of 8 segments to Anthropic (CHUNK=6 parallel — Tier 2) for expansion using new `w3_expand_batch_system` prompt, pipes through `qa_verify_system` and `editor_system` (same prompts as W2 Verify/Editor), then re-TTSes accepted text. Builds new WAV with same lead silence + new TTS + recomputed tail silence. Reverts to Phase 1 audio on overshoot.
2. `Phase 2: Drive Update` (HTTP Request) — PATCH /upload/drive/v3/files/{id}?uploadType=media via predefined Google Drive OAuth credential. Overwrites WAV binary in-place at same file_id so Download Segment WAV (in parallel branch) reads refreshed content transparently.
3. `Phase 2: Update Localizations` (Google Sheets appendOrUpdate by row_key) — writes new text_translated, real_duration_sec, tail_silence_sec, final_duration_sec, expansion_attempts=1.

Branch ordering: Read Localizations Fresh fans out to [Phase 2 chain, Download Segment WAV, Build VTT Per Lang] in that order. n8n's sequential connection evaluation runs Phase 2 to completion before Download starts.

Rationale: Expansion text now passes through the same Verify+Editor defense as initial translations from W2 — catches grammatical errors, regional drift, false-friend traps. Tier 2 Anthropic allows CHUNK=6 parallelism (vs W2's CHUNK=3 on Tier 1). cache_control:ephemeral on system prompts reuses across batches. Single mega-Code node design follows existing Check Timing + Pad pattern (API-key auth work in Code, OAuth side-effects via dedicated downstream nodes). Drive update via HTTP Request rather than n8n's googleDrive node because v3 "update" operation modifies metadata, not file content.

Trade-offs:
- W3 wall-clock ~+1-2 min per lesson (LLM batches ~30-60s, re-TTS ~30-50s with ELEVENLABS_CHUNK=5 parallel).
- Cost ~$1-2 additional per lesson (mostly batch LLM tokens + per-cell ElevenLabs TTS retries).
- PT/TR now receive expansion (Phase 1 inline gating excluded them via `finalSpeed===1.0` check; Phase 2 has no such gate).
- Old `w3_expand_system` Sheet row preserved as rollback backup (unused).

Verification: re-run sleep1_full through W3 only (translations already in segments tab). Expect: seg_007 DE has correct "erwarten"; seg_042 PL has "przyjść"; seg_044/047 silence reductions preserved (from R8); PT seg_047 6.4s tail silence now closed via expansion. New needs_attention=true cases should NOT increase relative to R8.

Rollback path: `git revert` the workflow JSON commit + delete `w3_expand_batch_system` row from Sheets `prompts` tab. Inline expansion was removed from Check Timing + Pad's jsCode — to fully revert, also restore that block via git.

---

### 2026-05-23 — TOV_V3_UNIVERSAL_PRINCIPLES_ADDED

Context: ToV v2 was meditation-centric. Spirio actually produces multiple content types: meditation, visualization, movement practices (Tai Chi/Qigong/Kundalini/Yoga), educational lectures, affirmations, mantras. Old ToV didn't differentiate.

Decision: ToV v3 adds three structural improvements:
1. Section 2 — Universal Principles (8 numbered rules applying to ALL content types)
2. Section 10 — Content Type Specific Guidance (Educational / Guided Practice / Vocal)
3. Section 12 — Translation Considerations (how to expand/shorten using authentic Spirio patterns instead of filler)

All language patterns and phrases from v2 preserved 1:1. Section ordering preserved for backwards compatibility with existing prompts referencing section numbers.

Rationale: Single ToV must cover all content types. Per-type subsections give translators and Tone Analysis the framework to handle different rhythms (short for practice, flowing for lecture). Translation Considerations directly addresses our expansion problem from real production data.

---

### 2026-05-23 — EXPANSION_STRATEGY_VIA_TOV_PATTERNS

Context: Previous expansion prompt said "restore meaning that was cut" — works only when adaptation actually cut something. Doesn't help when source translation is naturally short (TR, PL). Claude Code advised against filler words but didn't provide alternative.

Decision: New expansion strategy with 5 prioritized techniques, all sourced from ToV section 3 patterns:
1. Inviting modifiers ("when you're ready")
2. Sensory anchoring ("softly", "with care")
3. Permission language ("you don't need to")
4. Bridging awareness ("notice what happens when")
5. Internal pauses via ellipsis (`...`)

These are NOT filler — they ARE the substance of meditation/practice language. Expansion now explicitly classifies case as "restoration" (something was cut) or "authentic_expansion" (naturally short) and applies appropriate techniques.

Rationale: Validates the existing brand voice instead of fighting it. The very patterns that make Spirio recognizable are exactly the ones that lengthen text without breaking tone. Two-attempt limit with revert-on-overshoot prevents runaway expansion.

---

### 2026-05-22 — CPS recalibration (R7.a): TR 14→10, PL 14→13, PT 16→15

Context: After R4/R6.c prompt refactors stabilized translation quality, profiling `the_anchor` (31 affirmation segments × 7 langs) and combining with `test4` data (N=231 total samples) revealed measurable drift between configured `cps_estimate_*` values and observed chars-per-second at each voice's default playback speed. TR was the most painful: default_speed=0.80, observed CPS=10.5, configured at 14 — a -3.49 cps miss, causing chronic `final_speed=1.10/1.15` compression retries in W3 (8 of 31 TR segments hit the speed cap on the_anchor R4 run).

Decision:
- `cps_estimate_tr`: 14 → **10** (HIGH confidence, N=25, delta -3.49)
- `cps_estimate_pl`: 14 → **13** (HIGH confidence, N=21, delta -0.99 — at threshold, updated)
- `cps_estimate_pt`: 16 → **15** (HIGH confidence, N=30, delta -1.01)
- DE/ES/FR/IT: deltas under ±1.0, left unchanged.

Rationale: Filter rule for CPS measurement is now "at each lang's auto-detected default voice speed" (min observed `final_speed` per lang), not blanket `final_speed=1.0`. PT voice runs at 0.9, TR at 0.8 by default — previous script (filtered to 1.0 only) had ZERO samples for those langs, hiding the drift. New `analyze_cps.js` v2 auto-detects per-lang default speed, joins optional `segments.csv` for `segment_type` breakdown, and prints copy-pasteable config update commands.

Verification path: after applying new values, re-run a full lesson through W3 and re-run `analyze_cps.js` — expect |delta| < 1.0 across all langs at HIGH confidence.

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

---

### 2026-05-21 — W2_GEMINI_EDITOR_REPLACES_OPENAI_AS_DEFAULT

Context: GPT-5 на OpenAI Editor займав ~30с/batch — це primary bottleneck для W2 на великих файлах і вагомо вплинуло на 1m+ wall time навіть на 2-сегментних test4. Користувач спитав про альтернативи: Gemini Flash, DeepSeek. Підрахунок показав що для нашого use case (multilingual EU editorial QA на 7 мовах — DE/ES/FR/IT/PL/PT/TR):

- **Gemini 3.5 Flash** (щойно вийшов): ~5-8с/batch, ~10× дешевша за GPT-5, native JSON mode, **EU multilingual — найсильніша сторона Google** (Translate roots).
- **DeepSeek V3**: дешева, але EU multilingual слабша (тренована переважно EN/ZH). Не підходить.
- **GPT-5** (current): premium quality, але повільна і дорога. Edge на edge cases малопомітний для strict-editor role.

Decision: переключити default editor на **Gemini 3.5 Flash**, **залишивши OpenAI Editor ноду на canvas як orphan** для швидкого swap-back / A-B тесту якщо Gemini деінде поступиться у якості.

**Архітектура canvas-у** ([workflows/W2_Translate_v2.json](workflows/W2_Translate_v2.json)):
- `Verify Translations` → `Gemini Editor` → `Adapt Translations` — active chain
- `OpenAI Editor` — сидить на canvas позицією [2592, 1200] (під Gemini Editor), без жодних з'єднань — preserved as easy swap-back option

**Реалізація Gemini Editor**: near-clone OpenAI Editor через Google's **OpenAI-compatible endpoint**:
- URL: `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`
- Auth: `Authorization: Bearer ${gemini_api_key}` (Bearer-style як OpenAI)
- Body: standard OpenAI Chat Completions format (model, messages, response_format)
- Model: `gemini-3.5-flash`
- Реіспользується ВЕСЬ existing OpenAI Editor код через невеликі sed-replacements: config-key name, URL, model, function names. EDITOR_SYSTEM (~1100 токенів anti-pattern rules) лишається ІДЕНТИЧНИМ — language-agnostic.

**Cross-model diversity preserved**: Sonnet (Anthropic) → Gemini (Google) — все ще два різних family bias. Architectural equivalence з попередньою Sonnet+OpenAI конструкцією.

**Параллельність зберігається**: 9abaad8 chunked-concurrent (CHUNK=3) pattern inherited повністю. Жодних змін у параллельній логіці.

Rationale:
- **Multilingual edge для нашого use case**: Google Gemini Flash тренована на масивах перекладів — конкретно PL/TR/PT nuance ≥ GPT-5.
- **5-10× swift wall-time** на batch (GPT-5 ~30с → Gemini ~5-8с). Для 7-batch лекції OpenAI Editor stage йшов 90с після parallelization, Gemini buде ~15-25с.
- **10× cheaper** на input + output. Cost W2 stage drop з ~$0.10-0.20/lesson → ~$0.01-0.02.
- **JSON mode reliable**: Gemini native `response_format: json_object` через OpenAI-compat endpoint.
- **Easy revert**: OpenAI Editor нікуди не дівся — re-wire у n8n UI без коду.

Tradeoffs:
- **Якість на edge cases**: GPT-5 інколи краще ловить дуже субтильні false friends. Для strict-editor role ("return unchanged if clean") різниця мінімальна, але varies. Якщо помітимо regression на конкретних паттернах — re-wire OpenAI back.
- **Gemini може бути "creative-вольний"**: Flash моделі схильні до style edits навіть коли не просили. Поточний EDITOR_SYSTEM має explicit "return UNCHANGED" rule як primary defense. Monitor.
- **Prompt cache на Gemini**: implicit cache threshold у Gemini ~32K токенів, наш EDITOR_SYSTEM ~1100 — cache miss завжди. Але pricing уже такий низький що irrelevant.
- **Один новий API key**: `gemini_api_key` у config (free tier на aistudio.google.com стільки що hardly use). Easy onboarding.

Conflict with prior decisions: пом'якшує `OPENAI_GPT5_CROSS_MODEL_EDITOR` (2026-05-20) — той decision ввів cross-model editor але вибрав premium GPT-5. Тепер вибираємо Gemini Flash для same architectural goal з кращою economics. Сама cross-model судина (Sonnet + non-Anthropic editor) зберігається.

Files changed:
- `workflows/W2_Translate_v2.json` — додано Gemini Editor (active), орфановано OpenAI Editor (preserved on canvas)
- `code_nodes/gemini_editor.js` — новий mirror
- `docs/config_keys.md` — додано `gemini_api_key` (active) + reclassified `openai_api_key` (optional alternative)
- `workflows/README.md` — W2 node table updated

User-action:
1. Отримати API key з [aistudio.google.com](https://aistudio.google.com/) → Get API key (free tier)
2. Додати `gemini_api_key` рядок у config sheet
3. Re-import W2.json у n8n
4. Перший прогон — переконатись що Gemini не over-correct (порівняти `text_translated` з попереднім run)

A-B revert path:
- В n8n UI у W2 редакторі: видалити wire Verify → Gemini, додати Verify → OpenAI Editor, OpenAI Editor → Adapt. Зворотний swap без re-import.

Future work:
- Якщо A-B покаже Gemini уступає на конкретних мовах → залишити OpenAI Editor для тих мов через config-toggle на per-lang basis
- Або: `editor_model` config-ключ для quick swap між `gemini-3.5-flash` / `gemini-3-pro` / `gpt-5` / `gpt-5-mini` без переписування connections

---

### 2026-05-21 — PROMPTS_EXTERNALIZED_TO_SHEETS_TAB

Context: Усі system-промпти (translation, QA, editor, adapt, shorten/expand) і brand Tone of Voice жили захардкоженими у Code-нодах W2 і W3. Щоб тюнити wording — треба було лізти в n8n, знаходити правильну ноду, редагувати багаторядковий template literal у JSON-полі, і робити re-import. Дискомфортно для daily prompt-iteration.

Decision: винести **усі 10 промптів + ToV** у новий Google Sheets tab `prompts` з ключами і значеннями. Code-ноди читають його при кожному запуску і substitute placeholders.

**Архітектура**:
- Новий tab `prompts` у тому ж Sheet (columns: `key | description | value`)
- Дві нові sheet-read ноди: `Read Prompts` у W2 (між Read Config і Read Pending Segments), `Read Prompts` у W3 (між Read Config і Read Voices)
- Inline `loadPrompt(key, vars)` helper в кожній patched Code-ноді: будує `promptMap` з $('Read Prompts').all(), substitute-ить `{{var}}` placeholders, **кидає `Missing prompt "X"`** якщо key відсутній (fail-fast, no baked-in fallbacks per user choice)
- Placeholder convention: `{{var}}` (double curly braces без пробілів)

**Externalized keys** (11 total):
- `tone_of_voice` — brand voice spec (moved from `config` tab)
- `tone_analysis_system` — W2 Prepare Tone Analysis
- `translate_system` — W2 Prepare and Expand (`{{tov}}` placeholder)
- `qa_verify_system` — W2 Verify Translations
- `editor_system` — W2 Gemini Editor + OpenAI Editor (shared)
- `adapt_shorten_system` — W2 Adapt Translations
- `adapt_attempt_light/medium/max` — W2 Adapt 3-tier shorten templates with `{{lang}} {{budget}} {{est}} {{en}} {{trans}} {{min_chars}}` placeholders
- `w3_shorten_system` — W3 Check Timing single-segment shorten (`{{tov}}`)
- `w3_expand_system` — W3 Check Timing single-segment expand (`{{tov}}`)

**Migration aid**: новий `sheets/prompts.tsv` — TSV з усіма current values, copied verbatim з jsCode constants. Користувач paste-ить його в новий prompts tab; Sheets coreectly handles multiline quoted values на TSV paste.

**Файлові зміни**:
- `workflows/W2_Translate_v2.json` — додано `Read Prompts` ноду; 6 Code-нод (Prepare Tone Analysis, Prepare and Expand, Verify Translations, Gemini Editor, OpenAI Editor, Adapt Translations) переписано на `loadPrompt()`
- `workflows/W3_Synthesize_v2.json` — додано `Read Prompts` ноду; Check Timing + Pad переписано на `loadPrompt()` для SHORTEN/EXPAND
- `code_nodes/*.js` — всі 6 mirror files updated
- `sheets/prompts.tsv` — новий seed file з 11 рядками + header
- `docs/sheets_schema.md` — нова секція `Sheet: prompts` з повним schema і списком ключів
- `docs/config_keys.md` — `tone_of_voice` помічений як moved

Rationale:
- **Daily-edit-friendly UX**: edit-сейв-перезапустити без жодних n8n операцій. Workflow читає поточну версію промпта при кожному prompt-related call.
- **Single source of truth**: всі editable text в одному місці; config tab чистий тільки для API keys + folder IDs + numeric thresholds (system-level речі).
- **Fail-fast on missing keys**: typo в key → run падає миттєво з понятним повідомленням `Missing prompt "X" in prompts sheet`. Краще ніж silent-default яке могло б давати дивні результати.
- **Cache compatibility preserved**: рендеринг прoмптів детермінований за вмістом ряду — Anthropic `cache_control: ephemeral` cache hits продовжують працювати поки prompt row не змінюється. Editing prompt invalidates cache на наступний run — minor cost blip (~$0.01).
- **OpenAI Editor (orphan) patched теж**: тримає його inter-changeable з Gemini Editor — для swap-back не треба коду.

Tradeoffs:
- **One extra Sheets API read per run** (~1-2s): negligible vs. LLM call durations.
- **Throw on missing key може bite during exploratory editing**: користувач робить typo → run падає. Прийнятна ціна за visibility над silent fallback.
- **Template placeholder mistakes silent**: якщо user пише `{tov}` замість `{{tov}}`, substitution не firing і literal `{tov}` потрапить у промпт. Mitigation: documented convention в `sheets_schema.md` + `description` column у кожному ряду нагадує які placeholders дозволені.
- **TSV multiline paste**: works in Sheets для quoted values з вбудованими newlines (precedent in Google Sheets paste behavior). Якщо paste пошкодиться — fallback: open `prompts.tsv` в LibreOffice / Numbers / Excel, save as Google Sheets file, copy from there.

Conflict with prior decisions: complements `OPENAI_GPT5_CROSS_MODEL_EDITOR` (2026-05-20), `W2_GEMINI_EDITOR_REPLACES_OPENAI_AS_DEFAULT` (2026-05-21), `QA_SYSTEM_EXPANSION_FOR_CACHE_AND_COVERAGE` (2026-05-20). Усі ці decisions додавали або тюнили промпти — тепер тюнінг live-editable без code touchpoint.

User-action steps (one-time setup):
1. Open the Google Sheet → create new tab named **`prompts`**
2. Open `sheets/prompts.tsv` from repo → select all → copy → paste at A1 of new prompts tab
3. У `config` tab → delete the `tone_of_voice` row (тепер живе в prompts)
4. Re-import `workflows/W2_Translate_v2.json` AND `workflows/W3_Synthesize_v2.json` у n8n
5. Test run на 2-сегментній лекції → confirm output ≈ identical to today's good run

After this, prompt-editing flow is:
- Sheet → prompts tab → edit any `value` cell → save
- Next W2/W3 run uses the new text. Zero n8n actions.

Verification:
- Both workflow JSONs parse ✓
- All Code nodes pass JS-syntax check ✓
- No hardcoded big prompt consts left (`QA_SYSTEM` / `EDITOR_SYSTEM` / `SHORTEN_STATIC` / `EXPAND_STATIC` / `SYSTEM_PROMPT` / `ATTEMPT_PROMPTS` все на `loadPrompt(...)`) ✓
- `sheets/prompts.tsv` round-trip parses cleanly: 11 rows + header, multilines preserved ✓

Future work:
- Якщо row count росте → перейти з flat `key|description|value` на `category|key|description|value` для group-by-area view у Sheets
- Якщо user часто хоче A/B тестувати — додати `editor_model_override` ключ у prompts tab (або config) для quick swap між моделями

---

### 2026-05-21 — EXTERNAL_REVIEW_BRIEFING_DOC

Context: Після того як 11 промптів і ToV externalize-нулись у `prompts` Sheets-tab (commit `6eac2d7`), користувач захотів відправити проект на external evaluation — paste-нути briefing + поточні промпти в стороннюю LLM (GPT-5 / Claude Opus / Gemini) для оцінки якості промптів і architecture refactor suggestions.

Decision: створено `docs/external_review_briefing.md` — single self-contained Markdown document (~2800 слів) написаний як direct prompt для зовнішньої LLM. Структура:

1. Role framing
2. Project goal (1 параграф)
3. High-level architecture (W_Master → W1 → W2 → W3)
4. Data model (5 sheets tabs)
5. W2 translation pipeline detailed (всі 6 stages, 4-layer defense rationale, chunked-parallel CHUNK=3)
6. W3 synthesis pipeline brief (TTS + in-flight shorten/expand + breath-borrow timing)
7. Index of 11 prompts (key → role/consumer/model/placeholders/output/size)
8. Hard constraints (7 languages, informal address per-lang, EU variants, false-friend traps, ±25% length, preserve rules, ToV)
9. Recent observations (Gemini migration, latency cliff, prompts externalization)
10. Evaluation task (per-prompt review + cross-prompt review + architecture suggestions + risks)
11. Suggested output format (Markdown sections, ratings, suggested rewrites)
12. What NOT to change (load-bearing constants: keys, placeholder syntax, JSON schema, cross-model architecture, hard constraints)

Rationale:
- **Self-contained** — external LLM не може open repo links, тож все потрібне inline.
- **Neutral framing** — не "we think X is broken", щоб LLM формувала unbiased opinion. Recent iterations згадані як факти, не biases.
- **Не дублюємо prompt content** — користувач paste-нe актуальні рядки з sheet окремо. Briefing описує що кожен робить + accepted placeholders.
- **Explicit "do not change"** список — guard rails щоб LLM-suggestions не зламали code-side dependencies (prompt keys, placeholder syntax, JSON schema).
- **Suggested output format** — Markdown per-prompt sections з rating/strengths/issues/suggested-rewrite — дає LLM clear template і робить response easy to scan.

Files changed:
- `docs/external_review_briefing.md` — новий

User-action:
1. Open the briefing file → copy entire content
2. Open the live `prompts` tab in the Sheet → copy all 11 rows including header
3. Paste both into target external LLM (briefing first, then prompts table)
4. Ask for evaluation; iterate if LLM needs clarification

Future work:
- If pipeline changes significantly later, briefing must be regenerated manually (snapshot of current state)
- Could add a `scripts/regenerate_briefing.js` that pulls latest stats from DECISIONS.md + workflow node counts, but that's overengineering for now
