import { fetchJson } from './client'
import type { RunQualityReport, RecommendationSet, TuningRunSummary, TuningTrend } from './types'

export const getTuningReport = (runId?: string) =>
  fetchJson<RunQualityReport>(`/api/tuning/report${runId ? `?run=${encodeURIComponent(runId)}` : ''}`)

export const listTuningRuns = () => fetchJson<{ rows: TuningRunSummary[] }>('/api/tuning/runs')

export const getTuningTrend = (metric: string, lessonId?: string) =>
  fetchJson<TuningTrend>(`/api/tuning/trend?metric=${encodeURIComponent(metric)}${lessonId ? `&lessonId=${encodeURIComponent(lessonId)}` : ''}`)

export const getTuningAdvice = () => fetchJson<RecommendationSet>('/api/tuning/advice')

export interface AdviseProgress { phase: string }

// Stream the advisor (NDJSON), surfacing progress then the final recommendation
// set. Mirrors the reader loop in Qa.tsx. Returns the RecommendationSet or throws.
export async function runAdvise(
  opts: { model?: string; onProgress?: (p: AdviseProgress) => void } = {},
): Promise<RecommendationSet> {
  const res = await fetch('/api/tuning/advise', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: opts.model }),
  })
  if (res.status === 409) throw new Error('Generation already running')
  if (!res.body) throw new Error(`advise failed: ${res.status}`)
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  let result: RecommendationSet | null = null
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1)
      if (!line) continue
      const msg = JSON.parse(line)
      if (msg.type === 'progress') opts.onProgress?.({ phase: msg.phase })
      else if (msg.type === 'done') result = msg.recommendations as RecommendationSet
      else if (msg.type === 'error') throw new Error(msg.message)
    }
  }
  if (!result) throw new Error('advisor returned no result')
  return result
}
