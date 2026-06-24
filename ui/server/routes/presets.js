import { presets } from '../services/presets.js'

// Local voice-preset library CRUD. Pure local JSON store — no Google, no
// ENABLE_WRITES gate (saving a preset can't touch the pipeline). Applying a set
// TO the sheet is the gated write, and lives in routes/actions.js.
export function registerPresetRoutes(fastify) {
  fastify.get('/api/presets', async () => presets.all())

  fastify.post('/api/presets/voice', async (req, reply) => {
    const b = req.body || {}
    if (!b.voice_id) return reply.code(400).send({ error: 'потрібен voice_id' })
    return presets.addVoice(b)
  })

  fastify.post('/api/presets/set', async (req, reply) => {
    const b = req.body || {}
    if (!Array.isArray(b.voices) || !b.voices.length) return reply.code(400).send({ error: 'порожній набір' })
    return presets.addSet(b)
  })

  fastify.delete('/api/presets/voice/:id', async (req) => presets.removeVoice(req.params.id))
  fastify.delete('/api/presets/set/:id', async (req) => presets.removeSet(req.params.id))
}
