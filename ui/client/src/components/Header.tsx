import { useRunState } from '../api/useRunState'
import { STATE_COPY, TONE_CLASSES } from '../ui'

export function Header() {
  const { state, connected } = useRunState()
  const copy = state ? STATE_COPY[state.state] : null

  return (
    <header className="flex items-center gap-4 border-b border-gray-200 bg-white px-5 py-3">
      <div className="text-sm text-gray-500">
        Урок:{' '}
        <span className="font-medium text-gray-900">{state?.lessonId ?? '—'}</span>
        {state?.mode === 'mock' && (
          <span className="ml-2 rounded bg-purple-100 px-1.5 py-0.5 text-[11px] font-medium text-purple-700">MOCK</span>
        )}
      </div>

      {copy && (
        <span className={`rounded-full border px-3 py-1 text-xs font-medium ${TONE_CLASSES[copy.tone]}`}>
          {copy.label}
        </span>
      )}

      {state && state.needsAttention.total > 0 && (
        <span className="text-sm text-gray-600">
          Потребують уваги:{' '}
          <span className="font-semibold text-gray-900">
            {state.needsAttention.count} ({state.needsAttention.pct}%)
          </span>
        </span>
      )}

      <div className="ml-auto flex items-center gap-3 text-xs text-gray-400">
        {!state?.enableWrites && (
          <span className="rounded bg-gray-100 px-2 py-0.5">записи вимкнено</span>
        )}
        <span className={`h-2 w-2 rounded-full ${connected ? 'bg-green-500' : 'bg-gray-300'}`} title={connected ? 'live' : 'offline'} />
      </div>
    </header>
  )
}
