import { config, writesEnabled } from '../config.js'
import {
  RUN_STATES, EDITABLE_CONFIG_KEYS, PIPELINE_STAGES,
  LOCALIZATION_WRITE_STATES, TRANSCRIPT_WRITE_STATES, TRANSLATION_WRITE_STATES,
  TRANSCRIPT_WRITABLE_COLS, TRANSLATION_WRITABLE_COLS, RENDER_STATES, RETIME_WRITE_STATES,
} from '../constants.js'
import {
  withWriteLock, writeLocalizationCells, writeConfigCell, writeVoiceCells,
  writeSegmentCells, mergeSegments, splitSegment, retimeSegment, normalizeSegments, approveStage, startStagedRun, applyArchiveSettings, startRender,
} from '../services/writes.js'
import { wrapWav } from '../services/mockAudio.js'
import { regenTracker } from '../services/regenTracker.js'
import * as mockStore from '../services/mockStore.js'
import { archive } from '../services/archive.js'

const numOr = (v, d) => (v === '' || v == null || isNaN(Number(v)) ? d : Number(v))

// Map an approval gate path → the pipeline_stage it approves + the run state it
// must be in to be approvable.
const APPROVE_GATES = {
  transcript: { stage: PIPELINE_STAGES.STT, states: TRANSCRIPT_WRITE_STATES },
  translations: { stage: PIPELINE_STAGES.TRANSLATE, states: TRANSLATION_WRITE_STATES },
  audio: { stage: PIPELINE_STAGES.SYNTH, states: LOCALIZATION_WRITE_STATES },
}

// States from which a new staged run may be started (nothing in flight).
const START_STATES = new Set([RUN_STATES.IDLE, RUN_STATES.COMPLETE, RUN_STATES.STOPPED])

// API keys we can cheaply validate with a GET. Value read server-side only.
const KEY_CHECKS = {
  anthropic_api_key: (k) => ({ url: 'https://api.anthropic.com/v1/models', headers: { 'x-api-key': k, 'anthropic-version': '2023-06-01' } }),
  gemini_api_key: (k) => ({ url: 'https://generativelanguage.googleapis.com/v1beta/openai/models', headers: { Authorization: `Bearer ${k}` } }),
  elevenlabs_api_key: (k) => ({ url: 'https://api.elevenlabs.io/v1/user', headers: { 'xi-api-key': k } }),
  deepgram_api_key: (k) => ({ url: 'https://api.deepgram.com/v1/projects', headers: { Authorization: `Token ${k}` } }),
  openai_api_key: (k) => ({ url: 'https://api.openai.com/v1/models', headers: { Authorization: `Bearer ${k}` } }),
}

let regenInFlight = false
let regenCooldownUntil = 0

