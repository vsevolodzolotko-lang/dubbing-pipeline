import fs from 'node:fs'
import path from 'node:path'
import { config, writesEnabled } from '../config.js'
import { runAnalysis } from '../services/qaGemini.js'
import { checkTranslations } from '../services/qaCheck.js'
import { getAiPrompt, getDefaultAiPrompt, setAiPrompt } from '../services/mockStore.js'

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

  // "Перевірити AI" — batch LLM check of the SELECTED segments for ONE language.
  // Returns a per-segment JSON verdict { ok, comment, suggestion }.
  fastify.post('/api/translation-check', async (req) => {
    const lang = String(req.body?.lang || '').trim()
    const segmentIds = Array.isArray(req.body?.segmentIds) ? req.body.segmentIds : null
    if (!lang) return { lang: '', results: [], count: 0 }
    return checkTranslations({ snapshot, lang, segmentIds })
  })

  // Editable prompt that drives the AI translation check (LLM lane). Etap M:
  // mock store; Etap P: a `prompts` tab key. `{{lang}}` is substituted per language.
  fastify.get('/api/translation-prompt', async () => ({
    value: getAiPrompt(),
    default: getDefaultAiPrompt(),
    editable: config.mode === 'mock',
  }))

  fastify.post('/api/translation-prompt', async (req, reply) => {
    if (!writesEnabled) return reply.code(403).send({ error: 'Записи вимкнені' })
    if (config.mode !== 'mock') return reply.code(409).send({ error: 'Збереження промпту в live — Етап P (prompts-таб)' })
    const value = req.body?.value
    if (typeof value !== 'string' || !value.trim()) return reply.code(400).send({ error: 'порожній промпт' })
    setAiPrompt(value)
    return { ok: true }
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
