import type { RunStateName } from './api/types'

// Human Ukrainian copy + color for each run state (status language §3).
export const STATE_COPY: Record<RunStateName, { label: string; tone: Tone }> = {
  SETUP_REQUIRED: { label: 'Потрібне налаштування', tone: 'gray' },
  UNKNOWN: { label: 'Стан невідомий', tone: 'gray' },
  IDLE: { label: 'Готово до нового уроку', tone: 'green' },
  STARTING: { label: 'Запуск…', tone: 'blue' },
  ARCHIVING: { label: 'Архівую попередній урок…', tone: 'blue' },
  STT: { label: 'Розпізнаю мовлення…', tone: 'blue' },
  TRANSLATING: { label: 'Перекладаю…', tone: 'blue' },
  SYNTHESIZING: { label: 'Синтезую аудіо…', tone: 'blue' },
  COMPLETE: { label: 'Дубляж готовий', tone: 'green' },
  STOPPING: { label: 'Зупинку прийнято — чекаю межі мови…', tone: 'amber' },
  STOPPED: { label: 'Зупинено — можна класти новий файл', tone: 'green' },
  REGENERATING: { label: 'Перегенерація триває…', tone: 'blue' },
  STALLED: { label: 'Немає прогресу — можливо, ран впав', tone: 'red' },
}

export type Tone = 'gray' | 'green' | 'blue' | 'amber' | 'red'

export const TONE_CLASSES: Record<Tone, string> = {
  gray: 'bg-gray-100 text-gray-700 border-gray-300',
  green: 'bg-green-100 text-green-800 border-green-300',
  blue: 'bg-blue-100 text-blue-800 border-blue-300',
  amber: 'bg-amber-100 text-amber-800 border-amber-300',
  red: 'bg-red-100 text-red-800 border-red-300',
}

// needs_attention cell coloring.
export const CELL_CLASSES: Record<string, string> = {
  TRUE: 'bg-red-100 text-red-900 border-red-200',
  FALSE: 'bg-green-50 text-green-900 border-green-200',
  REVIEW: 'bg-amber-100 text-amber-900 border-amber-200',
  MISSING: 'bg-gray-50 text-gray-400 border-gray-200',
  QUEUED: 'bg-blue-100 text-blue-900 border-blue-200',
}

export function cellClass(status: string, queued?: boolean): string {
  if (queued) return CELL_CLASSES.QUEUED
  return CELL_CLASSES[status] ?? CELL_CLASSES.MISSING
}

const WRITE_OK_STATES = ['IDLE', 'COMPLETE', 'STOPPED']

/** Writes allowed only with the flag on, not read-only, and pipeline idle. */
export function canWrite(state: { enableWrites?: boolean; readOnly?: boolean; state?: string } | null): boolean {
  return Boolean(state?.enableWrites) && !state?.readOnly && WRITE_OK_STATES.includes(state?.state ?? '')
}

export function writeBlockReason(state: { enableWrites?: boolean; readOnly?: boolean; state?: string } | null): string {
  if (!state) return 'немає стану'
  if (!state.enableWrites) return 'записи вимкнені (ENABLE_WRITES + повторний вхід з правом запису)'
  if (state.readOnly || !WRITE_OK_STATES.includes(state.state ?? '')) return 'заблоковано, поки триває ран'
  return ''
}
