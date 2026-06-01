# Інструкція локалізаційного менеджера

Щоденний цикл обробки одного уроку через dubbing pipeline: drop файлу → перевірка → точкове виправлення при потребі. Технічні деталі — у решті `docs/` (посилання в кінці).

---

## Як це працює

Кладеш EN-аудіо у вхідну Drive теку → автоматично запускається pipeline → за ~15–30 хв у Slack з'являється повідомлення з лінком на готовий дубляж 7 мовами (DE / ES / FR / IT / PL / PT / TR). Усе у фоні; ти втручаєшся тільки під час перевірки результату або точкових виправлень через W_Regen.

---

## 1. Запуск нового уроку

1. Назви файл як `{lesson_id}.mp3` — наприклад `sleep_002.mp3` чи `soma_yoga_intro.mp3`. Літери малі, без пробілів, латиниця. Це ім'я стане префіксом усіх сегментів (`sleep_002_seg_001`, `sleep_002_seg_002`, ...).
2. Перекинь файл у вхідну Drive теку (та сама, що ти зазвичай використовуєш — ID зашитий у workflow W_Master).
3. Чекай. Drive Trigger перевіряє теку кожну хвилину, далі pipeline біжить ~15–30 хв (залежно від довжини уроку та кількості сегментів).
4. У Slack прийде повідомлення `:white_check_mark: Dubbing complete` з:
   - `lesson_id`
   - source filename
   - кількість мов
   - **лінк на Drive теку** з 7 файлами `{lesson_id}_full_{lang}.wav`

Жодних кнопок натискати не треба. Drop → wait → notification.

---

## 2. Перевірка результату

Коли прийшов Slack — відкрий `localizations` sheet і подивись колонку `needs_attention` для цього `lesson_id`.

| Стан колонки `needs_attention` | Що робити |
|---|---|
| Усюди `FALSE` | Готово. Забирай `_full_{lang}.wav` з Drive і відправляй у доставку. |
| 1–3 cells `TRUE` | Послухай ці сегменти у Drive (окремі `{lesson_id}_seg_NNN_{lang}.wav`). Якщо звучить нормально — лиши. Якщо обрізано / звучить дивно — переходь до **W_Regen** (секція 3). |
| 5+ cells `TRUE` на одній мові | Поклич tech — швидше за все CPS-оцінка для цієї мови застаріла, треба калібрувати ([docs/cps_calibration.md](cps_calibration.md)). |

**Spot-check на слух**: відкрий 1–2 повних `_full_{lang}.wav` у плеєрі та послухай 30 секунд кожен. Перевір що голос природний, темп рівний, немає обривів чи дивних пауз.

Якщо налаштовано умовне форматування (див. секцію 4), колонка `needs_retts` після pipeline буде вся **червона** (FALSE усюди). Це нормальний стан "нічого не флаговано для перегенерації".

---

## 3. Перегенерація одного сегмента (W_Regen)

Коли якийсь сегмент звучить погано і ти хочеш переробити лише його:

1. У `localizations` sheet знайди потрібний рядок (`segment_id` + `lang`).
2. Відредагуй `text_translated` — виправ слово, додай `...` для паузи, перепиши фразу простіше.
3. Постав `needs_retts = TRUE` (якщо налаштовано форматування — комірка стане **зеленою**). Опціонально додай нотатку у `regen_comment` (наприклад "виправила рід жіночий").
4. Відкрий n8n → workflow **W_Regen — Manual cell regeneration** → натисни **Execute Workflow**.

Що станеться автоматично:
- ElevenLabs пересинтезує цю cell з новим текстом
- Drive-файл для сегмента переписується in-place (той самий ID лишається)
- У sheet: `needs_retts → FALSE` (червоний), `last_regen_at → timestamp` (UTC)
- Повний `{lesson_id}_full_{lang}.wav` перебудується автоматично

Можна флагати кілька рядків за раз — W_Regen обробить усі. **Обмеження MVP**: усі флаговані рядки мають належати **одному уроку**. Якщо помилково флагнула рядки з різних уроків — зніми флаги з усіх крім одного, запусти W_Regen, потім другий урок окремо.

---

## 4. Налаштування Sheet (одноразово)

Щоб візуально сканувати `needs_retts` без читання тексту:

1. Виділи колонку `needs_retts` (клік на заголовок).
2. **Format → Conditional formatting**:
   - Правило 1: `Text is exactly` → `TRUE` → background **зелений**
   - Правило 2: `Text is exactly` → `FALSE` → background **червоний**
3. **Format → Alignment → Center** (значення в комірках центруються).

Те саме можна застосувати до `needs_attention` для симетрії — буде видно з висоти пташиного польоту скільки рядків потребують перевірки.

---

## 5. Що робити коли щось не так

| Симптом | Перше що зробити |
|---|---|
| Drop у Drive, а Slack повідомлення немає за 1 год | (a) перевір ім'я файлу — без пробілів, латиниця, малі літери, `.mp3`; (b) перевір що у правильній Drive теці; (c) відкрий n8n → Executions — чи є невдала з error. |
| n8n показав червоне на W2 з повідомленням про "Translator dropped" | Re-run цього execution. У W2 є auto-recovery — зазвичай другий раз проходить. |
| n8n timeout на W3 (`Check Timing + Pad` 300 секунд) | Просто Re-run execution. Таймаути рідкісні, переважно проходять при повторі. |
| W_Regen відпрацював, але у sheet `needs_retts` залишився `TRUE` | Імпортуй останню версію `workflows/W_Regen.json` у n8n (раніше був баг із sheet update). |
| У DAW (Reaper) сегменти "пливуть" по таймлайну | Використовуй `_full_{lang}.wav` (повний концат), а **не** окремі сегменти end-to-end. Повний WAV вже зведений правильно. |
| `needs_attention=TRUE` на 10+ сегментах однієї мови | CPS-оцінка для цієї мови застаріла. Поклич tech або див [docs/cps_calibration.md](cps_calibration.md). |

---

## 6. Що НЕ чіпати у sheet

Системні колонки заповнюються автоматично pipeline або W_Regen. Ручне редагування буде або затерте при наступному запуску, або зламає логіку timing:

- `phase2_outcome`, `shorten_retries_in_synthesize`, `borrowed_sec`, `expansion_attempts`
- `final_speed`, `final_duration_sec`, `real_duration_sec`
- `lead_silence_sec`, `tail_silence_sec`, `slot_start_sec`, `slot_end_sec`, `tts_budget_sec`
- `audio_drive_file_id`
- `last_regen_at` — W_Regen ставить сам

Колонки які **можна** редагувати:

- `text_translated` — виправити текст перед W_Regen
- `needs_retts` — поставити `TRUE` щоб запустити перегенерацію цієї cell
- `regen_comment` — нотатка для аудиту (необов'язково, але корисно для майбутньої тебе)
- `needs_attention` — manual override; можна знімати флаг якщо послухала і на слух нормально

---

## Reference

- [docs/sheets_schema.md](sheets_schema.md) — повний опис кожної колонки sheet
- [docs/cps_calibration.md](cps_calibration.md) — як калібрувати CPS-оцінку (раз на ~5 уроків)
- [docs/localization_rules.md](localization_rules.md) — лінгвістичні правила (informal address, false friends)
- [README.md](../README.md) — технічна архітектура pipeline (для tech-команди)