export function registerActionRoutes(fastify, { snapshot, sheets }) {
  // Stage-aware write guard: each route passes the set of run states in which it
  // is allowed (transcript edits only in TRANSCRIPT_REVIEW, etc). Mock mode is a
  // valid write target (the stateful mock store); live needs Sheets.
  function guard(reply, allowed) {
    if (!writesEnabled) { reply.code(403).send({ error: 'Записи вимкнені (ENABLE_WRITES=false)' }); return false }
    if (config.mode === 'live' && !sheets) { reply.code(409).send({ error: 'Live-режим без доступу до Sheets' }); return false }
    const st = snapshot.get().state.state
    if (!allowed.has(st)) { reply.code(409).send({ error: `Заблоковано: зараз ${st} (запис недоступний на цьому етапі)` }); return false }
    return true
  }

  // Accept/Reject a cell verdict: needs_attention = TRUE | FALSE
  fastify.post('/api/attention', async (req, reply) => {
    if (!guard(reply, LOCALIZATION_WRITE_STATES)) return
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : []
    const targets = rows
      .filter((r) => r.rowKey && (r.value === 'TRUE' || r.value === 'FALSE'))
      .map((r) => ({ rowKey: r.rowKey, col: 'needs_attention', value: r.value }))
    if (!targets.length) return reply.code(400).send({ error: 'немає рядків' })
    try {
      const res = await withWriteLock(() => writeLocalizationCells(sheets, targets))
      snapshot.refresh()
      return { ok: true, ...res }
    } catch (e) { return reply.code(502).send({ error: e.message }) }
  })

  // Edit text / comment WITHOUT triggering regen (record-keeping, operator §5)
  fastify.post('/api/text', async (req, reply) => {
    if (!guard(reply, LOCALIZATION_WRITE_STATES)) return
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
      snapshot.refresh()
      return { ok: true, ...res }
    } catch (e) { return reply.code(502).send({ error: e.message }) }
  })

  // The cart: write text edits + needs_retts=TRUE for ALL rows FIRST, then (only
  // after Sheets confirms) GET the W_Regen webhook. Single-flight + cooldown.
  fastify.post('/api/regen', async (req, reply) => {
    if (!guard(reply, LOCALIZATION_WRITE_STATES)) return
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
    if (!guard(reply, LOCALIZATION_WRITE_STATES)) return
    const key = req.params.key
    if (!EDITABLE_CONFIG_KEYS.has(key)) return reply.code(403).send({ error: `ключ "${key}" не редагується через UI` })
    const value = req.body?.value
    const expected = req.body?.expected
    if (typeof value !== 'string') return reply.code(400).send({ error: 'value має бути рядком' })
    try {
      const res = await withWriteLock(() => writeConfigCell(sheets, key, value, expected))
      snapshot.refresh()
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
    if (!guard(reply, LOCALIZATION_WRITE_STATES)) return
    const lang = req.params.lang
    const fields = req.body?.fields
    if (!fields || typeof fields !== 'object') return reply.code(400).send({ error: 'немає полів' })
    try {
      const res = await withWriteLock(() => writeVoiceCells(sheets, lang, fields))
      snapshot.refresh()
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
    if (!guard(reply, LOCALIZATION_WRITE_STATES)) return
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
      snapshot.refresh()
      return { ok: true, applied: out.length }
    } catch (e) { return reply.code(502).send({ error: e.message }) }
  })

  // Current regen status (for initial load; live updates come via SSE `regen`).
  fastify.get('/api/regen/status', async () => regenTracker.get(snapshot.get().localizations))

  // Re-fire ONLY the webhook (flags already written) — recovery path.
  fastify.post('/api/regen/retrigger', async (req, reply) => {
    if (!guard(reply, LOCALIZATION_WRITE_STATES)) return
    const url = (snapshot.get().configMap.get('w_regen_workflow_url') || '').toString().trim()
    if (!url) return reply.code(400).send({ error: 'w_regen_workflow_url відсутній' })
    try {
      const wres = await fetch(url, { method: 'GET' })
      regenCooldownUntil = Date.now() + 8000
      return { ok: true, fired: true, status: wres.status }
    } catch (e) { return reply.code(502).send({ error: e.message }) }
  })

  // ─── staged pipeline (gated review) ────────────────────────────────────────

  // Start a staged run from the UI drop-in. (Etap M: mock; Etap P: upload to
  // drive_staged_input_folder_id + fire W1 webhook.) Refused if a run is active.
  fastify.post('/api/staged/start', async (req, reply) => {
    if (!guard(reply, START_STATES)) return
    const lessonId = String(req.body?.lessonId || '').trim() || null
    const langs = Array.isArray(req.body?.langs) ? req.body.langs.map(String) : null
    try {
      const res = await withWriteLock(() => startStagedRun(sheets, Date.now(), lessonId, langs))
      if (!res.ok) return reply.code(409).send(res)
      snapshot.refresh()
      return res
    } catch (e) { return reply.code(502).send({ error: e.message }) }
  })

  // Apply a past run's settings snapshot to live config/voices/prompt (start-from-archive).
  fastify.post('/api/archive/:id/apply', async (req, reply) => {
    if (!guard(reply, START_STATES)) return
    const rec = archive.get(req.params.id)
    if (!rec) return reply.code(404).send({ error: 'запис архіву не знайдено' })
    try {
      const res = await withWriteLock(() => applyArchiveSettings(sheets, rec.settings))
      if (!res.ok) return reply.code(400).send(res)
      snapshot.refresh()
      return res
    } catch (e) { return reply.code(502).send({ error: e.message }) }
  })

  // Run-lock probe — would a new drop be refused right now? (mock demo)
  fastify.post('/api/staged/second-drop', async (req, reply) => {
    if (config.mode !== 'mock') return reply.code(409).send({ error: 'демо доступне лише в mock' })
    return mockStore.secondDropProbe()
  })

  // Edit EN transcript (segments.en_text) — only during transcript review.
  fastify.post('/api/transcript', async (req, reply) => {
    if (!guard(reply, TRANSCRIPT_WRITE_STATES)) return
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : []
    const targets = rows
      .filter((r) => r.segmentId && typeof r.enText === 'string')
      .map((r) => ({ segmentId: r.segmentId, col: 'en_text', value: r.enText }))
    if (!targets.length) return reply.code(400).send({ error: 'немає правок' })
    try {
      const res = await withWriteLock(() => writeSegmentCells(sheets, targets, TRANSCRIPT_WRITABLE_COLS))
      snapshot.refresh()
      return { ok: true, ...res }
    } catch (e) { return reply.code(502).send({ error: e.message }) }
  })

  // Edit translations (segments.{lang}_text) — only during translation review.
  fastify.post('/api/translations', async (req, reply) => {
    if (!guard(reply, TRANSLATION_WRITE_STATES)) return
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : []
    const targets = []
    for (const r of rows) {
      if (!r.segmentId || !r.lang || typeof r.text !== 'string') continue
      targets.push({ segmentId: r.segmentId, col: `${r.lang}_text`, value: r.text })
    }
    if (!targets.length) return reply.code(400).send({ error: 'немає правок' })
    try {
      const res = await withWriteLock(() => writeSegmentCells(sheets, targets, TRANSLATION_WRITABLE_COLS))
      snapshot.refresh()
      return { ok: true, ...res }
    } catch (e) { return reply.code(502).send({ error: e.message }) }
  })

  // Merge a segment with the next one (transcript review only).
  fastify.post('/api/segments/merge', async (req, reply) => {
    if (!guard(reply, TRANSCRIPT_WRITE_STATES)) return
    const segmentId = String(req.body?.segmentId || '').trim()
    if (!segmentId) return reply.code(400).send({ error: 'немає segmentId' })
    try {
      const res = await withWriteLock(() => mergeSegments(sheets, segmentId))
      snapshot.refresh()
      return { ok: true, ...res }
    } catch (e) { return reply.code(400).send({ error: e.message }) }
  })

  // Split a segment at a word boundary (transcript review only).
  fastify.post('/api/segments/split', async (req, reply) => {
    if (!guard(reply, TRANSCRIPT_WRITE_STATES)) return
    const segmentId = String(req.body?.segmentId || '').trim()
    const wordIndex = req.body?.wordIndex
    if (!segmentId) return reply.code(400).send({ error: 'немає segmentId' })
    try {
      const res = await withWriteLock(() => splitSegment(sheets, segmentId, wordIndex))
      snapshot.refresh()
      return { ok: true, ...res }
    } catch (e) { return reply.code(400).send({ error: e.message }) }
  })

  // Retime a segment's EN slot — drag timeline edges under the video (transcript + audio gates).
  fastify.post('/api/segments/retime', async (req, reply) => {
    if (!guard(reply, RETIME_WRITE_STATES)) return
    const segmentId = String(req.body?.segmentId || '').trim()
    const enStart = Number(req.body?.enStart)
    const enEnd = Number(req.body?.enEnd)
    if (!segmentId || !isFinite(enStart) || !isFinite(enEnd)) return reply.code(400).send({ error: 'потрібні segmentId, enStart, enEnd' })
    try {
      const res = await withWriteLock(() => retimeSegment(sheets, segmentId, enStart, enEnd))
      if (!res.ok) return reply.code(409).send(res)
      snapshot.refresh()
      return res
    } catch (e) { return reply.code(400).send({ error: e.message }) }
  })

  // Loudness-normalize dub segments to a target LUFS (audio gate).
  fastify.post('/api/segments/normalize', async (req, reply) => {
    if (!guard(reply, LOCALIZATION_WRITE_STATES)) return
    const rowKeys = Array.isArray(req.body?.rowKeys) ? req.body.rowKeys.map(String).filter(Boolean) : []
    const targetLufs = req.body?.targetLufs == null ? -23 : Number(req.body.targetLufs)
    if (!rowKeys.length) return reply.code(400).send({ error: 'потрібні rowKeys' })
    try {
      const res = await withWriteLock(() => normalizeSegments(sheets, rowKeys, targetLufs))
      snapshot.refresh()
      return res
    } catch (e) { return reply.code(400).send({ error: e.message }) }
  })

  // Approve a review gate → advance the pipeline. Idempotent (409 if not in REVIEW).
  fastify.post('/api/approve/:gate', async (req, reply) => {
    const gate = APPROVE_GATES[req.params.gate]
    if (!gate) return reply.code(404).send({ error: 'невідомі ворота' })
    if (!guard(reply, gate.states)) return
    try {
      const res = await withWriteLock(() => approveStage(sheets, gate.stage, Date.now()))
      if (!res.ok) return reply.code(409).send(res)
      snapshot.refresh()
      return res
    } catch (e) { return reply.code(502).send({ error: e.message }) }
  })

  // Assemble-file step (separate stage after audio review). Plan = files + save
  // destination + presets; the build records the destination and stitches the
  // full per-lang files, then the lesson finishes (→ archived with destination).
  fastify.get('/api/render/plan', async (req, reply) => {
    if (config.mode !== 'mock') return reply.code(409).send({ error: 'склейка-план лише в mock (Етап P: Drive)' })
    return mockStore.renderPlan()
  })

  fastify.post('/api/render', async (req, reply) => {
    if (!guard(reply, RENDER_STATES)) return
    const destination = typeof req.body?.destination === 'string' ? req.body.destination : ''
    try {
      const res = await withWriteLock(() => startRender(sheets, Date.now(), destination))
      if (!res.ok) return reply.code(409).send(res)
      // The run is now final (only stitching remains) → snapshot it with destination.
      try { archive.capture(snapshot.get(), new Date().toISOString(), { destination: res.destination }) }
      catch (e) { req.log?.warn?.(e) }
      snapshot.refresh()
      return res
    } catch (e) { return reply.code(502).send({ error: e.message }) }
  })

  // Word-level timing for the split UI (Etap M: mock fixture; Etap P: Drive JSON).
  fastify.get('/api/segments/:segmentId/words', async (req, reply) => {
    if (config.mode !== 'mock') return reply.code(409).send({ error: 'words-фікстура лише в mock (Етап P: Drive JSON)' })
    const w = mockStore.words(req.params.segmentId)
    if (!w) return reply.code(404).send({ error: 'сегмент не знайдено' })
    return { segmentId: req.params.segmentId, words: w }
  })
}
