// One-shot setup diagnostic: `npm run check`. Same probes as /api/setup/status
// but printed to the terminal, exits 0 (all good) or 1 (something failed).
import { config } from './config.js'
import { makeAuth } from './google/auth.js'
import { makeSheetsClient } from './google/sheetsClient.js'
import { makeDriveClient } from './google/driveClient.js'
import { CONFIG_KEYS } from './constants.js'

const ICON = { pass: '✓', fail: '✗', skip: '–' }
let failed = false
function line(status, label, detail) {
  if (status === 'fail') failed = true
  console.log(`  ${ICON[status]} ${label}${detail ? ` — ${detail}` : ''}`)
}

async function run() {
  console.log(`\nLocalization Studio — setup check (mode=${config.mode})\n`)

  if (config.mode === 'mock') {
    line('pass', 'Режим MOCK', 'тестові дані, Google API не потрібен')
    line('skip', 'Google creds', 'додай SHEET_ID + service-account.json для live')
    console.log('\nOK — запускай `npm run dev` (розробка) або `npm start`.\n')
    return
  }

  if (!config.sheetId) return line('fail', 'SHEET_ID', 'не вказано в .env')
  line('pass', 'SHEET_ID', config.sheetId)

  if (config.authMode === 'sa' && !config.sa.creds) {
    return line('fail', 'Service account', config.sa.error || 'ключ відсутній')
  }
  line('pass', 'Service account', config.serviceAccountEmail || config.authMode)

  const auth = makeAuth()
  const sheets = makeSheetsClient(auth)
  const drive = makeDriveClient(auth)

  let configMap = new Map()
  try {
    const rows = await sheets.getValues('config!A:B')
    for (const r of rows.slice(1)) if (r[0]) configMap.set(String(r[0]).trim(), r[1] ?? '')
    line('pass', 'Доступ до таблиці', `${rows.length} рядків config`)
  } catch (e) {
    line('fail', 'Доступ до таблиці', `${e.message}${e.status === 403 ? ` → розшар на ${config.serviceAccountEmail}` : ''}`)
    return
  }

  for (const [key, label] of [
    [CONFIG_KEYS.inputFolder, '01_input'],
    [CONFIG_KEYS.fullFolder, '03_full'],
    [CONFIG_KEYS.vttFolder, '04_vtt'],
  ]) {
    const id = configMap.get(key)
    if (!id) { line('fail', `Тека ${label}`, `${key} порожній`); continue }
    try {
      await drive.listFolder(id, { fields: 'files(id)' })
      line('pass', `Тека ${label}`, 'доступна')
    } catch (e) {
      line('fail', `Тека ${label}`, e.message)
    }
  }

  line(config.enableWrites ? 'pass' : 'skip', 'Записи', config.enableWrites ? 'УВІМКНЕНО' : 'вимкнено (read-only)')
}

run()
  .then(() => {
    console.log(failed ? '\n✗ Є проблеми — див. вище.\n' : '\n✓ Усе гаразд.\n')
    process.exit(failed ? 1 : 0)
  })
  .catch((e) => {
    console.error('\n✗ Несподівана помилка:', e.message, '\n')
    process.exit(1)
  })
