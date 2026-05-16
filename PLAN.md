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
- [x] Workflow_Synthesize (переробити v2) → W3_Synthesize_v2.json:
  - TTS в PCM 22050Hz (точне вимірювання без ffprobe)
  - Виміряти real_duration_sec з розміру PCM буфера
  - Якщо <= en_duration_sec × 1.05 → silence padding до en_duration
  - Якщо > → retry TTS speed 1.10 → re-measure
  - Якщо все ще > → retry speed 1.15
  - Якщо все ще > → flag needs_attention=true
  - Pad + WAV header → upload to Drive
- [x] Output .wav у Drive: flat folder (drive_output_folder_id з config) → seg_NNN_{lang}.wav
- NOTE: Реалізовано як "Check Timing + Pad" Code node (code_nodes/check_timing_and_pad.js).
  Duration вимірюється з PCM bytes (без ffprobe). Silence padding через Buffer.alloc в JS.
  Потрібно: додати drive_output_folder_id в config sheet.

### Days 6-7b — Synthesize v3 (smart timing)

Архітектурне розширення поверх v2 після аналізу реального прогону sleep_001. v2 strict-timing душить там де можна "вдихнути", а адаптація в Translate інколи занадто агресивна (real_duration / en_duration падає до 0.58–0.85, що дає неприродну тишу).

**Effective slot per segment** (computed in Expand TTS Jobs):
- `gap_after = next.en_start_sec - this.en_end_sec` (0 для останнього)
- `max_borrowable = max(0, min(gap_after - min_inter_segment_gap_sec, max_borrow_per_segment_sec))`
- `effective_slot = en_duration_sec + max_borrowable`

**Synthesize flow (per segment × lang)**:
- [x] TTS at speed 1.0, виміряти `real_duration_sec` з PCM bytes
- [x] Branch на основі `real_duration` vs slot:
  - **`real ≤ tts_budget`** → padding 20/80 (lead/tail), DONE
  - **`tts_budget < real ≤ effective_slot`** → BREATH BORROW: accept TTS як є, без padding/trim, записати `borrowed_sec = real − en_duration`
  - **`real > effective_slot`** → Adapt shorten loop (single-segment Claude call):
    - Attempt 1 (light): прибрати filler/redundancies
    - Attempt 2 (medium): rephrase коротше зі збереженням concepts
    - Attempt 3 (max): compress до core meaning
    - Між кожною спробою re-TTS at 1.0 і re-check vs effective_slot
  - **IF after 3 adapt attempts still > effective_slot** → speed AS LAST RESORT:
    - speed 1.10 → re-TTS
    - speed 1.15 → re-TTS
    - Still over → `needs_attention=true`, hard truncate to fit
- [x] **Expansion loop** (after fit-check, only when shorten/speed never fired): IF `real_duration < en_duration × expansion_threshold` → single-segment Claude expand call, max 2 attempts. Якщо нова версія overshoots `effective_slot` → revert до попередньої коротшої.
- [x] **Silence distribution 20/80**: коли `real ≤ tts_budget`, розподілити `padding = tts_budget − real`:
  - Default: `silence_lead_ratio × padding` на lead, решта на tail
  - Exception: якщо natural EN gap (`lead_silence_natural_sec` з prev's en_end до this en_start) > 0 — використати його як lead (зберігає timeline alignment), всю padding в tail
- [x] **Output WAV**: `[lead_silence] + [TTS audio] + [tail_silence]`, total = `lead + real + tail` (з борровом може бути більше за `en_duration + lead`)
- [x] **Записати в localizations**: `real_duration_sec`, `lead_silence_sec`, `tail_silence_sec`, `borrowed_sec`, `final_speed`, `expansion_attempts`, `shorten_retries_in_synthesize`, `needs_attention`
- NOTE: Реалізовано в `workflows/W3_Synthesize_v2.json` — оновлені ноди Expand TTS Jobs, Check Timing + Pad, Prepare Localization Row + schema Update Localizations. Код у `code_nodes/check_timing_and_pad.js`.

**Config keys involved**: `min_inter_segment_gap_sec` (existing, реюз для borrow buffer), `max_borrow_per_segment_sec` (new), `expansion_threshold` (new), `silence_lead_ratio` (new).

**Sheet changes**: rename `trailing_silence_sec` → `tail_silence_sec`; add `borrowed_sec`, `expansion_attempts`, `shorten_retries_in_synthesize`.

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
