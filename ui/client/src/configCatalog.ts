// Human-facing metadata for config keys (labels/tooltips/groups/bounds), sourced
// from docs/config_keys.md. The SERVER independently enforces which keys are
// writable — this is presentation only.

export type FieldType = 'csv' | 'number' | 'ratio' | 'text' | 'secret' | 'readonly'

export interface ConfigField {
  group: string
  label: string
  tooltip?: string
  type: FieldType
  min?: number
  max?: number
  step?: number
  editable?: boolean
  testable?: boolean // API-key smoke test
}

export const GROUP_ORDER = [
  'Мови',
  'Адаптація та переклад',
  'Сегментація (W1)',
  'Таймінг синтезу (W3)',
  'CPS — символів/с',
  'Drive-теки',
  'Slack / інтеграції',
  'Секрети (лише перегляд)',
  'Системне (не редагувати)',
  'Інше',
  'Мертві ключі',
]

const num = (label: string, min: number, max: number, step: number, tooltip: string, group: string): ConfigField =>
  ({ group, label, tooltip, type: 'number', min, max, step, editable: true })

export const CATALOG: Record<string, ConfigField> = {
  active_langs: { group: 'Мови', label: 'Активні мови', type: 'csv', editable: true, tooltip: 'Коди мов через кому, які пайплайн обробляє наскрізно (de,es,fr,it,pl,pt,tr). Порожньо = всі 7. Напр. «de» для прогону однієї мови.' },

  max_adaptation_attempts: num('Макс. спроб скорочення (W2)', 1, 5, 1, 'Верхня межа CPS-циклу скорочення на мову у W2.', 'Адаптація та переклад'),
  expansion_threshold: { group: 'Адаптація та переклад', label: 'Поріг розширення (Phase 2)', type: 'ratio', min: 0, max: 1, step: 0.05, editable: true, tooltip: 'Розширення спрацьовує, коли real_duration < en_duration × поріг. Вище = частіше намагається заповнити паузу.' },
  w2_adapt_concurrency: num('Паралельних скорочень (W2)', 1, 16, 1, 'Глобальний ліміт одночасних Claude-викликів скорочення.', 'Адаптація та переклад'),
  w2_llm_chunk: num('Паралельних LLM-батчів (W2)', 1, 12, 1, 'Скільки LLM-батчів обробляється паралельно у Verify/Editor.', 'Адаптація та переклад'),

  max_segment_duration_sec: num('Макс. тривалість сегмента, с', 6, 20, 0.5, 'Жорсткий ліміт тривалості EN-сегмента; довші речення ріжуться на природних паузах. Нижче (8–10) допомагає багатослівним мовам.', 'Сегментація (W1)'),
  min_intra_sentence_pause_sec: num('Мін. пауза для розрізу, с', 0, 1, 0.05, 'Мінімальний міжслівний проміжок, що вважається валідною точкою розрізу.', 'Сегментація (W1)'),
  min_segment_piece_duration_sec: num('Мін. шматок після розрізу, с', 0.5, 5, 0.1, 'Кожна частина розрізу має бути не коротша; запобігає мікросегментам.', 'Сегментація (W1)'),

  min_inter_segment_gap_sec: num('Мін. пауза між сегментами, с', 0, 2, 0.05, 'Мінімальна тиша між дубльованими сегментами (симетрично: steal-from-prev / borrow-from-next).', 'Таймінг синтезу (W3)'),
  max_borrow_per_segment_sec: num('Макс. borrow у паузу, с', 0, 4, 0.1, 'Скільки секунд сегмент може зайти в наступну паузу (breath-borrow).', 'Таймінг синтезу (W3)'),
  movement_borrow_max_sec: num('Borrow для руху, с', 0, 4, 0.1, 'Окремий ліміт borrow для movement-сегментів (Inhale/Hold/Exhale). 0 = жорстка прив’язка до en_duration.', 'Таймінг синтезу (W3)'),
  silence_lead_ratio: { group: 'Таймінг синтезу (W3)', label: 'Частка тиші перед TTS', type: 'ratio', min: 0, max: 1, step: 0.05, editable: true, tooltip: 'Яка частина padding-тиші йде ПЕРЕД аудіо (lead). Застосовується лише коли природний lead-проміжок = 0.' },
  silence_lead_max_sec: num('Макс. lead-тиша, с', 0, 0.5, 0.01, 'Жорсткий стеля breath-lead перед TTS, коли природний EN-проміжок = 0. 0 = строге EN-вирівнювання.', 'Таймінг синтезу (W3)'),
  max_speed_up_delta: num('Макс. прискорення (+до speed)', 0, 0.4, 0.01, 'Макс. прискорення над базовим speed голосу. Для 1.0 → стеля 1.20; для 0.86 (FR) → 1.06.', 'Таймінг синтезу (W3)'),
  max_slow_down_delta: num('Макс. уповільнення (−до speed)', 0, 0.4, 0.01, 'Макс. уповільнення нижче базового speed для заповнення тиші (Phase 2).', 'Таймінг синтезу (W3)'),
  slowdown_min_gap_sec: num('Поріг для уповільнення, с', 0, 2, 0.1, 'Уповільнення-для-заповнення застосовується лише коли залишкова тиша більша за це.', 'Таймінг синтезу (W3)'),

  ...Object.fromEntries(['de', 'es', 'fr', 'it', 'pl', 'pt', 'tr'].map((l) => [
    `cps_estimate_${l}`,
    num(`CPS ${l.toUpperCase()}`, 5, 25, 0.5, `Оцінка символів/с для ${l.toUpperCase()}. Використовується для прогнозу, чи влізе переклад у слот. Калібрується scripts/analyze_cps.js.`, 'CPS — символів/с'),
  ])),

  drive_input_folder_id: { group: 'Drive-теки', label: '01_input (вхід)', type: 'text', editable: true, tooltip: 'Тека, яку стежить W_Master. ⚠ Зміна впливає на пайплайн.' },
  drive_output_folder_id: { group: 'Drive-теки', label: '02_output (сегменти)', type: 'text', editable: true, tooltip: 'Тека per-segment WAV. ⚠ Впливає на пайплайн.' },
  drive_output_full_folder_id: { group: 'Drive-теки', label: '03_full (повні)', type: 'text', editable: true, tooltip: 'Тека повних WAV. ⚠ Впливає на пайплайн.' },
  drive_output_vtt_folder_id: { group: 'Drive-теки', label: '04_vtt (субтитри)', type: 'text', editable: true, tooltip: 'Тека VTT. ⚠ Впливає на пайплайн.' },
  drive_archive_folder_id: { group: 'Drive-теки', label: '05_archive (архів)', type: 'text', editable: true, tooltip: 'Корінь архіву. ⚠ Впливає на пайплайн.' },
  sheets_document_id: { group: 'Drive-теки', label: 'ID таблиці (snapshot)', type: 'text', editable: true, tooltip: 'ID живої таблиці для snapshot-копії в архіві. Зазвичай не чіпати.' },

  slack_channel: { group: 'Slack / інтеграції', label: 'Slack-канал (ID)', type: 'text', editable: true, tooltip: 'ID каналу, куди постяться повідомлення (напр. C01234ABCDE).' },
  w_regen_workflow_url: { group: 'Slack / інтеграції', label: 'URL вебхука W_Regen', type: 'text', editable: true, tooltip: 'Публічний вебхук W_Regen. ⚠ Capability-URL: будь-хто з ним може запустити платний реген.' },

  anthropic_api_key: { group: 'Секрети (лише перегляд)', label: 'Anthropic API key', type: 'secret', testable: true },
  gemini_api_key: { group: 'Секрети (лише перегляд)', label: 'Gemini API key', type: 'secret', testable: true },
  openai_api_key: { group: 'Секрети (лише перегляд)', label: 'OpenAI API key', type: 'secret', testable: true },
  elevenlabs_api_key: { group: 'Секрети (лише перегляд)', label: 'ElevenLabs API key', type: 'secret', testable: true },
  deepgram_api_key: { group: 'Секрети (лише перегляд)', label: 'Deepgram API key', type: 'secret', testable: true },
  slack_signing_secret: { group: 'Секрети (лише перегляд)', label: 'Slack signing secret', type: 'secret' },

  localization_run_token: { group: 'Системне (не редагувати)', label: 'run_token (поточний ран)', type: 'readonly', tooltip: 'Керується пайплайном. Не редагувати.' },
  localization_abort_token: { group: 'Системне (не редагувати)', label: 'abort_token (стоп)', type: 'readonly', tooltip: 'Керується пайплайном/кнопкою Стоп. Не редагувати.' },
  manual_w1_file_id: { group: 'Системне (не редагувати)', label: 'manual_w1_file_id', type: 'readonly', tooltip: 'Для ручного запуску W1 у n8n.' },
  manual_w1_lesson_id: { group: 'Системне (не редагувати)', label: 'manual_w1_lesson_id', type: 'readonly', tooltip: 'Для ручного запуску W1 у n8n.' },
}

// Removed/superseded keys — show under a collapsible group, read-only.
export const DEAD_KEYS = new Set(['min_speed', 'max_speed', 'short_seg_threshold_sec'])
