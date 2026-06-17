import { existsSync } from 'node:fs'
import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import { config } from './config.js'
import { makeAuth } from './google/auth.js'
import { makeSheetsClient } from './google/sheetsClient.js'
import { makeDriveClient } from './google/driveClient.js'
import { makeSnapshotService } from './services/snapshot.js'
import { makeSse } from './sse.js'
import { registerReadRoutes } from './routes/read.js'
import { registerSettingsRoutes } from './routes/settings.js'
import { registerEventRoutes } from './routes/events.js'
import { registerAudioRoutes } from './routes/audio.js'
import { registerQaRoutes } from './routes/qa.js'
import { registerActionRoutes } from './routes/actions.js'
import { registerPresetRoutes } from './routes/presets.js'

async function main() {
  const fastify = Fastify({ logger: { level: 'info' } })

  // ── Security: localhost-only, same-origin guard on mutations ──────────────
  fastify.addHook('onRequest', async (req, reply) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return
    const host = req.headers.host || ''
    const okHost = host.startsWith('127.0.0.1') || host.startsWith('localhost')
    const site = req.headers['sec-fetch-site']
    const sameOrigin = !site || site === 'same-origin' || site === 'none'
    if (!okHost || !sameOrigin) {
      return reply.code(403).send({ error: 'cross-origin mutation rejected' })
    }
  })

  // ── Wire services ─────────────────────────────────────────────────────────
  const auth = makeAuth()
  const sheets = config.mode === 'live' ? makeSheetsClient(auth) : null
  const drive = config.mode === 'live' ? makeDriveClient(auth) : null
  const sse = makeSse()
  const snapshot = makeSnapshotService({
    auth, sheets, drive,
    broadcast: sse.broadcast,
    getClientCount: sse.getClientCount,
  })

  registerReadRoutes(fastify, { snapshot })
  registerSettingsRoutes(fastify, { snapshot })
  registerEventRoutes(fastify, { sse, snapshot })
  registerAudioRoutes(fastify, { snapshot, drive })
  registerQaRoutes(fastify, { snapshot })
  registerActionRoutes(fastify, { snapshot, sheets })
  registerPresetRoutes(fastify)

  // ── Serve the built SPA (production). In dev, Vite serves the client. ─────
  if (existsSync(config.clientDist)) {
    await fastify.register(fastifyStatic, { root: config.clientDist })
    fastify.setNotFoundHandler((req, reply) => {
      if (req.raw.url?.startsWith('/api/')) return reply.code(404).send({ error: 'not found' })
      return reply.sendFile('index.html') // SPA fallback
    })
  } else {
    fastify.setNotFoundHandler((req, reply) => {
      if (req.raw.url?.startsWith('/api/')) return reply.code(404).send({ error: 'not found' })
      return reply.code(200).type('text/html').send(devHint())
    })
  }

  snapshot.start()

  await fastify.listen({ port: config.port, host: config.host })
  fastify.log.info(`Localization Studio — mode=${config.mode}, writes=${config.enableWrites ? 'ON' : 'OFF'}`)
  if (config.mode === 'mock') {
    fastify.log.info('MOCK mode: serving fixtures. Add SHEET_ID + service account to .env for live (read-only) data.')
  }
}

function devHint() {
  return `<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:2rem;max-width:40rem">
  <h2>Localization Studio — server is up</h2>
  <p>The client isn't built yet. For development run <code>npm run dev</code> and open
  <a href="http://localhost:5173">http://localhost:5173</a>.</p>
  <p>For production run <code>npm run build</code> then <code>npm start</code>.</p>
  <p>API is live: <a href="/api/state">/api/state</a> · <a href="/api/setup/status">/api/setup/status</a></p>
  </body>`
}

main().catch((e) => {
  // Last-resort: never leave the user with a blank terminal.
  console.error('Fatal startup error:', e)
  process.exit(1)
})
