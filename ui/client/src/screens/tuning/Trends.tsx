import { useState } from 'react'
import { useTuningRuns } from '../../api/queries'
import { TrendLine } from './charts'
import { TREND_METRICS } from './tuningCatalog'
import { HelpNote } from './Help'
import type { TuningRunSummary } from '../../api/types'

export function Trends() {
  const { data, isLoading } = useTuningRuns()
  const [metricKey, setMetricKey] = useState(TREND_METRICS[0].key)
  const rows = data?.rows ?? []
  // store is newest-first → chronological for the line.
  const chronological = rows.slice().reverse()
  const metric = TREND_METRICS.find((m) => m.key === metricKey)!
  const values = chronological.map((r) => (r as unknown as Record<string, number | null>)[metricKey] ?? null)
  const nums = values.filter((v): v is number => v != null)
  const latest = nums.length ? nums[nums.length - 1] : null
  const first = nums.length ? nums[0] : null
  const delta = latest != null && first != null ? +(latest - first).toFixed(3) : null
  const fmt = (v: number) => (metricKey === 'score' ? String(Math.round(v)) : metricKey === 'cpsDeltaMax' ? String(v) : `${Math.round(v * 100)}%`)

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Trends across runs</h2>
        <select value={metricKey} onChange={(e) => setMetricKey(e.target.value)}
          className="rounded-md border border-gray-300 px-2 py-1 text-xs dark:border-[#3a3a3d] dark:bg-[#161617]">
          {TREND_METRICS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
        </select>
        <span className="text-xs text-gray-400">{rows.length} run{rows.length === 1 ? '' : 's'} captured</span>
      </div>
      <HelpNote>
        Each point is one captured run (oldest → newest). Pick a metric and watch the line after you apply a
        recommendation — for the health score, up is better; for the rates and CPS drift, down is better.
        A run is captured at Export or when you generate recommendations.
      </HelpNote>

      {isLoading ? (
        <div className="text-sm text-gray-400">Loading…</div>
      ) : rows.length < 2 ? (
        <div className="rounded-lg border border-dashed border-gray-300 p-4 text-sm text-gray-400 dark:border-[#3a3a3d]">
          Needs at least 2 captured runs. A run is captured when it reaches Export, or when you generate recommendations. Trends then show whether your changes moved the needle.
        </div>
      ) : (
        <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-[#29292c] dark:bg-[#161617]">
          <div className="mb-1 flex items-baseline gap-3 text-xs text-gray-500 dark:text-gray-400">
            {latest != null && <span>latest <b className="text-gray-700 dark:text-gray-200">{fmt(latest)}</b></span>}
            {delta != null && delta !== 0 && (
              <span className={improving(metric, delta) ? 'text-green-700 dark:text-green-400' : 'text-amber-700 dark:text-amber-400'}>
                {delta > 0 ? '+' : ''}{metricKey === 'score' ? Math.round(delta) : metricKey === 'cpsDeltaMax' ? delta : `${Math.round(delta * 100)}%`} since first {improving(metric, delta) ? '(better)' : '(worse)'}
              </span>
            )}
          </div>
          <TrendLine values={values} tone={metricKey === 'score' ? 'text-green-500' : 'text-blue-500'} />
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-gray-400">
            {chronological.map((r) => <RunTag key={r.id} r={r} />)}
          </div>
        </div>
      )}
    </section>
  )
}

function improving(metric: { invert?: boolean }, delta: number) {
  // higher score is better; for inverted metrics (attention/regen/drift) lower is better.
  return metric.invert ? delta < 0 : delta > 0
}

function RunTag({ r }: { r: TuningRunSummary }) {
  const when = r.finishedAt ? new Date(r.finishedAt).toLocaleDateString('uk-UA') : r.id
  return <span title={r.runToken ?? r.id}>{r.lessonId ?? r.id} · {when}</span>
}
