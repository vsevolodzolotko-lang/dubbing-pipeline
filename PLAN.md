# Roadmap & Status

Поточний стан: **production-ready baseline зведений**. 2-week MVP завершено; pipeline прогнаний на 11-хвилинному реальному уроці (`sleep1_full`). Документ переорганізовано в три блоки: (1) що зроблено по MVP-плану, (2) що зроблено понад план в R1–R7 + Phase 2, (3) що лишається до ship.

---

## 1. 2-week MVP — DONE

### Week 1 — Strict-Timing Pipeline ✅

- [x] **Day 1 — Cleanup та переоцінка стану**
  - Cascade-ноди (Aggregate, Get Localizations Fresh, Cascade Positioning, Save Positions to Sheet) видалені з W3
  - Колонки `position_start_sec`, `position_end_sec` прибрані з `localizations`
  - ToV з config sheet працює у W2; W1 коректно заповнює `en_duration_sec`

- [x] **Days 2-3 — Tone Analysis як перший крок Translate**
  - `prompts/tone_analysis.md` + ноди Prepare Tone Analysis → Claude Tone Analysis → Parse Tone Map в W2
  - Per-segment metadata (`segment_type`, `movement_keywords`, `key_concepts`) записується в `segments` sheet
  - Translation prompt отримує tone_map як контекст

- [x] **Days 4-5 — Adaptation Loop у Translate**
  - 3-tier shorten (light/medium/max) винесений у `code_nodes/adapt_translations.js`, інтегрований у W2
  - `prompts/adaptation.md` + `adapt_attempt_*` промпти у Sheets `prompts` tab
  - В R6.a (2026-05-22) merge у єдиний шаблон `adapt_attempt_unified`

- [x] **Days 6-7 — Synthesize v2 (strict timing)**
  - PCM-based duration measurement без ffprobe
  - 3-tier shorten loop у Check Timing + Pad
  - Speed retry 1.10 → 1.15 → `needs_attention=true` як остаточний fallback
  - Per-segment WAV + concat → full per-lang WAV у Drive

- [x] **Days 6-7b — Synthesize v3 (smart timing)**
  - Breath-borrow / expansion / silence 20/80 → реалізовано, потім частково revoked (див. R/Phase 2 нижче)
  - Concat-time borrow compensation у Build Full Audio Per Lang

### Week 2 — Drive trigger + Atomic regenerate + Polish ✅

- [x] **Days 1-2 — W_Master Drive trigger**
  - `workflows/W_Master.json`: Drive folder watch → Parse Filename → Execute W1 → W2 → W3 → Slack notification
  - Multi-file drop працює (per-item ітерація + `lesson_id` фільтр у всіх Code-нодах W2/W3)

- [x] **Days 3-4 — W_Regen (atomic single-segment regenerate)**
  - `workflows/W_Regen.json` (commit `8fa446e`, 2026-05-28)
  - Замінює per-segment WAV "in place" з deterministic filename matching, без duplicate-файлів у Drive

- [x] **Days 5-6 — Real-world test**
  - Прогнаний `sleep1_full` (11 хв, 47 сегментів × 7 мов = 329 cells)
  - Видобуті production-grade проблеми задокументовані в `DECISIONS.md`: refusal detection, false-friend ES seg_019, borrow drift seg_035-037, n8n filesystem binary bug, 300s task-runner ceiling
  - Усі пофікшено в R/Phase 2 ітераціях

- [x] **Day 7 — Buffer / boss-doc**
  - README.md повний rewrite під production-ready статус (2026-05-17)
  - `docs/external_review_briefing.md` (2026-05-21) — single-doc briefing для зовнішнього прогляду промптів і архітектури

---

## 2. Post-MVP refactor R1–R7 + Phase 2 + Formality Lint — DONE

Все робилося в response на конкретні фейли з real-world прогонів. Хронологія в `DECISIONS.md`, тут — index.

### Robustness & Scaling

- [x] **Retry + backoff** на Claude/ElevenLabs (`DECISIONS.md` 2026-05-18)
- [x] **Batched translation** для уникнення token rate-limit (CHUNK=3, 2026-05-18)
- [x] **Bounded concurrent batches** у Verify/Editor/Adapt (R2, 2026-05-21)
- [x] **SplitInBatches scaling** — W2 Adapt (batchSize=15) + W3 Phase 2 (batchSize=105 = 15×7) wrapped під n8n 300s task-runner ceiling (2026-05-28)
- [x] **Filesystem binary mode root-cause fix** — `tts()` inline helper bypass через `httpRequest({encoding: 'arraybuffer'})` (2026-05-21)
- [x] **Empty buffer guard + 100ms PCM threshold** у Check Timing + Pad (2026-05-21)

