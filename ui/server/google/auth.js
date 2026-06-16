import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { JWT, OAuth2Client } from 'google-auth-library'
import { config } from '../config.js'

export const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive',
]

/**
 * Returns an auth provider with getAccessToken(): Promise<string>, or null in
 * mock mode. Never throws at construction — token acquisition failures surface
 * at call time and are classified by the callers / setup probe.
 */
export function makeAuth() {
  if (config.mode === 'mock') return null

  if (config.authMode === 'oauth') {
    const clientPath = process.env.GOOGLE_OAUTH_CLIENT_PATH
    const tokenPath = process.env.GOOGLE_OAUTH_TOKEN_PATH
    if (!clientPath || !tokenPath) {
      return brokenAuth('OAuth selected but GOOGLE_OAUTH_CLIENT_PATH / GOOGLE_OAUTH_TOKEN_PATH not set')
    }
    const absClient = resolve(config.uiRoot, clientPath)
    const absToken = resolve(config.uiRoot, tokenPath)
    if (!existsSync(absClient)) return brokenAuth(`OAuth client file not found: ${absClient}`)
    if (!existsSync(absToken)) return brokenAuth(`OAuth token not found — run "npm run auth": ${absToken}`)
    let oauth
    try {
      const raw = JSON.parse(readFileSync(absClient, 'utf8'))
      const c = raw.installed || raw.web
      if (!c?.client_id) return brokenAuth('OAuth client JSON missing installed/web.client_id')
      oauth = new OAuth2Client(c.client_id, c.client_secret, c.redirect_uris?.[0])
      oauth.setCredentials(JSON.parse(readFileSync(absToken, 'utf8')))
    } catch (e) {
      return brokenAuth(`OAuth credentials unreadable: ${e.message}`)
    }
    return {
      mode: 'oauth',
      async getAccessToken() {
        const { token } = await oauth.getAccessToken()
        if (!token) throw new Error('OAuth returned no access token (refresh token expired?)')
        return token
      },
    }
  }

  // Service account
  if (!config.sa.creds) {
    return brokenAuth(config.sa.error || 'service account key missing')
  }
  const jwt = new JWT({
    email: config.sa.creds.client_email,
    key: config.sa.creds.private_key,
    scopes: SCOPES,
  })
  return {
    mode: 'sa',
    email: config.sa.creds.client_email,
    async getAccessToken() {
      const { token } = await jwt.getAccessToken()
      if (!token) throw new Error('service account returned no access token')
      return token
    },
  }
}

function brokenAuth(reason) {
  return {
    mode: 'broken',
    reason,
    async getAccessToken() {
      throw new Error(reason)
    },
  }
}
