import { existsSync } from 'node:fs'
import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import { config } from './config.js'
import { DEFAULT_LANGS } from './constants.js'
import { makeAuth } from './google/auth.js'
import { makeSheetsClient } from './google/sheetsClient.js'
import { makeDriveClient } from './google/driveClient.js'
import { makeSnapshotService } from './services/snapshot.js'
import { makeProjectsService } from './services/projects.js'
import * as mockStore from './services/mockStore.js'
import { makeSse } from './sse.js'
import { registerReadRoutes } from './routes/read.js'
import { registerSettingsRoutes } from './routes/settings.js'
import { registerEventRoutes } from './routes/events.js'
import { registerAudioRoutes } from './routes/audio.js'
import { registerQaRoutes } from './routes/qa.js'
import { registerActionRoutes } from './routes/actions.js'
import { registerTuningRoutes } from './routes/tuning.js'
import { registerProjectRoutes } from './routes/projects.js'
import { registerPresetRoutes } from './routes/presets.js'
import { presets } from './services/presets.js'
import { SEED_COURSE_SETS } from './services/presetSeeds.js'

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
  const projects = makeProjectsService()
  bootstrapProjects(projects)
  bootstrapPresets()

  registerReadRoutes(fastify, { snapshot })
  registerSettingsRoutes(fastify, { snapshot })
  registerEventRoutes(fastify, { sse, snapshot })
  registerAudioRoutes(fastify, { snapshot, drive })
  registerQaRoutes(fastify, { snapshot })
  registerActionRoutes(fastify, { snapshot, sheets })
  registerTuningRoutes(fastify, { snapshot })
  registerProjectRoutes(fastify, { snapshot, projects, reconcile: () => reconcileMockProjects(projects) })
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

// Sanitize a project's mock lesson_id (segment_id prefix) to a slug.
function slugLesson(p) {
  const base = String(p.sourceFileName || '').replace(/\.\w+$/, '') || p.name || p.id
  let v = base.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return v || p.id
}

const MOCK_DEMOS = [
  { template: 'sleep_002', name: 'Sleep Meditation 02', file: 'sleep_002.wav', stage: null, status: 'new' },
  { template: 'morning_light', name: 'Morning Light', file: 'morning_light.wav', stage: 'audio_review', status: 'review' },
  { template: 'body_scan', name: 'Body Scan', file: 'body_scan.wav', stage: 'done', status: 'done' },
  { template: 'large_demo', name: 'Large Demo · 105 сегм.', file: 'large_demo.wav', stage: 'audio_review', status: 'review' },
]

// Idempotently ensure every built-in demo exists in the index AND the in-memory
// mock registry is seeded for every persisted project. Preserves the active
// pointer, so it's safe to call repeatedly — including on each project-list fetch
// (self-heal: a deleted/missing demo reappears without a server restart). Keyed by
// templateId (unique per demo; user projects have templateId=null → never match),
// so the operator's own projects are never touched. Mock-only.
function reconcileMockProjects(projects) {
  if (config.mode !== 'mock') return
  const prevActive = projects.getActive()?.id || null

  // 1. Each built-in demo is AUTHORITATIVE: ensure its index record exists, its mock
  //    dataset exists, and it sits at its intended stage. Re-seed when the mock
  //    run-state is empty/idle (after a restart, or if the stored status drifted to
  //    'new' — which would otherwise leave the demo stuck idle with 0 segments).
  for (const d of MOCK_DEMOS) {
    let rec = projects.list().find((x) => x.templateId === d.template)
    if (!rec) {
      const meta = mockStore.datasetMeta(d.template)
      const segCount = d.stage ? meta.segCount : 0
      const count = d.stage ? meta.attentionTrue : 0
      const total = d.stage ? meta.segCount * meta.langCount : 0
      projects.create({
        name: d.name, sourceFileName: d.file, templateId: d.template, langs: DEFAULT_LANGS, status: d.status,
        summary: {
          segCount, langCount: DEFAULT_LANGS.length, langs: [...DEFAULT_LANGS],
          needsAttention: { count, total, pct: total ? Math.round((count / total) * 100) : 0 },
        },
      })
      rec = projects.list().find((x) => x.templateId === d.template)
    }
    if (!rec) continue
    if (!mockStore.hasProject(rec.id)) {
      mockStore.createProject(rec.id, { templateId: d.template, lessonId: slugLesson(rec), langs: rec.summary?.langs })
    }
    if (d.stage && mockStore.liveState(rec.id) === 'IDLE') {
      mockStore.seedAtStage(rec.id, d.stage) // 'audio_review' | 'done'
    }
  }

  // 2. Re-seed the mock registry for any OTHER persisted (user) project missing from
  //    it — projects.json survives a restart, the in-memory mock run-state does not.
  for (const p of projects.list()) {
    if (mockStore.hasProject(p.id)) continue
    mockStore.createProject(p.id, { templateId: p.templateId, lessonId: slugLesson(p), langs: p.summary?.langs })
    if (p.status === 'done') mockStore.seedAtStage(p.id, 'done')
    else if (p.status === 'review') mockStore.seedAtStage(p.id, 'audio_review')
  }

  // Restore the active pointer (creating demos above may have moved it).
  if (prevActive && projects.get(prevActive)) projects.setActive(prevActive)
}

// Boot-time reconcile + pick a valid active project (and sync the mock store).
function bootstrapProjects(projects) {
  if (config.mode !== 'mock') return
  reconcileMockProjects(projects)
  const act = projects.getActive()?.id || projects.list()[0]?.id
  if (act) {
    projects.setActive(act)
    mockStore.setActiveProject(act)
  }
}

// Mock-only: seed example "by course" voice sets so the Voices window isn't empty.
// Only when the library has no sets yet — never resurrect ones the operator deleted.
function bootstrapPresets() {
  if (config.mode !== 'mock') return
  if (presets.all().sets.length > 0) return
  // addSet prepends; add in reverse so the list reads in declared order.
  for (const s of [...SEED_COURSE_SETS].reverse()) presets.addSet(s)
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
