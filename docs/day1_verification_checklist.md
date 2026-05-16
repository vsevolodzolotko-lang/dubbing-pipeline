# Day 1 — Verification Checklist

Ручні перевірки які треба зробити у n8n UI і Google Sheets перед переходом до Day 2.

## In n8n: Workflow_Synthesize v2 cleanup
- [ ] Видалити ноду "Aggregate"
- [ ] Видалити ноду "Get Localizations Fresh"
- [ ] Видалити ноду "Cascade Positioning"
- [ ] Видалити ноду "Save Positions to Sheet"
- [ ] Loop Over Segments done branch тепер не підключений — це нормально
- [ ] Експортувати оновлений workflow у workflows/synthesize_v2_post_cleanup.json
- [ ] Закоміть експортований JSON

## In n8n: Workflow_Translate ToV verification
- [ ] Відкрити Translate workflow
- [ ] Знайти Claude API call (HTTP Request або Claude node) яка робить переклад
- [ ] Перевірити system prompt: чи містить tone_of_voice content або посилання на нього?
- [ ] Якщо НІ — задокументувати у DECISIONS як open issue, виправити на Day 2 разом з Tone Analysis

## In Google Sheets: en_duration_sec
- [ ] Відкрити Sheet segments
- [ ] Перевірити що колонка en_duration_sec заповнена для всіх 9 рядків sleep_001
- [ ] Перевірити що значення = en_end_sec - en_start_sec (з округленням)
- [ ] Якщо порожнє або неправильне — фіксити Ingest workflow

## In Google Sheets: localizations cleanup
- [ ] Відкрити Sheet localizations
- [ ] Якщо є рядки з попередніх тестових прогонів — очистити (залишити тільки headers)

## Sign-off
Після всіх перевірок — додати запис у DECISIONS.md (формат YYYY-MM-DD — DAY1_VERIFICATION_COMPLETE) з підсумком що знайдено, що зафіксовано, що відкладено.
