import type { RunStateName } from './api/types'

// Human Ukrainian copy + color for each run state (status language §3).
export const STATE_COPY: Record<RunStateName, { label: string; tone: Tone }> = {
  SETUP_REQUIRED: { label: 'Потрібне налаштування', tone: 'gray' },
  UNKNOWN: { label: 'Стан невідомий', tone: 'gray' },
  IDLE: { label: 'Готово до нового уроку', tone: 'green' },
  STARTING: { label: 'Запуск…', tone: 'blue' },
  ARCHIVING: { label: 'Архівую попередній урок…', tone: 'blue' },
  STT: { label: 'Розпізнаю мовлення…', tone: 'blue' },
  TRANSCRIPT_REVIEW: { label: 'Перевір транскрипцію → підтверди', tone: 'amber' },
  TRANSLATING: { label: 'Перекладаю…', tone: 'blue' },
  TRANSLATION_REVIEW: { label: 'Перевір переклади → підтверди', tone: 'amber' },
  SYNTHESIZING: { label: 'Синтезую аудіо…', tone: 'blue' },
  AUDIO_REVIEW: { label: 'Перевір аудіо → збери повний файл', tone: 'amber' },
  RENDERING: { label: 'Збираю повний файл…', tone: 'blue' },
  COMPLETE: { label: 'Дубляж готовий', tone: 'green' },
  STOPPING: { label: 'Зупинку прийнято — чекаю межі мови…', tone: 'amber' },
  STOPPED: { label: 'Зупинено — можна класти новий файл', tone: 'green' },
  REGENERATING: { label: 'Перегенерація триває…', tone: 'blue' },
  STALLED: { label: 'Немає прогресу — можливо, ран впав', tone: 'red' },
}

export type Tone = 'gray' | 'green' | 'blue' | 'amber' | 'red'

// Spirio wellness palette: sage=ok, ochre=review/warn, rust=danger, info=running.
export const TONE_CLASSES: Record<Tone, string> = {
  gray: 'bg-gray-100 text-gray-700 border-gray-300 dark:bg-[#262019] dark:text-gray-300 dark:border-[#473d31]',
  green: 'bg-sage-100 text-sage-700 border-sage-200 dark:bg-sage-900/40 dark:text-sage-200 dark:border-sage-700',
  blue: 'bg-info-100 text-info-700 border-info-200 dark:bg-info-900/40 dark:text-info-200 dark:border-info-700',
  amber: 'bg-ochre-100 text-ochre-700 border-ochre-200 dark:bg-ochre-900/40 dark:text-ochre-200 dark:border-ochre-700',
  red: 'bg-rust-100 text-rust-700 border-rust-200 dark:bg-rust-900/40 dark:text-rust-200 dark:border-rust-700',
}

// needs_attention cell coloring.
export const CELL_CLASSES: Record<string, string> = {
  TRUE: 'bg-rust-100 text-rust-700 border-rust-200 dark:bg-rust-900/40 dark:text-rust-200 dark:border-rust-700',
  FALSE: 'bg-sage-100 text-sage-700 border-sage-200 dark:bg-sage-900/30 dark:text-sage-200 dark:border-sage-700',
  REVIEW: 'bg-ochre-100 text-ochre-700 border-ochre-200 dark:bg-ochre-900/40 dark:text-ochre-200 dark:border-ochre-700',
  MISSING: 'bg-gray-50 text-gray-400 border-gray-200 dark:bg-[#262019] dark:text-gray-500 dark:border-[#473d31]',
  QUEUED: 'bg-info-100 text-info-700 border-info-200 dark:bg-info-900/40 dark:text-info-200 dark:border-info-700',
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
export type StageKey = 'transcript' | 'translation' | 'audio'
export interface StageInfo { key: StageKey; index: number; phase: 'running' | 'gate' }

export const STAGES: { key: StageKey; label: string; route: string }[] = [
  { key: 'transcript', label: 'Транскрипт', route: '/transcript' },
  { key: 'translation', label: 'Переклад', route: '/translation' },
  { key: 'audio', label: 'Аудіо', route: '/review' },
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
    case 'RENDERING': return { key: 'audio', index: 2, phase: 'running' } // building the full file
    case 'COMPLETE': return { key: 'audio', index: 2, phase: 'gate' }
    default: return null
  }
}

