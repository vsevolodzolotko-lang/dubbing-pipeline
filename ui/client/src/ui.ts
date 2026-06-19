import type { RunStateName } from './api/types'

// Human Ukrainian copy + color for each run state (status language §3).
export const STATE_COPY: Record<RunStateName, { label: string; tone: Tone }> = {
  SETUP_REQUIRED: { label: 'Потрібне налаштування', tone: 'gray' },
  UNKNOWN: { label: 'Стан невідомий', tone: 'gray' },
  IDLE: { label: 'Готово до нового уроку', tone: 'green' },
  STARTING: { label: 'Запуск…', tone: 'blue' },
  ARCHIVING: { label: 'Архівую попередній урок…', tone: 'blue' },
  STT: { label: 'Розпізнаю мовлення…', tone: 'blue' },
  TRANSCRIPT_REVIEW: { label: 'Перевір транскрипцію, далі підтверди', tone: 'amber' },
  TRANSLATING: { label: 'Перекладаю…', tone: 'blue' },
  TRANSLATION_REVIEW: { label: 'Перевір переклади, далі підтверди', tone: 'amber' },
  SYNTHESIZING: { label: 'Синтезую аудіо…', tone: 'blue' },
  AUDIO_REVIEW: { label: 'Перевір аудіо, далі склейка', tone: 'amber' },
  RENDER_REVIEW: { label: 'Склейка — обери, куди зберегти', tone: 'amber' },
  RENDERING: { label: 'Збираю повний файл…', tone: 'blue' },
  COMPLETE: { label: 'Дубляж готовий', tone: 'green' },
  STOPPING: { label: 'Зупинку прийнято — чекаю межі мови…', tone: 'amber' },
  STOPPED: { label: 'Зупинено — можна класти новий файл', tone: 'green' },
  REGENERATING: { label: 'Перегенерація триває…', tone: 'blue' },
  STALLED: { label: 'Немає прогресу — можливо, ран впав', tone: 'red' },
}

export type Tone = 'gray' | 'green' | 'blue' | 'amber' | 'red'

export const TONE_CLASSES: Record<Tone, string> = {
  gray: 'bg-gray-100 text-gray-700 border-gray-300 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700',
  green: 'bg-green-100 text-green-800 border-green-300 dark:bg-green-900/40 dark:text-green-300 dark:border-green-800',
  blue: 'bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-900/40 dark:text-blue-300 dark:border-blue-800',
  amber: 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-800',
  red: 'bg-red-100 text-red-800 border-red-300 dark:bg-red-900/40 dark:text-red-300 dark:border-red-800',
}

// needs_attention cell coloring.
export const CELL_CLASSES: Record<string, string> = {
  TRUE: 'bg-red-100 text-red-900 border-red-200 dark:bg-red-900/40 dark:text-red-200 dark:border-red-800',
  FALSE: 'bg-green-50 text-green-900 border-green-200 dark:bg-green-900/30 dark:text-green-200 dark:border-green-800',
  REVIEW: 'bg-amber-100 text-amber-900 border-amber-200 dark:bg-amber-900/40 dark:text-amber-200 dark:border-amber-800',
  MISSING: 'bg-gray-50 text-gray-400 border-gray-200 dark:bg-gray-800 dark:text-gray-500 dark:border-gray-700',
  QUEUED: 'bg-blue-100 text-blue-900 border-blue-200 dark:bg-blue-900/40 dark:text-blue-200 dark:border-blue-800',
}

export function cellClass(status: string, queued?: boolean): string {
  if (queued) return CELL_CLASSES.QUEUED
  return CELL_CLASSES[status] ?? CELL_CLASSES.MISSING
}

type StateLike = { enableWrites?: boolean; readOnly?: boolean; state?: string } | null

// Per-gate write scopes (mirror the server's *_WRITE_STATES sets).
const LOCALIZATION_WRITE_STATES = ['IDLE', 'COMPLETE', 'STOPPED', 'AUDIO_REVIEW']
const TRANSCRIPT_WRITE_STATES = ['TRANSCRIPT_REVIEW']
const TRANSLATION_WRITE_STATES = ['TRANSLATION_REVIEW']

function can(state: StateLike, ok: string[]): boolean {
  return Boolean(state?.enableWrites) && ok.includes(state?.state ?? '')
}

/** Localization edits/regen (audio review + settled states). Also the legacy
 *  `canWrite` used by Workbench/Voices/Config. */
export function canWriteLocalizations(state: StateLike): boolean {
  return can(state, LOCALIZATION_WRITE_STATES)
}
export const canWrite = canWriteLocalizations
export function canWriteTranscript(state: StateLike): boolean {
  return can(state, TRANSCRIPT_WRITE_STATES)
}
export function canWriteTranslations(state: StateLike): boolean {
  return can(state, TRANSLATION_WRITE_STATES)
}

export function writeBlockReason(state: StateLike): string {
  if (!state) return 'немає стану'
  if (!state.enableWrites) return 'записи вимкнені (ENABLE_WRITES + повторний вхід з правом запису)'
  return 'заблоковано на цьому етапі'
}

// ── staged pipeline: 3 review gates ─────────────────────────────────────────
export type StageKey = 'transcript' | 'translation' | 'audio' | 'render'
export interface StageInfo { key: StageKey; index: number; phase: 'running' | 'gate' }

export const STAGES: { key: StageKey; label: string; route: string }[] = [
  { key: 'transcript', label: 'Транскрипт', route: '/transcript' },
  { key: 'translation', label: 'Переклад', route: '/translation' },
  { key: 'audio', label: 'Аудіо', route: '/review' },
  { key: 'render', label: 'Склейка', route: '/render' },
]

/** Map a run state to its staged gate + whether the pipeline is mid-run
 *  (`running`) or paused awaiting approval (`gate`). null for non-staged states. */
export function currentStage(stateName?: string | null): StageInfo | null {
  switch (stateName) {
    case 'STT': return { key: 'transcript', index: 0, phase: 'running' }
    case 'TRANSCRIPT_REVIEW': return { key: 'transcript', index: 0, phase: 'gate' }
    case 'TRANSLATING': return { key: 'translation', index: 1, phase: 'running' }
    case 'TRANSLATION_REVIEW': return { key: 'translation', index: 1, phase: 'gate' }
    case 'SYNTHESIZING': return { key: 'audio', index: 2, phase: 'running' }
    case 'AUDIO_REVIEW': return { key: 'audio', index: 2, phase: 'gate' }
    case 'RENDER_REVIEW': return { key: 'render', index: 3, phase: 'gate' } // assemble-file gate
    case 'RENDERING': return { key: 'render', index: 3, phase: 'running' } // building the full file
    case 'COMPLETE': return { key: 'render', index: 3, phase: 'gate' }
    default: return null
  }
}

