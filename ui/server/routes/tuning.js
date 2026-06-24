import fs from 'node:fs'
import path from 'node:path'
import { config } from '../config.js'
import { RUN_STATES } from '../constants.js'
import { buildRunQualityReport } from '../services/qualityReport.js'
import { qualityStore } from '../services/qualityStore.js'
import { runAdvisor } from '../services/qualityAdvisor.js'

// Tuning (text-quality intelligence) endpoints. GETs mirror routes/read.js (served
// from the in-memory snapshot, instant). POST /advise streams NDJSON like
// routes/qa.js because the Opus advisor call takes seconds. Read-only w.r.t. the
// pipeline — applying a recommendation goes through the existing config/voice/
// prompt write endpoints, not here.
const QA_REPORT_PATH = path.join(config.cacheDir, 'qa', 'last.json')
function loadQa() { try { return JSON.parse(fs.readFileSync(QA_REPORT_PATH, 'utf8')) } catch { return null } }

export function registerTuningRoutes(fastify, { snapshot }) {
  let advising = false
  let lastAdvice = qualityStore.loadAdvice()

  // Live-recompute the current run's report (any state). `?run=<id>` reads an
  // archived report from the history store instead. Captures when COMPLETE so the
  // trend list fills even without going through render.
  fastify.get('/api/tuning/report', async (req, reply) => {
    const runId = req.query?.run ? String(req.query.run) : null
    if (runId) {
      const r = qualityStore.get(runId)
      if (!r) return reply.code(404).send({ error: 'звіт не знайдено' })
      return r
    }
    const report = buildRunQualityReport(snapshot.get(), { qaReport: loadQa() })
    if (snapshot.get().state?.state === RUN_STATES.COMPLETE && report.runToken) {
      try { qualityStore.capture(report) } catch { /* non-fatal */ }
    }
    return report
  })

  fastify.get('/api/tuning/runs', async () => ({ rows: qualityStore.list() }))

  fastify.get('/api/tuning/runs/:id', async (req, reply) => {
    const r = qualityStore.get(req.params.id)
    if (!r) return reply.code(404).send({ error: 'звіт не знайдено' })
    return r
  })

  fastify.get('/api/tuning/trend', async (req) => {
    const metric = String(req.query?.metric || 'score')
    const lessonId = req.query?.lessonId ? String(req.query.lessonId) : null
    return qualityStore.trend(metric, { lessonId })
  })

  fastify.get('/api/tuning/advice', async () =>
    lastAdvice || { schema: 1, generatedAt: null, model: null, configRecommendations: [], voiceRecommendations: [], promptRecommendations: [] })

  // Generate recommendations. Streams NDJSON progress, then the final set. Single-
  // flight; caches the last result (served by GET /advice). Live + missing key → error line.
  fastify.post('/api/tuning/advise', async (req, reply) => {
    if (advising) return reply.code(409).send({ error: 'аналіз уже виконується' })
    advising = true
    reply.hijack()
    const res = reply.raw
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache' })
    const write = (o) => { try { res.write(JSON.stringify(o) + '\n') } catch { /* client gone */ } }
    try {
      const model = typeof req.body?.model === 'string' ? req.body.model : undefined
      write({ type: 'progress', phase: 'metrics' })
      const report = buildRunQualityReport(snapshot.get(), { qaReport: loadQa() })
      write({ type: 'progress', phase: 'advise' })
      const set = await runAdvisor({ snapshot, report, model })
      lastAdvice = set
      qualityStore.saveAdvice(set)
      try { qualityStore.capture(report) } catch { /* non-fatal */ }
      write({ type: 'done', report, recommendations: set })
    } catch (e) {
      req.log?.error?.(e)
      write({ type: 'error', message: e.message })
    } finally {
      advising = false
      res.end()
    }
  })

  // Backfill the history store from Drive 05_archive snapshots — later phase
  // (snapshot JSON shape unverified; capture-on-render covers the common path).
  fastify.post('/api/tuning/backfill', async (req, reply) => {
    if (config.mode === 'mock') return reply.code(409).send({ error: 'Drive-бекфіл недоступний у mock' })
    return reply.code(501).send({ error: 'бекфіл історії з Drive 05_archive — пізніша фаза' })
  })
}
