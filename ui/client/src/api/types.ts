export type RunStateName =
  | 'SETUP_REQUIRED' | 'UNKNOWN' | 'IDLE' | 'STARTING' | 'ARCHIVING'
  | 'STT' | 'TRANSLATING' | 'SYNTHESIZING' | 'COMPLETE'
  | 'STOPPING' | 'STOPPED' | 'REGENERATING' | 'STALLED'

export interface RunState {
  state: RunStateName
  lessonId: string | null
  readOnly: boolean
  stalled: boolean
  reason?: string
  runTokenPresent: boolean
  progress: {
    segCount: number
    langTotal: number
    langDone: number
    currentLang: string | null
    langTextDone: number
    synthByLang: Record<string, number>
  }
  needsAttention: { count: number; total: number; pct: number }
  timing?: {
    runStartedAt: string | null
    elapsedSec: number | null
    etaSec: number | null
    etaAt: string | null
    rowsPerMin: number | null
    rowsDone: number
    rowsTotal: number
  } | null
  mode: 'mock' | 'live'
  version: number
  lastPollAt: string | null
  enableWrites: boolean
  error?: { code: string; message: string } | null
}

export interface Cause {
  kind: 'length' | 'speed' | 'density' | 'movement' | 'regen' | 'phase2' | 'tech' | 'tight'
  text: string
  confidence: 'certain' | 'likely'
}

export interface Diagnosis {
  severity: 'ok' | 'warn' | 'bad' | 'review' | 'queued'
  primary: string
  causes: Cause[]
  advice: string | null
  facts: string[]
  fill: { real: number; slot: number } | null
}

export interface Cell {
  present: boolean
  rowKey?: string
  lang?: string
  status: 'TRUE' | 'FALSE' | 'REVIEW' | 'MISSING'
  needsRetts?: boolean
  textTranslated?: string
  realDuration?: number | null
  finalDuration?: number | null
  finalSpeed?: number | null
  borrowedSec?: number | null
  expansionAttempts?: number
  shortenRetries?: number
  phase2Outcome?: string
  lastRegenAt?: string
  regenComment?: string
  audioFileId?: string
  diagnosis?: Diagnosis
}

export interface SegmentRow {
  segmentId: string
  enText: string
  enStart: number | null
  enEnd: number | null
  enDuration: number | null
  segmentType: string
  movementKeywords: string
  movementLocked: boolean
  cells: Record<string, Cell>
}

export interface Lesson {
  lessonId: string | null
  langs: string[]
  segments: SegmentRow[]
}

export interface SetupCheck {
  id: string
  label: string
  status: 'pass' | 'fail' | 'skip'
  detail: string
  remediation: string | null
}

export interface SetupStatus {
  ok: boolean
  mock: boolean
  mode: string
  serviceAccountEmail: string | null
  checks: SetupCheck[]
}
