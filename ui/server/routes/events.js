/** SSE endpoint. Takes over the raw response; Fastify must not serialize it. */
export function registerEventRoutes(fastify, { sse, snapshot }) {
  fastify.get('/api/events', (req, reply) => {
    sse.addClient(reply, () => snapshot.statePayload())
    // do not return — the reply stays open and is managed by the SSE hub
  })
}
