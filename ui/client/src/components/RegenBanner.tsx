import { useEffect, useState } from 'react'
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
        ⚠ Перегенерація могла впасти — {regen.remaining} з {regen.total} рядків не оновились за ~{mins} хв.
        Перевір n8n executions / Slack (W_Regen без error-воркфлоу — тихий збій можливий).
      </Bar>
    )
  }
  if (regen.active) {
    return <Bar tone="blue">🔄 Перегенерація триває — лишилось {regen.remaining} з {regen.total} ({regen.elapsedSec ?? 0}с)…</Bar>
  }
  if (doneCount != null) {
    return <Bar tone="green">🔄 Перегенерація завершена — {doneCount} рядків стали REVIEW. Послухай і постав вердикт (фільтр «Після регену»).</Bar>
  }
  return null
}

function Bar({ tone, children }: { tone: 'red' | 'blue' | 'green'; children: React.ReactNode }) {
  const cls = tone === 'red' ? 'bg-red-50 text-red-800 border-red-200'
    : tone === 'green' ? 'bg-green-50 text-green-800 border-green-200'
    : 'bg-blue-50 text-blue-800 border-blue-200'
  return <div className={`border-b px-5 py-2 text-sm ${cls}`}>{children}</div>
}
