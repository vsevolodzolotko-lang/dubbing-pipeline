import { buildLessonMatrix, filterLocalizations } from '../services/derive.js'
import { maskConfigValue } from '../constants.js'
import { archive } from '../services/archive.js'

/** Read endpoints — all served instantly from the in-memory snapshot. */
export function registerReadRoutes(fastify, { snapshot }) {
  fastify.get('/api/state', async () => snapshot.statePayload())

  fastify.get('/api/lesson', async () => {
    const m = snapshot.get()
    return buildLessonMatrix(m)
  })

  fastify.get('/api/localizations', async (req) => {
    const m = snapshot.get()
    const filter = String(req.query?.filter || 'all')
    return { filter, rows: filterLocalizations(m.localizations, filter) }
  })

  fastify.get('/api/segments', async () => ({ rows: snapshot.get().segments }))

  fastify.get('/api/voices', async () => ({ rows: snapshot.get().voices }))

  fastify.get('/api/config', async () => {
    const m = snapshot.get()
    const rows = []
    for (const [key, value] of m.configMap.entries()) {
      const masked = maskConfigValue(key, value)
      rows.push({ key, value: masked.value, masked: masked.masked })
    }
    return { rows }
  })

  fastify.get('/api/prompts', async () => {
    const rows = snapshot.get().prompts.map((p) => ({
      key: p.key, description: p.description ?? '', length: String(p.value ?? '').length,
    }))
    return { rows }
  })

  fastify.get('/api/prompts/:key', async (req, reply) => {
    const p = snapshot.get().prompts.find((x) => x.key === req.params.key)
    if (!p) return reply.code(404).send({ error: 'prompt not found' })
    return { key: p.key, description: p.description ?? '', value: p.value ?? '' }
  })

  // Run archive — history of completed staged lessons + settings snapshots.
  fastify.get('/api/archive', async () => ({ rows: archive.list() }))

  fastify.get('/api/archive/:id', async (req, reply) => {
    const r = archive.get(req.params.id)
    if (!r) return reply.code(404).send({ error: 'запис не знайдено' })
    return r
  })
}
