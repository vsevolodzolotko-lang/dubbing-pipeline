# Day 1 — Verification Checklist

Ручні перевірки які треба зробити у n8n UI і Google Sheets перед переходом до Day 2.

## In n8n: Workflow_Synthesize v2 cleanup
- [x] Видалити ноду "Aggregate"
- [x] Видалити ноду "Get Localizations Fresh"
- [x] Видалити ноду "Cascade Positioning"
- [x] Видалити ноду "Save Positions to Sheet"
- [x] Loop Over Segments done branch тепер не підключений — це нормально
- [x] Експортувати оновлений workflow у workflows/synthesize_v2_post_cleanup.json
- [x] Закоміть експортований JSON

## In n8n: Workflow_Translate ToV verification
- [x] Відкрити Translate workflow
- [x] Знайти Claude API call (HTTP Request або Claude node) яка робить переклад
- [x] Перевірити system prompt: чи містить tone_of_voice content або посилання на нього? ✓ читає з config sheet по ключу `tone_of_voice` через "Read Config" ноду
- [x] Якщо НІ — задокументувати у DECISIONS як open issue, виправити на Day 2 разом з Tone Analysis — N/A, ToV присутній

## In Google Sheets: en_duration_sec
- [x] Відкрити Sheet segments
- [x] Перевірити що колонка en_duration_sec заповнена для всіх 9 рядків sleep_001
- [x] Перевірити що значення = en_end_sec - en_start_sec (з округленням)
- [x] Якщо порожнє або неправильне — фіксити Ingest workflow

## In Google Sheets: localizations cleanup
- [x] Відкрити Sheet localizations
- [x] Якщо є рядки з попередніх тестових прогонів — очистити (залишити тільки headers)

## Sign-off
Після всіх перевірок — додати запис у DECISIONS.md (формат YYYY-MM-DD — DAY1_VERIFICATION_COMPLETE) з підсумком що знайдено, що зафіксовано, що відкладено.
