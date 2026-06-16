import { useRunState } from '../api/useRunState'

/** Read-only lockdown + stall warnings — mirrors the operator manual rules. */
export function RunBanner() {
  const { state } = useRunState()
  if (!state) return null

  if (state.stalled) {
    return (
      <Banner tone="red">
        ⚠ Немає прогресу понад 12 хв — можливо, ран зупинився
        {state.progress.currentLang ? ` на мові ${state.progress.currentLang}` : ''}. Готові мови НЕ пересинтезуються —
        поклич automation tech, він відновить з місця зупинки. Не запускай новий урок наосліп.
      </Banner>
    )
  }

  if (state.error) {
    return <Banner tone="red">Помилка зв'язку з Google: {state.error.message}</Banner>
  }

  if (state.readOnly) {
    return (
      <Banner tone="amber">
        ▶ Триває локалізація{state.lessonId ? ` ${state.lessonId}` : ''} — редагування вимкнено до завершення
        (це захищає дані, як у правилі «не чіпай Sheets під час рану»).
      </Banner>
    )
  }

  return null
}

function Banner({ tone, children }: { tone: 'red' | 'amber'; children: React.ReactNode }) {
  const cls = tone === 'red'
    ? 'bg-red-50 text-red-800 border-red-200'
    : 'bg-amber-50 text-amber-900 border-amber-200'
  return <div className={`border-b px-5 py-2 text-sm ${cls}`}>{children}</div>
}
