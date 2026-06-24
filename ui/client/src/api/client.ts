export async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { Accept: 'application/json' } })
  if (!res.ok) {
    let detail = ''
    try { detail = (await res.json())?.error ?? '' } catch { /* ignore */ }
    throw new Error(`${res.status} ${path}${detail ? `: ${detail}` : ''}`)
  }
  return res.json() as Promise<T>
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    let detail = ''
    try { detail = JSON.stringify(await res.json()) } catch { /* ignore */ }
    throw new Error(`${res.status} ${path}${detail ? `: ${detail}` : ''}`)
  }
  return res.json() as Promise<T>
}
