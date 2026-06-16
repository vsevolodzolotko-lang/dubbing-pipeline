// Minimal Server-Sent Events hub. One channel, named events. The snapshot is
// authoritative — on reconnect the client just gets a fresh `state`, so no
// event log/replay is needed.

export function makeSse() {
  const clients = new Set()

  function addClient(reply, getInitialState) {
    const res = reply.raw
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    res.write('retry: 3000\n\n')
    const client = { res }
    clients.add(client)

    // Send current state immediately so a fresh tab paints without waiting.
    try {
      const initial = getInitialState?.()
      if (initial) send(client, 'state', initial)
    } catch { /* ignore */ }

    const heartbeat = setInterval(() => {
      try { res.write(': heartbeat\n\n') } catch { /* closed */ }
    }, 15_000)

    const cleanup = () => {
      clearInterval(heartbeat)
      clients.delete(client)
    }
    reply.raw.on('close', cleanup)
    reply.raw.on('error', cleanup)
  }

  function send(client, event, data) {
    client.res.write(`event: ${event}\n`)
    client.res.write(`data: ${JSON.stringify(data)}\n\n`)
  }

  function broadcast(event, data) {
    for (const client of clients) {
      try { send(client, event, data) } catch { clients.delete(client) }
    }
  }

  return { addClient, broadcast, getClientCount: () => clients.size }
}
