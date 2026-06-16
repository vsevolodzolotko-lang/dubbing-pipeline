import { config } from '../config.js'
import { RUN_STATES, EDITABLE_CONFIG_KEYS } from '../constants.js'
import { withWriteLock, writeLocalizationCells, writeConfigCell, writeVoiceCells } from '../services/writes.js'
import { wrapWav } from '../services/mockAudio.js'
import { regenTracker } from '../services/regenTracker.js'

const numOr = (v, d) => (v === '' || v == null || isNaN(Number(v)) ? d : Number(v))

// API keys we can cheaply validate with a GET. Value read server-side only.
const KEY_CHECKS = {
  anthropic_api_key: (k) => ({ url: 'https://api.anthropic.com/v1/models', headers: { 'x-api-key': k, 'anthropic-version': '2023-06-01' } }),
  gemini_api_key: (k) => ({ url: 'https://generativelanguage.googleapis.com/v1beta/openai/models', headers: { Authorization: `Bearer ${k}` } }),
  elevenlabs_api_key: (k) => ({ url: 'https://api.elevenlabs.io/v1/user', headers: { 'xi-api-key': k } }),
  deepgram_api_key: (k) => ({ url: 'https://api.deepgram.com/v1/projects', headers: { Authorization: `Token ${k}` } }),
  openai_api_key: (k) => ({ url: 'https://api.openai.com/v1/models', headers: { Authorization: `Bearer ${k}` } }),
}

// Writes are allowed only when the pipeline is idle-ish (never mid-run/regen),
// mirroring the integration contract. UNKNOWN is treated as unsafe.
const IDLE_OK = new Set([RUN_STATES.IDLE, RUN_STATES.COMPLETE, RUN_STATES.STOPPED])

let regenInFlight = false
let regenCooldownUntil = 0

