// One-time OAuth login: `npm run auth`. Reads a Desktop OAuth client JSON,
// runs a loopback consent flow in the browser, and saves the refresh token so
// the app can read Sheets/Drive AS the signed-in SKELAR user (sidesteps the
// external-service-account block on the org Shared Drive). Read-only scopes.
import http from 'node:http'
import { exec } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { OAuth2Client } from 'google-auth-library'
import { config, UI_ROOT } from './config.js'

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets', // read + WRITE (needed for verdicts/regen)
  'https://www.googleapis.com/auth/drive.readonly', // Drive stays read-only
]

function loadClient() {
  const path = process.env.GOOGLE_OAUTH_CLIENT_PATH || './secrets/oauth-client.json'
  const abs = resolve(UI_ROOT, path)
  if (!existsSync(abs)) {
    console.error(`\n✗ OAuth client file not found: ${abs}`)
    console.error('  Створи Desktop OAuth client у GCP і поклади його сюди (GOOGLE_OAUTH_CLIENT_PATH).\n')
    process.exit(1)
  }
  const raw = JSON.parse(readFileSync(abs, 'utf8'))
  const c = raw.installed || raw.web
  if (!c?.client_id || !c?.client_secret) {
    console.error(`\n✗ ${abs} не схожий на OAuth client (нема installed/web.client_id).`)
    console.error('  Потрібен тип "Desktop app" (Credentials → Create → OAuth client ID → Desktop app).\n')
    process.exit(1)
  }
  return c
}

function main() {
  const client = loadClient()
  const tokenPath = resolve(UI_ROOT, process.env.GOOGLE_OAUTH_TOKEN_PATH || './secrets/oauth-token.json')
  mkdirSync(dirname(tokenPath), { recursive: true })

  const server = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, redirectUri)
      const code = u.searchParams.get('code')
      const err = u.searchParams.get('error')
      if (err) { respond(res, `Помилка згоди: ${err}`); cleanup(1); return }
      if (!code) { res.writeHead(204); res.end(); return }
      const { tokens } = await oauth.getToken({ code, redirect_uri: redirectUri })
      if (!tokens.refresh_token) {
        respond(res, 'Увага: Google не повернув refresh_token. Спробуй ще раз (відкликай доступ у акаунті) — або це вже друга згода.')
      } else {
        respond(res, 'Готово! Можеш закрити цю вкладку і повернутись у термінал.')
      }
      writeFileSync(tokenPath, JSON.stringify(tokens, null, 2))
      console.log(`\n✓ Токен збережено: ${tokenPath}`)
      console.log(`  Облікові: ${tokens.refresh_token ? 'refresh_token отримано' : 'БЕЗ refresh_token (повтори вхід)'}\n`)
      cleanup(tokens.refresh_token ? 0 : 1)
    } catch (e) {
      respond(res, `Збій обміну коду: ${e.message}`)
      console.error('\n✗ Помилка:', e.message, '\n')
      cleanup(1)
    }
  })

  let redirectUri = ''
  let oauth
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port
    redirectUri = `http://127.0.0.1:${port}`
    oauth = new OAuth2Client(client.client_id, client.client_secret, redirectUri)
    const url = oauth.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: SCOPES,
    })
    console.log('\n— Dubbing Studio · вхід Google (read-only) —')
    console.log(`Проєкт: ${config.sheetId ? 'SHEET ' + config.sheetId.slice(0, 8) + '…' : ''}`)
    console.log('\nВідкриваю браузер для входу. Якщо не відкрилось — встав цей URL вручну:\n')
    console.log(url + '\n')
    exec(`open "${url}"`, () => {})
  })

  function cleanup(exitCode) {
    setTimeout(() => { try { server.close() } catch { /* */ } process.exit(exitCode) }, 300)
  }
}

function respond(res, msg) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(`<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:3rem;text-align:center">
    <h2>Dubbing Studio</h2><p>${msg}</p></body>`)
}

main()
