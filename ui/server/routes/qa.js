import fs from 'node:fs'
import path from 'node:path'
import { config } from '../config.js'
import { runAnalysis } from '../services/qaGemini.js'

// AI quality check. POST streams NDJSON progress (one JSON object per line);
// GET returns the last report. Read-only w.r.t. the pipeline (only reads the
// sheet snapshot + calls Gemini), so it's allowed regardless of ENABLE_WRITES
// and even during an active run (translations are done before synthesis).
const REPORT_PATH = path.join(config.cacheDir, 'qa', 'last.json')

export function registerQaRoutes(fastify, { snapshot }) {
  let running = false
  let lastReport = loadLast()

  fastify.get('/api/qa/report', async () => lastReport || { findings: [], generatedAt: null, total: 0 })

  fastify.post('/api/qa/run', async (req, reply) => {
    if (running) return reply.code(409).send({ error: 'аналіз уже виконується' })
    running = true
    reply.hijack()
    const res = reply.raw
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache' })
    const write = (o) => { try { res.write(JSON.stringify(o) + '\n') } catch { /* client gone */ } }
    try {
      const langs = Array.isArray(req.body?.langs) ? req.body.langs : null
      const report = await runAnalysis({
        snapshot, langs,
        onProgress: (p) => write({ type: 'progress', ...p }),
      })
      lastReport = report
      saveLast(report)
      write({ type: 'done', report })
    } catch (e) {
      req.log?.error?.(e)
      write({ type: 'error', message: e.message })
    } finally {
      running = false
      res.end()
    }
  })
}

function loadLast() {
  try { return JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8')) } catch { return null }
}
function saveLast(report) {
  try {
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true })
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report))
  } catch { /* non-fatal */ }
}
