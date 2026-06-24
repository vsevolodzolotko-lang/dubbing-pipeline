import { AlertTriangle, Play } from 'lucide-react'
import { useRunState } from '../api/useRunState'

/**
 * Read-only lockdown + stall/error warnings — mirrors the operator manual rules.
 * The review-gate nudge is intentionally NOT shown here: the header status pill and
 * the sidebar gate-dot already point at the active gate, so a full-width banner just
 * wasted vertical space.
 */
export function RunBanner() {
  const { state } = useRunState()
  if (!state) return null

  if (state.stalled) {
    return (
      <Banner tone="red">
        <AlertTriangle className="inline-block h-3.5 w-3.5 align-[-0.2em]" strokeWidth={1.75} /> No progress for over 12 min — the run may have stalled
        {state.progress.currentLang ? ` on language ${state.progress.currentLang}` : ''}. Completed languages are NOT re-synthesized —
        call the automation tech and they will resume from where it stopped. Do not start a new lesson blindly.
      </Banner>
    )
  }

  if (state.error) {
    return <Banner tone="red">Google connection error: {state.error.message}</Banner>
  }

  if (state.readOnly) {
    return (
      <Banner tone="amber">
        <Play className="inline-block h-3.5 w-3.5 align-[-0.2em]" strokeWidth={1.75} /> Localization in progress{state.lessonId ? ` ${state.lessonId}` : ''} — editing is disabled until it completes
        (this protects the data, per the "don't touch Sheets during a run" rule).
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
