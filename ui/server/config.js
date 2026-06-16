import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const UI_ROOT = resolve(__dirname, '..')

dotenv.config({ path: resolve(UI_ROOT, '.env') })

/**
 * Build the runtime config. Never throws — if credentials are missing or
 * unreadable the app degrades to MOCK mode (or, when MODE=live is forced,
 * surfaces the problem through /api/setup/status). The server must always boot.
 */
function loadServiceAccount() {
  const json = process.env.GOOGLE_SA_KEY_JSON
  if (json && json.trim()) {
    try {
      const decoded = json.trim().startsWith('{')
        ? json
        : Buffer.from(json, 'base64').toString('utf8')
      return { creds: JSON.parse(decoded), source: 'env', error: null }
    } catch (e) {
      return { creds: null, source: 'env', error: `GOOGLE_SA_KEY_JSON parse failed: ${e.message}` }
    }
  }
  const path = process.env.GOOGLE_SA_KEY_PATH
  if (path) {
    const abs = resolve(UI_ROOT, path)
    if (!existsSync(abs)) return { creds: null, source: abs, error: `service account key not found at ${abs}` }
    try {
      return { creds: JSON.parse(readFileSync(abs, 'utf8')), source: abs, error: null }
    } catch (e) {
      return { creds: null, source: abs, error: `service account key parse failed: ${e.message}` }
    }
  }
  return { creds: null, source: null, error: null }
}

function buildConfig() {
  const port = Number(process.env.PORT || 8787)
  const host = process.env.HOST || '127.0.0.1'
  const sheetId = (process.env.SHEET_ID || '').trim()
  const authMode = (process.env.GOOGLE_AUTH_MODE || 'sa').trim()
  const enableWrites = String(process.env.ENABLE_WRITES || 'false').toLowerCase() === 'true'
  const cacheDir = resolve(UI_ROOT, process.env.CACHE_DIR || './cache')
  const audioCacheMaxGb = Number(process.env.AUDIO_CACHE_MAX_GB || 5)

  const sa = authMode === 'sa' ? loadServiceAccount() : { creds: null, source: null, error: null }

  // OAuth is "ready" only once a token has been minted (`npm run auth`); until
  // then we stay on mock instead of a broken live state.
  const oauthTokenPath = process.env.GOOGLE_OAUTH_TOKEN_PATH
    ? resolve(UI_ROOT, process.env.GOOGLE_OAUTH_TOKEN_PATH)
    : resolve(UI_ROOT, './secrets/oauth-token.json')
  const oauthReady = authMode === 'oauth' && existsSync(oauthTokenPath)

  // Decide mode. Forced via MODE; otherwise live only when we have a sheet + usable creds.
  const forced = (process.env.MODE || '').trim().toLowerCase()
  const haveLiveCreds = Boolean(sheetId) && (oauthReady || (authMode === 'sa' && Boolean(sa.creds)))
  let mode
  if (forced === 'mock' || forced === 'live') mode = forced
  else mode = haveLiveCreds ? 'live' : 'mock'

  return {
    port,
    host,
    mode,
    sheetId,
    authMode,
    enableWrites,
    cacheDir,
    audioCacheMaxGb,
    sa,
    serviceAccountEmail: sa.creds?.client_email || null,
    uiRoot: UI_ROOT,
    clientDist: resolve(UI_ROOT, 'client', 'dist'),
  }
}

export const config = buildConfig()
