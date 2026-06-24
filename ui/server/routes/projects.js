import { config, writesEnabled } from '../config.js'
import { withWriteLock, startStagedRun } from '../services/writes.js'
import * as mockStore from '../services/mockStore.js'

/**
 * Project registry routes — list / open / create projects (the "sheet-per-project"
 * navigation layer). The heavy work stays behind the existing mock/live seams:
 * in mock, creating a project seeds a dataset and starts the staged run; in live
 * (Фаза 6) it will copy a template sheet + Drive folder tree and fire W1.
 *
 * The global localhost-only onRequest hook (index.js) already guards these POSTs.
 */
export function registerProjectRoutes(fastify, { snapshot, projects, reconcile }) {
  // Switching the active project (open) and creating a new one are always allowed
  // when writes are on: each project's state is fully isolated and persisted in its
  // own dataset, so neither operation can lose or corrupt another project's run.
  // (Deliberately NOT gated on START_STATES as the spec's first draft suggested —
  // that would trap the operator at any review gate, and permanently after a mock
  // regen, defeating the "return to any project" purpose. In live, n8n runs
  // independently of which project the UI shows; in mock, a non-active project's
  // wall-clock simply pauses and resumes when reopened.)
  function canMutate(reply) {
    if (!writesEnabled) { reply.code(403).send({ error: 'Записи вимкнені (ENABLE_WRITES=false)' }); return false }
    if (config.mode === 'live' && !snapshot.sheets) { reply.code(409).send({ error: 'Live-режим без доступу до Sheets' }); return false }
    return true
  }

  fastify.get('/api/projects', async () => {
    reconcile?.() // self-heal: re-add any missing built-in demo (mock; no-op when all present)
    // `liveState` is the real-time run state of EACH project (mock: derived from its
    // in-memory stage; live/Фаза 6: per-sheet — null for now). The dashboard groups
    // by it so background-advancing projects show their true state, not a stale one.
    return {
      rows: projects.list().map((p) => ({
        ...p,
        liveState: config.mode === 'mock' ? mockStore.liveState(p.id) : null,
      })),
      activeId: projects.getActive()?.id ?? null,
    }
  })

  fastify.get('/api/projects/:id', async (req, reply) => {
    const p = projects.get(req.params.id)
    if (!p) return reply.code(404).send({ error: 'проєкт не знайдено' })
    return p
  })

  // New project: create the index record, seed/switch the dataset, then start the
  // staged run on it. (Etap M: mock seed. Etap P: upload file to the project's
  // input folder + fire W1 with the project's spreadsheetId/folder IDs.)
  fastify.post('/api/projects', async (req, reply) => {
    if (!canMutate(reply)) return
    const name = String(req.body?.name || '').trim()
    const sourceFileName = String(req.body?.sourceFileName || '').trim()
    const langs = Array.isArray(req.body?.langs) ? req.body.langs.map(String).filter(Boolean) : []
    if (!name) return reply.code(400).send({ error: 'потрібна назва проєкту' })

    try {
      // 1. index record (becomes active). New projects clone the default template.
      const rec = projects.create({ name, sourceFileName, templateId: null, langs })
      // 2. seed the mock dataset for this id + point the store at it
      mockStore.createProject(rec.id, { templateId: rec.templateId, lessonId: name, langs })
      mockStore.setActiveProject(rec.id)
      // 3. start the staged run on the now-active project (LIVE-TODO: upload + W1)
      const res = await withWriteLock(() => startStagedRun(snapshot.sheets, Date.now(), name, langs))
      if (!res.ok) return reply.code(409).send(res)
      // 4. reset caches + re-poll (awaited) so SSE pushes the new project's state
      //    and the freshly-derived model is available for the summary
      await snapshot.onActiveChange()
      projects.updateSummary(rec.id, snapshot.get())
      return { ok: true, project: projects.get(rec.id), run: res }
    } catch (e) { return reply.code(502).send({ error: e.message }) }
  })

  // Open/switch a project: make it active. A finished (done) project is re-armed to
  // the audio-review gate so its per-segment review screens are available again.
  fastify.post('/api/projects/:id/open', async (req, reply) => {
    reconcile?.() // ensure built-in demos are seeded at their intended stage (self-heal)
    const p = projects.get(req.params.id)
    if (!p) return reply.code(404).send({ error: 'проєкт не знайдено' })
    if (!canMutate(reply)) return

    // Mock state doesn't survive a restart even though the index record does —
    // re-seed the dataset (and restore its stage) if the store doesn't have it.
    if (!mockStore.hasProject(p.id)) {
      mockStore.createProject(p.id, { templateId: p.templateId, lessonId: p.name, langs: p.summary?.langs })
      if (p.status === 'done') mockStore.seedAtStage(p.id, 'done')
      else if (p.status === 'review') mockStore.seedAtStage(p.id, 'audio_review')
    }

    projects.setActive(p.id)
    mockStore.setActiveProject(p.id)
    if (p.status === 'done') mockStore.rearmAudioReview()

    await snapshot.onActiveChange() // reset caches + awaited re-poll → SSE + fresh model
    projects.updateSummary(p.id, snapshot.get())
    return { ok: true, project: projects.get(p.id) }
  })
}
