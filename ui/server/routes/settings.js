import { config } from '../config.js'
import { CONFIG_KEYS } from '../constants.js'

/** Health + setup diagnostics that drive the SetupError screen. */
export function registerSettingsRoutes(fastify, { snapshot }) {
  fastify.get('/api/health', async () => ({ ok: true, mode: config.mode }))

  fastify.get('/api/setup/status', async () => runSetupProbes(snapshot))
}

async function runSetupProbes(snapshot) {
  const checks = []
  const add = (id, label, status, detail, remediation) =>
    checks.push({ id, label, status, detail, remediation })

  if (config.mode === 'mock') {
    add('mode', 'Режим', 'pass', 'MOCK — тестові дані, жодного контакту з Google API', null)
    add('creds', 'Облікові дані Google', 'skip', 'Не налаштовані — працюємо на фікстурах', 'Додай SHEET_ID та service-account.json у .env, щоб підключити живу таблицю')
    return { ok: true, mock: true, mode: config.mode, serviceAccountEmail: null, checks }
  }

  add('mode', 'Режим', 'pass', 'LIVE — підключення до реальної таблиці', null)

  // Sheet id present?
  if (!config.sheetId) {
    add('sheet_id', 'SHEET_ID', 'fail', 'Не вказано', 'Додай SHEET_ID у .env')
    return { ok: false, mock: false, mode: config.mode, serviceAccountEmail: config.serviceAccountEmail, checks }
  }
  add('sheet_id', 'SHEET_ID', 'pass', config.sheetId, null)

  // Auth
  if (config.authMode === 'sa' && !config.sa.creds) {
    add('auth', 'Service account', 'fail', config.sa.error || 'ключ відсутній',
      `Поклади JSON-ключ у ${config.sa.source || 'ui/secrets/service-account.json'}`)
    return { ok: false, mock: false, mode: config.mode, serviceAccountEmail: null, checks }
  }
  add('auth', 'Service account', 'pass', config.serviceAccountEmail || config.authMode, null)

  // Live probe: try reading config tab
  try {
    await snapshot.sheets.getValues('config!A1:A1')
    add('sheet_read', 'Доступ до таблиці', 'pass', 'Таблиця читається', null)
  } catch (e) {
    const status = e.status
    const remediation = status === 403
      ? `Розшар таблицю на ${config.serviceAccountEmail} (роль Editor)`
      : status === 404
      ? 'Перевір SHEET_ID — таблицю не знайдено'
      : status === 401
      ? 'Ключ недійсний або зсув годинника на машині'
      : 'Перевір інтернет та доступи'
    add('sheet_read', 'Доступ до таблиці', 'fail', e.message, remediation)
    return { ok: false, mock: false, mode: config.mode, serviceAccountEmail: config.serviceAccountEmail, checks }
  }

  // Folders (from the just-read snapshot config)
  const m = snapshot.get()
  const folderKeys = [
    [CONFIG_KEYS.inputFolder, '01_input'],
    [CONFIG_KEYS.fullFolder, '03_full'],
    [CONFIG_KEYS.vttFolder, '04_vtt'],
  ]
  for (const [key, label] of folderKeys) {
    const id = m.configMap.get(key)
    if (!id) { add(`folder_${label}`, `Тека ${label}`, 'fail', `${key} порожній у config`, 'Заповни ID теки у config-табі'); continue }
    try {
      await snapshot.drive.listFolder(id, { fields: 'files(id)' })
      add(`folder_${label}`, `Тека ${label}`, 'pass', 'Доступна', null)
    } catch (e) {
      add(`folder_${label}`, `Тека ${label}`, 'fail', e.message,
        `Розшар теку на ${config.serviceAccountEmail}`)
    }
  }

  add('writes', 'Записи', config.enableWrites ? 'pass' : 'skip',
    config.enableWrites ? 'УВІМКНЕНО' : 'ВИМКНЕНО (тільки читання)',
    config.enableWrites ? null : 'Постав ENABLE_WRITES=true коли будеш готовий тестувати дії')

  const ok = checks.every((c) => c.status !== 'fail')
  return { ok, mock: false, mode: config.mode, serviceAccountEmail: config.serviceAccountEmail, checks }
}