export function registerActionRoutes(fastify, { snapshot, sheets }) {
  function guard(reply) {
    if (!config.enableWrites) { reply.code(403).send({ error: 'Записи вимкнені (ENABLE_WRITES=false)' }); return false }
    if (config.mode !== 'live' || !sheets) { reply.code(409).send({ error: 'Записи доступні лише в live-режимі' }); return false }
    const st = snapshot.get().state.state
    if (!IDLE_OK.has(st)) { reply.code(409).send({ error: `Заблоковано: зараз ${st} (запис лише коли ран завершено)` }); return false }
    return true
  }

  // Accept/Reject a cell verdict: needs_attention = TRUE | FALSE
  fastify.post('/api/attention', async (req, reply) => {
    if (!guard(reply)) return
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : []
    const targets = rows
      .filter((r) => r.rowKey && (r.value === 'TRUE' || r.value === 'FALSE'))
      .map((r) => ({ rowKey: r.rowKey, col: 'needs_attention', value: r.value }))
    if (!targets.length) return reply.code(400).send({ error: 'немає рядків' })
    try {
      const res = await withWriteLock(() => writeLocalizationCells(sheets, targets))
      return { ok: true, ...res }
    } catch (e) { return reply.code(502).send({ error: e.message }) }
  })

  // Edit text / comment WITHOUT triggering regen (record-keeping, operator §5)
  fastify.post('/api/text', async (req, reply) => {
    if (!guard(reply)) return
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : []
    const targets = []
    for (const r of rows) {
      if (!r.rowKey) continue
      if (typeof r.textTranslated === 'string') targets.push({ rowKey: r.rowKey, col: 'text_translated', value: r.textTranslated })
      if (typeof r.regenComment === 'string') targets.push({ rowKey: r.rowKey, col: 'regen_comment', value: r.regenComment })
    }
    if (!targets.length) return reply.code(400).send({ error: 'немає правок' })
    try {
      const res = await withWriteLock(() => writeLocalizationCells(sheets, targets))
      return { ok: true, ...res }
    } catch (e) { return reply.code(502).send({ error: e.message }) }
  })

  // The cart: write text edits + needs_retts=TRUE for ALL rows FIRST, then (only
  // after Sheets confirms) GET the W_Regen webhook. Single-flight + cooldown.
  fastify.post('/api/regen', async (req, reply) => {
    if (!guard(reply)) return
    if (regenInFlight || Date.now() < regenCooldownUntil) {
      return reply.code(409).send({ error: 'Перегенерація вже виконується' })
    }
    const rows = (Array.isArray(req.body?.rows) ? req.body.rows : []).filter((r) => r.rowKey)
    if (!rows.length) return reply.code(400).send({ error: 'немає рядків' })

    const targets = []
    for (const r of rows) {
      targets.push({ rowKey: r.rowKey, col: 'needs_retts', value: 'TRUE' })
      if (typeof r.textTranslated === 'string' && r.textTranslated.trim()) {
        targets.push({ rowKey: r.rowKey, col: 'text_translated', value: r.textTranslated })
      }
      if (typeof r.regenComment === 'string' && r.regenComment) {
        targets.push({ rowKey: r.rowKey, col: 'regen_comment', value: r.regenComment })
      }
    }

    regenInFlight = true
    try {
      // (1) flags + edits in ONE batch — confirmed before any webhook
      await withWriteLock(() => writeLocalizationCells(sheets, targets))
      // track the in-flight set (for status banner + done/stale watchdog)
      regenTracker.start(rows.map((r) => r.rowKey))
      // (2) only now trigger the webhook
      const url = (snapshot.get().configMap.get('w_regen_workflow_url') || '').toString().trim()
      if (!url) {
        return reply.send({ ok: true, flagsWritten: true, fired: false, count: rows.length, warn: 'w_regen_workflow_url відсутній — прапорці виставлені, запусти W_Regen вручну' })
      }
      try {
        const wres = await fetch(url, { method: 'GET' })
        regenCooldownUntil = Date.now() + 8000
        return { ok: true, flagsWritten: true, fired: true, status: wres.status, count: rows.length }
      } catch (e) {
        return reply.code(502).send({ ok: false, flagsWritten: true, fired: false, error: `Вебхук не спрацював: ${e.message}` })
      }
    } catch (e) {
      return reply.code(502).send({ ok: false, flagsWritten: false, error: e.message })
    } finally {
      regenInFlight = false
    }
  })

  // Edit a config value (yellow zone). Update-only, compare-and-set, allowlist.
  fastify.put('/api/config/:key', async (req, reply) => {
    if (!guard(reply)) return
    const key = req.params.key
    if (!EDITABLE_CONFIG_KEYS.has(key)) return reply.code(403).send({ error: `ключ "${key}" не редагується через UI` })
    const value = req.body?.value
    const expected = req.body?.expected
    if (typeof value !== 'string') return reply.code(400).send({ error: 'value має бути рядком' })
    try {
      const res = await withWriteLock(() => writeConfigCell(sheets, key, value, expected))
      return { ok: true, ...res }
    } catch (e) {
      if (e.code === 'CONFLICT') return reply.code(409).send({ error: e.message })
      return reply.code(502).send({ error: e.message })
    }
  })

  // Validate an API key with a minimal GET (read-only — no enableWrites needed).
  fastify.post('/api/config/check/:key', async (req, reply) => {
    if (config.mode !== 'live') return reply.code(409).send({ error: 'перевірка ключів лише в live-режимі' })
    const key = req.params.key
    const make = KEY_CHECKS[key]
    if (!make) return reply.code(400).send({ error: 'для цього ключа немає перевірки' })
    const val = (snapshot.get().configMap.get(key) || '').toString().trim()
    if (!val) return reply.send({ ok: false, reason: 'ключ порожній' })
    try {
      const { url, headers } = make(val)
      const res = await fetch(url, { headers })
      return { ok: res.ok, status: res.status }
    } catch (e) { return reply.send({ ok: false, reason: e.message }) }
  })

  // Edit voice fields for one lang.
  fastify.put('/api/voices/:lang', async (req, reply) => {
    if (!guard(reply)) return
    const lang = req.params.lang
    const fields = req.body?.fields
    if (!fields || typeof fields !== 'object') return reply.code(400).send({ error: 'немає полів' })
    try {
      const res = await withWriteLock(() => writeVoiceCells(sheets, lang, fields))
      return { ok: true, ...res }
    } catch (e) { return reply.code(502).send({ error: e.message }) }
  })

  // Test synthesis: same ElevenLabs call as the pipeline (pcm_44100 + voice_settings),
  // wrapped into a playable WAV. Read-only w.r.t. the pipeline (no sheet write) — so it
  // works regardless of ENABLE_WRITES, but it DOES spend ElevenLabs credits.
  fastify.post('/api/voices/test', async (req, reply) => {
    if (config.mode !== 'live') return reply.code(409).send({ error: 'тест-синтез лише в live-режимі' })
    const apiKey = (snapshot.get().configMap.get('elevenlabs_api_key') || '').toString().trim()
    if (!apiKey) return reply.code(400).send({ error: 'elevenlabs_api_key відсутній у config' })
    const b = req.body || {}
    const text = String(b.text || '').slice(0, 800)
    if (!text.trim()) return reply.code(400).send({ error: 'порожній текст' })
    if (!b.voiceId) return reply.code(400).send({ error: 'немає voice_id' })
    const settings = {
      stability: numOr(b.stability, 0.5),
      similarity_boost: numOr(b.similarityBoost, 0.75),
      style: numOr(b.style, 0),
      speed: numOr(b.speed, 1.0),
    }
    try {
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${b.voiceId}?output_format=pcm_44100`, {
        method: 'POST',
        headers: { 'xi-api-key': apiKey, 'content-type': 'application/json', accept: 'audio/pcm' },
        body: JSON.stringify({ text, model_id: b.modelId || 'eleven_multilingual_v2', voice_settings: settings }),
      })
      if (!res.ok) {
        const t = await res.text().catch(() => '')
        return reply.code(502).send({ error: `ElevenLabs ${res.status}: ${t.slice(0, 200)}` })
      }
      const pcm = Buffer.from(await res.arrayBuffer())
      const wav = wrapWav(pcm, 44100, 1, 16)
      reply.header('Content-Type', 'audio/wav')
      reply.header('Content-Length', wav.length)
      return reply.send(wav)
    } catch (e) { return reply.code(502).send({ error: e.message }) }
  })

  // Apply a saved voice SET to the voices tab in one batch (each lang's fields).
  fastify.post('/api/voices/apply-set', async (req, reply) => {
    if (!guard(reply)) return
    const voices = Array.isArray(req.body?.voices) ? req.body.voices : []
    if (!voices.length) return reply.code(400).send({ error: 'порожній набір' })
    try {
      const out = await withWriteLock(async () => {
        const res = []
        for (const v of voices) {
          if (!v?.lang || !v?.fields) continue
          res.push(await writeVoiceCells(sheets, v.lang, v.fields))
        }
        return res
      })
      return { ok: true, applied: out.length }
    } catch (e) { return reply.code(502).send({ error: e.message }) }
  })

  // Current regen status (for initial load; live updates come via SSE `regen`).
  fastify.get('/api/regen/status', async () => regenTracker.get(snapshot.get().localizations))

  // Re-fire ONLY the webhook (flags already written) — recovery path.
  fastify.post('/api/regen/retrigger', async (req, reply) => {
    if (!guard(reply)) return
    const url = (snapshot.get().configMap.get('w_regen_workflow_url') || '').toString().trim()
    if (!url) return reply.code(400).send({ error: 'w_regen_workflow_url відсутній' })
    try {
      const wres = await fetch(url, { method: 'GET' })
      regenCooldownUntil = Date.now() + 8000
      return { ok: true, fired: true, status: wres.status }
    } catch (e) { return reply.code(502).send({ error: e.message }) }
  })
}
