# 2-Week MVP Plan

## Week 1 — Strict-Timing Pipeline

### Day 1 — Cleanup та переоцінка стану
- [ ] Cleanup: видалити з Workflow_Synthesize v2 cascade-ноди (Aggregate, Get Localizations Fresh, Cascade Positioning, Save Positions to Sheet) — вони більше не потрібні
- [ ] Cleanup: видалити з Localizations sheet колонки position_start_sec, position_end_sec
- [ ] Verify: чи Workflow_Translate реально використовує ToV з config sheet (якщо ні — додати)
- [ ] Verify: Workflow_Ingest заповнює en_duration_sec правильно (не тільки en_start_sec)

### Days 2-3 — Tone Analysis як перший крок Translate
- [x] Створити prompts/tone_analysis.md — один Claude-виклик на весь скрипт уроку
- [x] Підготувати code_nodes: prepare_tone_analysis.js, parse_tone_analysis.js, prepare_and_expand.js (з tone context)
- [ ] У Workflow_Translate додати в n8n UI: Prepare Tone Analysis → Claude Tone Analysis → Parse Tone Map → Update Tone Columns → (existing translate flow)
- [ ] Оновити "Prepare and Expand" ноду кодом з code_nodes/prepare_and_expand.js
- [ ] Output: JSON з per-segment metadata: segment_type (narrative/movement/instruction), movement_keywords, key_concepts. Записати в Sheet (нові колонки segment_type, movement_keywords)
- [ ] Translation prompt отримує tone_map як додатковий контекст

### Days 4-5 — Adaptation Loop у Translate
- [x] Створити prompts/adaptation.md — для скорочення тексту під timing budget
- [x] У Workflow_Translate після перекладу: estimate duration (за CPS з voices або фіксованими langs ratio)
- [x] Якщо estimated > en_duration_sec * 1.05 → loop adaptation:
  - Attempt 1: легке скорочення (cut filler words)
  - Attempt 2: середнє скорочення (rephrase shorter)
  - Attempt 3: максимальне скорочення (preserve only key meaning)
  - Між кожною спробою — re-estimate
- [x] Записати final translation + adaptation_attempts count у Sheet
- NOTE: реалізовано як окрема "Adapt Translations" нода (Code node з helpers.httpRequest). Вставлена між "Extract Translations" і "Update Sheet" у W2_Translate_v2.json. Код у code_nodes/adapt_translations.js.

### Days 6-7 — Synthesize з strict timing
- [ ] Workflow_Synthesize (переробити v2):
  - TTS з natural speed (1.0)
  - Виміряти real_duration_sec
  - Якщо <= en_duration_sec → silence padding ffmpeg до en_duration
  - Якщо > en_duration_sec → speed adjust до 1.10 → TTS retry → re-measure
  - Якщо все ще > → speed adjust до 1.15 → TTS retry
  - Якщо все ще > → flag needs_attention=true, save as-is
- [ ] Output mp3 у Drive: output/{lesson_id}/{lang}/seg_NNN_{lang}.mp3, тривалість = en_duration

---

## Week 2 — Drive trigger + Atomic regenerate + Polish

### Days 1-2 — Drive-folder тригер
- [ ] Workflow_Master: Trigger = Google Drive folder watch на input/
- [ ] При новому файлі → запускає Ingest → Tone Analysis → Translate → Synthesize послідовно
- [ ] Notification у Telegram коли все готово (з посиланнями на output папку)

### Days 3-4 — Atomic regenerate single segment
- [ ] Workflow_Regenerate_Single: webhook trigger
- [ ] Input: segment_id, lang, optional new_text
- [ ] Якщо new_text дано — оновити в Sheet, скіпнути translate/adapt
- [ ] TTS → padding → upload (overwrite з backup у /_backup/)

### Days 5-6 — Real-world test
- [ ] Прогнан 2-3 повних реальних уроки через pipeline
- [ ] Зібрати список реальних проблем (звук, переклад, timing)
- [ ] Зафіксувати у DECISIONS.md як open issues

### Day 7 — Buffer
- [ ] Дебаг, шліфування, документація для босса
