import type { RunStateName } from './api/types'

// Human Ukrainian copy + color for each run state (status language §3).
export const STATE_COPY: Record<RunStateName, { label: string; tone: Tone }> = {
  SETUP_REQUIRED: { label: 'Setup required', tone: 'gray' },
  UNKNOWN: { label: 'Status unknown', tone: 'gray' },
  IDLE: { label: 'Ready for a new lesson', tone: 'green' },
  STARTING: { label: 'Starting…', tone: 'blue' },
  ARCHIVING: { label: 'Archiving the previous lesson…', tone: 'blue' },
  STT: { label: 'Recognizing speech…', tone: 'blue' },
  TRANSCRIPT_REVIEW: { label: 'Review the transcript, then approve', tone: 'amber' },
  TRANSLATING: { label: 'Translating…', tone: 'blue' },
  TRANSLATION_REVIEW: { label: 'Review the translations, then approve', tone: 'amber' },
  SYNTHESIZING: { label: 'Synthesizing audio…', tone: 'blue' },
  AUDIO_REVIEW: { label: 'Review the audio, then export', tone: 'amber' },
  RENDER_REVIEW: { label: 'Export — assemble and download', tone: 'amber' },
  RENDERING: { label: 'Building the full file…', tone: 'blue' },
  COMPLETE: { label: 'Localization ready', tone: 'green' },
  STOPPING: { label: 'Stop accepted — waiting for a speech boundary…', tone: 'amber' },
  STOPPED: { label: 'Stopped — you can drop in a new file', tone: 'green' },
  REGENERATING: { label: 'Regeneration in progress…', tone: 'blue' },
  STALLED: { label: 'No progress — the run may have crashed', tone: 'red' },
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
// Translation gate + audio review (fixing a flagged translation there feeds regen).
const TRANSLATION_WRITE_STATES = ['TRANSLATION_REVIEW', 'AUDIO_REVIEW']

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
  if (!state) return 'no state'
  if (!state.enableWrites) return 'writes disabled (ENABLE_WRITES + re-enter with write access)'
  return 'blocked at this stage'
}

// ── staged pipeline: 3 review gates ─────────────────────────────────────────
export type StageKey = 'transcript' | 'translation' | 'audio' | 'render'
export interface StageInfo { key: StageKey; index: number; phase: 'running' | 'gate' }

export const STAGES: { key: StageKey; label: string; route: string }[] = [
  { key: 'transcript', label: 'Transcript', route: '/transcript' },
  { key: 'translation', label: 'Translation', route: '/translation' },
  { key: 'audio', label: 'Audio', route: '/review' },
  { key: 'render', label: 'Export', route: '/render' },
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

