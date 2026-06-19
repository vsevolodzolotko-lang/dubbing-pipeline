import { AlertTriangle, ArrowRight, Hand, Play } from 'lucide-react'
import { useRunState } from '../api/useRunState'

const REVIEW_GATE: Record<string, { label: string; route: string }> = {
  TRANSCRIPT_REVIEW: { label: 'транскрипцію', route: '/transcript' },
  TRANSLATION_REVIEW: { label: 'переклади', route: '/translation' },
  AUDIO_REVIEW: { label: 'аудіо', route: '/review' },
}

/** Read-only lockdown + stall warnings — mirrors the operator manual rules. */
export function RunBanner() {
  const { state } = useRunState()
  if (!state) return null

  const gate = REVIEW_GATE[state.state]
  if (gate) {
    return (
      <Banner tone="amber">
        <Hand className="inline-block h-3.5 w-3.5 align-[-0.2em]" strokeWidth={1.75} /> Пайплайн чекає на тебе — перевір {gate.label} і натисни «Затвердити та продовжити».{' '}
        <a href={gate.route} className="font-medium underline"><ArrowRight className="inline-block h-3.5 w-3.5 align-[-0.2em]" strokeWidth={1.75} /> перейти до перевірки</a>
      </Banner>
    )
  }

  if (state.stalled) {
    return (
      <Banner tone="red">
        <AlertTriangle className="inline-block h-3.5 w-3.5 align-[-0.2em]" strokeWidth={1.75} /> Немає прогресу понад 12 хв — можливо, ран зупинився
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
        <Play className="inline-block h-3.5 w-3.5 align-[-0.2em]" strokeWidth={1.75} /> Триває локалізація{state.lessonId ? ` ${state.lessonId}` : ''} — редагування вимкнено до завершення
        (це захищає дані, як у правилі «не чіпай Sheets під час рану»).
      </Banner>
    )
  }

  return null
}

function Banner({ tone, children }: { tone: 'red' | 'amber'; children: React.ReactNode }) {
  const cls = tone === 'red'
    ? 'bg-red-50 text-red-800 border-red-200 dark:bg-red-950/50 dark:text-red-300 dark:border-red-900'
    : 'bg-amber-50 text-amber-900 border-amber-200 dark:bg-amber-950/50 dark:text-amber-200 dark:border-amber-900'
  return <div className={`border-b px-5 py-2 text-sm ${cls}`}>{children}</div>
}