### Quality & Prompts

- [x] **R1** — pause-marker rule + output-purity reminders
- [x] **R3.a** — fail-loud on dropped segments
- [x] **R4** — qa_verify_system (semantic) vs editor_system (native-rhythm) differentiated
- [x] **R5** — data-informed translate_system rewrite
- [x] **R6.a** — adapt_attempt_{light,medium,max} merged → unified template
- [x] **R6.c** — three-layer false-friend defense + cross-segment mantra consistency + FR formality scan
- [x] **R7.a/R7.b** — CPS calibration tooling (`scripts/analyze_cps.js`) + runbook у `scripts/README.md`
- [x] **ToV v3** — universal principles + per-content-type guidance + translation considerations (2026-05-23)
- [x] **Prompts externalized** у Sheets `prompts` tab (11 промптів + ToV, 2026-05-21)
- [x] **Formality Lint** — deterministic enforce informal address у W2 (Phase 1) і W3 Phase 2 expand output (2026-05-27)

### Phase 2 (slowdown-to-fill + expansion via patterns)

- [x] **W3 Phase 2 batched expansion** через Verify + Editor (2026-05-25)
- [x] **Phase 2 retry pass** (`reTtsOne` speed-up на overshoot) + per-candidate diagnostics
- [x] **Cross-lang isolation** + structural filter + data-corruption fix
- [x] **LLM refusal detection** (REFUSAL_PATTERNS + `looksLikeRefusal`) — Opus 4.7 occasional English meta/refusal на rare cases
- [x] **Diff-first restoration** + gender neutrality + Opus 4.7 на Phase 2 (2026-05-28)
- [x] **Dynamic per-voice speed** + Phase 2 slowdown-to-fill (2026-05-27)
- [x] **Slot duration derived from `en_end - en_start`** (не зі збереженого `en_duration_sec`, 2026-05-22)

### Subtitles & VTT

- [x] **VTT subtitles per-lang у W3** — emit + upload у dedicated Drive folder (2026-05-20)

---

## 3. Open items — до production ship

Розбито за пріоритетом. Те, що тут — це те, що реально треба зробити, перш ніж віддавати продукт босові / клієнту.

### Must-have перед ship

- [x] **Boss-facing 1-page doc (2026-06-01)** — `docs/operator_manual.md` (українською). Drop файлу → перевірка → W_Regen для точкових фіксів. 6 секцій з explicit decision matrices, без технічного жаргону. Лінк додано у `docs/README.md` як першу позицію в таблиці.
- [ ] **QA dashboard / Sheet view** — фільтр по `needs_attention=TRUE`, `phase2_outcome=llm_refusal`, `llm_dropped` та `shorten_retries_in_synthesize >= 3`. Зараз ці колонки є, але людина мусить вручну фільтрувати — треба saved view + Slack alert якщо >0 за прогін.
- [ ] **End-to-end прогін ще на 1-2 уроках різного формату** (наприклад: 30-сек афірмація + 20-хв медитація). Sleep1_full — лише один кейс; треба covering для edge cases по тривалості.
- [ ] **External review briefing follow-up** — `docs/external_review_briefing.md` готовий, але результати зовнішньої оцінки промптів і архітектури ще не інтегровані. Якщо feedback зібрано — закрити TODO в `prompts` tab.

### Should-have (cleanup)

