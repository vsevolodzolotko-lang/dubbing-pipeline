import type { CpsConfidence, RecConfidence } from '../../api/types'

// Confidence → chip classes (same palette as Qa.tsx severity chips). high/HIGH is
// the "trust it" end (green), low/LOW the "don't trust it" end (gray).
export const CONF_CHIP: Record<string, string> = {
  high: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  medium: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  low: 'bg-gray-100 text-gray-600 dark:bg-[#202023] dark:text-gray-300',
}
export const recConfChip = (c: RecConfidence) => CONF_CHIP[c] ?? CONF_CHIP.low
export const cpsConfChip = (c: CpsConfidence) =>
  c === 'HIGH' ? CONF_CHIP.high : c === 'MED' ? CONF_CHIP.medium : CONF_CHIP.low
export const cpsConfLabel: Record<CpsConfidence, string> = { HIGH: 'high conf.', MED: 'med conf.', LOW: 'low conf.' }

// 0-100 score → tone (matches ui.ts Tone palette buckets).
export function scoreTone(score: number | null): 'green' | 'amber' | 'red' | 'gray' {
  if (score == null) return 'gray'
  if (score >= 80) return 'green'
  if (score >= 60) return 'amber'
  return 'red'
}
export const SCORE_TEXT: Record<string, string> = {
  green: 'text-green-700 dark:text-green-400',
  amber: 'text-amber-700 dark:text-amber-400',
  red: 'text-red-700 dark:text-red-400',
  gray: 'text-gray-400',
}

// phase2 outcome → bar color (failures red/amber, accepted green, neutral gray).
export const PHASE2_CLS: Record<string, string> = {
  accepted: 'bg-green-400 dark:bg-green-600',
  no_change: 'bg-gray-300 dark:bg-gray-600',
  none: 'bg-gray-200 dark:bg-gray-700',
  overshoot: 'bg-amber-400 dark:bg-amber-600',
  negative_tail: 'bg-amber-400 dark:bg-amber-600',
  concept_dropped: 'bg-red-400 dark:bg-red-600',
  error: 'bg-red-500 dark:bg-red-700',
  tts_empty: 'bg-red-500 dark:bg-red-700',
  llm_dropped: 'bg-red-400 dark:bg-red-600',
  llm_refusal: 'bg-red-400 dark:bg-red-600',
}
export const phase2Cls = (k: string) => PHASE2_CLS[k] ?? 'bg-gray-300 dark:bg-gray-600'

// Friendly metric labels for the trend selector.
export const TREND_METRICS: { key: string; label: string; invert?: boolean }[] = [
  { key: 'score', label: 'Health score' },
  { key: 'attTrueRate', label: 'Needs-attention rate', invert: true },
  { key: 'regenRate', label: 'Regen rate', invert: true },
  { key: 'cpsDeltaMax', label: 'Max CPS drift', invert: true },
]

export const REGEN_REASON_LABEL: Record<string, string> = {
  shortened: 'shortened', pacing: 'pacing', rewrite: 'rewrite', other: 'other', unspecified: 'unspecified',
}
export const QA_TYPE_LABEL: Record<string, string> = {
  formality: 'formality', gender: 'gender', false_friend: 'false friend', naturalness: 'naturalness',
}
