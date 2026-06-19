export type RunStateName =
  | 'SETUP_REQUIRED' | 'UNKNOWN' | 'IDLE' | 'STARTING' | 'ARCHIVING'
  | 'STT' | 'TRANSCRIPT_REVIEW' | 'TRANSLATING' | 'TRANSLATION_REVIEW'
  | 'SYNTHESIZING' | 'AUDIO_REVIEW' | 'RENDER_REVIEW' | 'RENDERING' | 'COMPLETE'
  | 'STOPPING' | 'STOPPED' | 'REGENERATING' | 'STALLED'

export interface RunState {
  state: RunStateName
  lessonId: string | null
  readOnly: boolean
  stalled: boolean
  reason?: string
  runTokenPresent: boolean
  staged?: boolean
  pipelineStage?: 'STT' | 'TRANSLATE' | 'SYNTH' | 'DONE' | null
  stageStatus?: 'RUNNING' | 'REVIEW' | 'APPROVED' | null
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
  normalizedLufs?: number | null
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

// Raw `segments` tab row (snake_case, as parsed from the sheet). Used by the
// transcript/translation review gates, which read segments directly.
export interface RawSegment {
  segment_id: string
  en_text: string
  en_start_sec: string | number
  en_end_sec: string | number
  en_duration_sec: string | number
  segment_type: string
  movement_keywords: string
  [key: string]: string | number // {lang}_text, adaptation_attempts, …
}

export interface ArchiveRunSummary {
  id: string
  lessonId: string | null
  finishedAt: string
  segCount: number
  langCount: number
  langs: string[]
  needsAttention: { count: number; total: number; pct: number }
}

export interface ArchiveRun extends ArchiveRunSummary {
  settings: {
    config: Record<string, string>
    voices: Array<Record<string, string>>
    activeLangs: string[]
    aiPrompt: string
  }
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
