import { useRunState } from '../api/useRunState'
import { STATE_COPY, TONE_CLASSES, currentStage, STAGES } from '../ui'
import { ThemeToggle } from './ThemeToggle'

export function Header() {
  const { state, connected } = useRunState()
  const copy = state ? STATE_COPY[state.state] : null
  const stage = state?.staged ? currentStage(state.state) : null

  return (
    <header className="flex items-center gap-4 border-b border-gray-200 bg-white px-5 py-3 dark:border-[#29292c] dark:bg-[#161617]">
      <div className="text-sm text-gray-500 dark:text-gray-400">
        Урок:{' '}
        <span className="font-medium text-gray-900 dark:text-gray-100">{state?.lessonId ?? '—'}</span>
        {state?.mode === 'mock' && (
          <span className="ml-2 rounded bg-purple-100 px-1.5 py-0.5 text-[11px] font-medium text-purple-700 dark:bg-purple-900/40 dark:text-purple-300">MOCK</span>
        )}
      </div>

      {stage && (
        <span className="rounded-full border border-gray-300 bg-gray-50 px-2 py-1 text-[11px] font-medium text-gray-600 dark:border-[#3a3a3d] dark:bg-[#202023] dark:text-gray-300">
          Етап {stage.index + 1}/{STAGES.length} · {STAGES[stage.index].label}
        </span>
      )}

      {copy && (
        <span className={`rounded-full border px-3 py-1 text-xs font-medium ${TONE_CLASSES[copy.tone]}`}>
          {copy.label}
        </span>
      )}

      {state && state.needsAttention.total > 0 && (
        <span className="text-sm text-gray-600 dark:text-gray-400">
          Потребують уваги:{' '}
          <span className="font-semibold text-gray-900 dark:text-gray-100">
            {state.needsAttention.count} ({state.needsAttention.pct}%)
          </span>
        </span>
      )}

      <div className="ml-auto flex items-center gap-2 text-xs text-gray-400">
        {!state?.enableWrites && (
          <span className="rounded bg-gray-100 px-2 py-0.5 dark:bg-[#202023]">записи вимкнено</span>
        )}
        <ThemeToggle />
        <span className={`h-2 w-2 rounded-full ${connected ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`} title={connected ? 'live' : 'offline'} />
      </div>
    </header>
  )
}
