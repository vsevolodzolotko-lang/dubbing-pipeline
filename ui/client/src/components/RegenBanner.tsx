import { useEffect, useState } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { useRunState } from '../api/useRunState'

/** In-flight regen status: progress, stale-watchdog warning, and a done toast. */
export function RegenBanner() {
  const { regen } = useRunState()
  const [doneCount, setDoneCount] = useState<number | null>(null)

  useEffect(() => {
    if (regen.event === 'done') {
      setDoneCount(regen.total ?? 0)
      const t = setTimeout(() => setDoneCount(null), 9000)
      return () => clearTimeout(t)
    }
  }, [regen.event, regen.total])

  if (regen.active && regen.stale) {
    const mins = Math.max(1, Math.round((regen.elapsedSec ?? 0) / 60))
    return (
      <Bar tone="red">
        <AlertTriangle className="inline-block h-3.5 w-3.5 align-[-0.2em]" strokeWidth={1.75} /> Перегенерація могла впасти — {regen.remaining} з {regen.total} рядків не оновились за ~{mins} хв.
        Перевір n8n executions / Slack (W_Regen без error-воркфлоу — тихий збій можливий).
      </Bar>
    )
  }
  if (regen.active) {
    return <Bar tone="blue"><RefreshCw className="inline-block h-3.5 w-3.5 align-[-0.2em] animate-spin" strokeWidth={1.75} /> Перегенерація триває — лишилось {regen.remaining} з {regen.total} ({regen.elapsedSec ?? 0}с)…</Bar>
  }
  if (doneCount != null) {
    return <Bar tone="green"><RefreshCw className="inline-block h-3.5 w-3.5 align-[-0.2em]" strokeWidth={1.75} /> Перегенерація завершена — {doneCount} рядків стали REVIEW. Послухай і постав вердикт (фільтр «Після регену»).</Bar>
  }
  return null
}

function Bar({ tone, children }: { tone: 'red' | 'blue' | 'green'; children: React.ReactNode }) {
  const cls = tone === 'red' ? 'bg-red-50 text-red-800 border-red-200 dark:bg-red-950/50 dark:text-red-300 dark:border-red-900'
    : tone === 'green' ? 'bg-green-50 text-green-800 border-green-200 dark:bg-green-950/50 dark:text-green-300 dark:border-green-900'
    : 'bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-900'
  return <div className={`border-b px-5 py-2 text-sm ${cls}`}>{children}</div>
}
