import { useEffect, useState } from 'react'
import { useRunState } from '../api/useRunState'
import { canWrite, writeBlockReason } from '../ui'
import { useTuningReport, useTuningRuns, useTuningAdvice } from '../api/queries'
import type { RecommendationSet } from '../api/types'
import { HealthOverview } from './tuning/HealthOverview'
import { Recommendations } from './tuning/Recommendations'
import { Diagnostics } from './tuning/Diagnostics'
import { Trends } from './tuning/Trends'
import { HowToUse } from './tuning/Help'

// Tuning — text-quality intelligence. Collects per-run metrics, surfaces LLM
// recommendations (config / voices / prompts) applied in one click, and tracks
// quality trends across runs. Replaces the old CPS-calibration placeholder; CPS
// is now one panel inside Diagnostics.
export function TuningLab() {
  const { state } = useRunState()
  const writable = canWrite(state)
  const reason = writeBlockReason(state)
  const [runId, setRunId] = useState<string | undefined>(undefined) // undefined = current/live run
  const { data: report, isLoading, error } = useTuningReport(runId)
  const { data: runsData } = useTuningRuns()
  const { data: cachedAdvice } = useTuningAdvice()
  const [advice, setAdvice] = useState<RecommendationSet | null>(null)

  // Seed the recommendations from the last-cached set once it loads.
  useEffect(() => {
    if (cachedAdvice && cachedAdvice.generatedAt) setAdvice(cachedAdvice)
  }, [cachedAdvice])

  const runs = runsData?.rows ?? []

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Tuning</h1>
        {!writable && <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">read-only — {reason}</span>}
        {runs.length > 0 && (
          <select value={runId ?? ''} onChange={(e) => setRunId(e.target.value || undefined)}
            className="ml-auto rounded-md border border-gray-300 px-2 py-1 text-xs dark:border-[#3a3a3d] dark:bg-[#161617]">
            <option value="">Current run (live)</option>
            {runs.map((r) => (
              <option key={r.id} value={r.id}>{r.lessonId ?? r.id} · {r.finishedAt ? new Date(r.finishedAt).toLocaleString('uk-UA') : r.id}</option>
            ))}
          </select>
        )}
        {report?.generatedAt && <span className="text-xs text-gray-400">computed {new Date(report.generatedAt).toLocaleString('uk-UA')}</span>}
      </div>
      <p className="mt-1 max-w-prose text-sm text-gray-500 dark:text-gray-400">
        Quality metrics from pipeline runs, AI-recommended settings, and CPS calibration in one place.
        Recommendations are evidence-backed and applied with one click. The advisor prompt lives in the Prompts tab.
      </p>

      <HowToUse />

      {isLoading && <div className="mt-6 text-sm text-gray-400">Computing metrics…</div>}
      {error && <div className="mt-6 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">{String(error)}</div>}

      {report && (
        <div className="mt-6 space-y-8">
          <HealthOverview report={report} />
          {!runId && <Recommendations advice={advice} onGenerated={setAdvice} />}
          <Diagnostics report={report} />
          <Trends />
        </div>
      )}
    </div>
  )
}