- [x] **Borrow / dead-key audit (2026-05-31)** — підтверджено, що `max_borrow_per_segment_sec` НЕ dead: він активний для short segments (`en_duration < short_seg_threshold_sec`, default 2.0с) через `CONDITIONAL_BREATH_BORROW_FOR_SHORT_SEGMENTS` (2026-05-19), а concat-time компенсація у `Build Full Audio Per Lang` нейтралізує per-segment overshoot для full WAV. Розширення borrow на всі сегменти (Варіант B) відкладено до явного запиту — поточна поведінка дає cross-lang sync на per-segment рівні + breath room для коротких афірмацій. Документація синхронізована у README.md (Sheets cheatsheet + localizations watch-list) і `docs/config_keys.md`.
- [x] **Drive folder archive rotation (2026-06-03)** — W_Master тепер на старті кожного прогону переміщує файли з working folders (`01_input`, `02_output`, `03_full`, `04_vtt`) у dated subfolder в `05_archive` (новий config key `drive_archive_folder_id`). Збережена структура папок; назва archive subfolder = basename попереднього 01_input файлу + `YYYY-MM-DD_HH-MM`. Move через Drive PATCH `addParents/removeParents` (не copy), single code node з `httpRequestWithAuthentication`. Throws якщо `drive_archive_folder_id` missing — no silent skip. Деталі в DECISIONS `W_MASTER_ARCHIVE_PREVIOUS_RUN_ROTATION`.
- [x] **Sync infrastructure extended (2026-06-04)** — `scripts/sync_jscode.js` (заміна `sync_w2_jscode.js`) тепер покриває **19 нод** через W1/W2/W3/W_Regen (раніше — лише 6 W2 нод). `npm run sync` додано у `package.json`. Resolved 3 `.js↔JSON` divergences: forward-sync `check_timing_and_pad.js` (deploy `LAST_SEGMENT_TRAILING_SILENCE_SEPARATION` consumer-side, який раніше "висів" у .js без deploy в JSON); reverse-sync `regen_synthesize.js` (JSON містив актуальну tri-state з commit 5c32db0); trivial `build_vtt_per_lang.js`. Extracted canonical `.js` для 3 inline-only нод (`expand_tts_jobs.js`, `segment_transcript.js`, `verify_translations.js`). W_Master + дрібні Get Params/Plan/Coalesce ноди (≤2.8KB) залишаються inline-only — extract on demand. Деталі в DECISIONS `SYNC_INFRASTRUCTURE_EXTENDED_TO_W3_W_REGEN`.
- [ ] **Залишкові dead config-keys** — `min_speed` (ніколи не wired) і старий absolute `max_speed` (superseded 2026-05-27 → `max_speed_up_delta`/`max_slow_down_delta`). Зараз тільки задокументовано як dead; можна фізично видалити рядки з config sheet (code має fallback default).
- [ ] **PLAN.md / DECISIONS.md cross-reference** — деякі decisions (наприклад `STRICT_ALIGNMENT_DISABLE_BREATH_BORROW`) частково revoke попередні; додати "see also" посилання, щоб новий читач не плутався
- [ ] **Sheets schema doc sync** — після всіх R/Phase 2 змін перевірити, що `docs/sheets_schema.md` відповідає тому, що реально пишеться (особливо нові колонки `phase2_outcome`, `phase2_diag`, `llm_dropped`, `final_speed`)

### Nice-to-have (post-ship)

- [ ] **Streaming concat via ffmpeg** — поточний Build Full Audio тримить всі WAVs в памʼяті; для уроків 30+ хв може стати проблемою (memory refactor зроблено 2026-05-19, але fundamental fix залишається на Phase 3)
- [ ] **W_Regen UX** — Webhook Trigger додано 2026-06-03 (клік на Slack-лінк "Open W_Regen" → workflow стартує без логіну в n8n). Залишається Sheet-based trigger (прапорець `regen=TRUE` у segment → W_Regen підхопив) для випадків коли оператор уже в Sheet редагує `text_translated` і не хоче переходити у Slack/n8n.
- [ ] **Cost dashboard** — поточний estimate в README ($0.10–0.25/lesson) ґрунтується на ~60-сек уроці; для 11-хв і 20-хв треба зібрати real-cost telemetry і додати у README
- [ ] **CPS calibration → Slack suggest у W_Master (R7.c)** — закрити manual цикл "експорт 3 CSV → run script → edit config". Окрема гілка в `W_Master` поряд з існуючим `Build Slack Message → Slack Notify`: `Read Voices → Compute CPS Recs → IF recs.length>0 → Build CPS Slack → Slack Notify`. Один новий Code-нод порту логіки з `scripts/analyze_cps.js` (~80 рядків, чиста арифметика). Функціонал:
  - **Rolling window** замість per-lesson — config key `cps_window_lessons=5`, інакше завжди LOW confidence
  - **Tiered trigger**: HIGH (N≥20) + |delta|>1.0 постимо; MED + |delta|>2.0 як early signal; решта — тихо
  - **Anti-spam** через `config.last_cps_signature` (hash рекомендацій) — не дублюємо ті самі suggestions щодня
  - **Voice-change detection** через hash voices snapshot → окремий alert "ребейзлайн з наступних лекцій"
  - **Per-content-type сигнал** (опц.) — якщо `segments.segment_type` дає `|delta_vs_lang_mean|>1.5`, окремий рядок про potential per-type CPS
  - **Optional auto-apply** gated config key `cps_auto_apply=false` за замовчуванням; коли `true` + HIGH + |delta|>1.5 — нода також робить Sheets Update і пише "✅ auto-applied" замість "📝 suggested"
  - **НЕ робити**: інтерактивні Slack buttons, окремий `tts_metrics` tab (`localizations` достатньо), повідомлення "all stable" (шум)
  - Ризик: на 50+ лекціях × 7 мов `Read Localizations` тягне ~10k рядків — якщо стане повільно, додати фільтр "тільки останні N днів". `voices.csv` snapshot може застаріти — читати `voices` tab з Sheets, не файл.
