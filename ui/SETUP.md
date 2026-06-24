# Dubbing Studio — налаштування

Локальний веб-інтерфейс для локалізаційного менеджера. Тонкий шар над Google
Sheets + Drive + n8n-вебхуками пайплайна. **Sheets лишається джерелом істини.**

## Швидкий старт (MOCK — без доступів)

Працює одразу на тестових даних, **не торкається живої таблиці** — безпечно
запускати, поки активно крутяться пайплайни.

```bash
cd ui
npm install
npm run dev      # розробка: сервер :8787 + Vite :5173 → відкрий http://localhost:5173
# або
npm run build && npm start   # прод-режим: усе на http://127.0.0.1:8787
```

Не-технічний запуск: подвійний клік на **`Dubbing Studio.command`** у Finder
(сам встановить залежності, збере і відкриє браузер).

## Підключення живої таблиці (read-only — теж безпечно)

Читання Sheets/Drive фізично не може змінити стан рану. Записи лишаються
**вимкненими** (`ENABLE_WRITES=false`), доки ти сам не захочеш тестувати дії.

1. **Окремий service account** (ізолює квоту від n8n — не використовуй креди n8n):
   - GCP Console → новий проєкт (напр. `dubbing-studio`).
   - Увімкни **Google Sheets API** і **Google Drive API**.
   - IAM → Service Accounts → Create (`dubbing-studio-sa`). Ролі не потрібні.
   - Keys → Add key → JSON → завантаж.
2. Поклади ключ у `ui/secrets/service-account.json` (тека в `.gitignore`).
3. `cp .env.example .env` і заповни:
   - `SHEET_ID` — ID таблиці пайплайна.
   - `GOOGLE_SA_KEY_PATH=./secrets/service-account.json`.
4. **Розшар** на email service account (`...iam.gserviceaccount.com`, видно в JSON):
   - таблицю — роль **Editor**;
   - спільного батька 5 Drive-тек (`01_input`…`05_archive`) — роль **Editor**.
5. Перевір: `npm run check` — має показати всі ✓.

> **Квота uploads (на майбутнє):** файли, залиті SA у звичайний My Drive,
> належать SA і їдять його 15 ГБ. Коли дійдемо до завантаження уроків —
> перенесемо теки у Shared Drive (config-only) або перемкнемо на OAuth. Для
> читання/перегляду це не має значення.

## Режими

| MODE | Коли |
|---|---|
| (порожньо) | авто: `live`, якщо є `SHEET_ID` + креди; інакше `mock` |
| `mock` | примусово тестові дані |
| `live` | примусово жива таблиця (покаже проблеми доступу, якщо є) |

## Безпека

- Сервер слухає лише `127.0.0.1` — не виставляється в мережу.
- Секрети з config-табу (API-ключі) **ніколи** не віддаються в браузер (маскуються).
- `w_regen_workflow_url` лишається на бекенді.
- Мутації приймаються лише з того самого origin (захист від localhost-CSRF).

## Переїзд на сервер з n8n (пізніше)

Чистий Node, нуль нативних залежностей: `rsync ui/` → `npm ci && npm run build`
→ systemd unit (`node server/index.js`) → nginx basic-auth / Tailscale попереду.
Додаток лишається single-user — не виставляй його голим у публічну мережу.
