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

// One independent audio piece on a language's timeline lane. A localization starts
// as a single clip spanning its slot; the operator can cut it into pieces and
// move/trim/fade/delete each. `src*` track which slice of the source audio a piece
// plays (seconds, 1:1) so playback + waveform stay accurate after edits.
export interface Clip {
  id: string
  start: number
  end: number
  srcStart: number
  srcEnd: number
  sourceDur: number
  fadeIn: number
  fadeOut: number
}

export interface Cell {
  present: boolean
  rowKey?: string
  lang?: string
  status: 'TRUE' | 'FALSE' | 'REVIEW' | 'MISSING'
  needsRetts?: boolean
  textTranslated?: string
  // Per-language dub slot on the timeline (independent of the shared EN slot).
  slotStart?: number | null
  slotEnd?: number | null
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
  // Per-language dub fade envelope (seconds at the clip start/end).
  fadeIn?: number | null
  fadeOut?: number | null
  // Independent audio clips on the timeline lane (always ≥1; default = whole slot).
  clips?: Clip[]
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

// ── Tuning tab (text-quality intelligence) ──────────────────────────────────
export type CpsConfidence = 'HIGH' | 'MED' | 'LOW'
export type RecConfidence = 'high' | 'medium' | 'low'

export interface LangQuality {
  lang: string
  cells: number
  score: number
  cps: {
    observed: number | null
    configured: number | null
    recommend: number | null
    delta: number | null
    confidence: CpsConfidence
    sampleSize: number
    baseSpeed: number | null
    baseSpeedSource: 'voices' | 'mode' | null
  }
  adaptation: { avgAttempts: number; maxAttempts: number; saturationRate: number }
  speed: { hist: Record<string, number>; meanFinalSpeed: number | null; speedUpRate: number; slowDownRate: number }
  borrow: { meanSec: number; maxSec: number; capHitRate: number }
  phase2: Record<string, number>
  attention: { trueRate: number; reviewRate: number; trueCount: number; reviewCount: number }
  regen: { rate: number; count: number; reasons: Record<string, number> }
  qa: { rate: number; count: number; byType: Record<string, number>; bySeverity: Record<string, number> }
}

export interface TypeQuality {
  type: string
  cells: number
  observedCps: number | null
  attentionTrueRate: number
  speedUpRate: number
}

export interface LangTypeCps {
  lang: string
  type: string
  n: number
  observedCps: number | null
  driftVsLangMean: number | null
}

export interface CpsDeltaHint {
  key: string; lang: string; current: number | null; recommend: number | null
  delta: number; confidence: CpsConfidence; sampleSize: number
}

export interface RunQualityReport {
  schema: number
  generatedAt: string | null
  lessonId: string | null
  runToken: string | null
  mode: 'mock' | 'live'
  langs: string[]
  segmentTypes: string[]
  totals: { segments: number; cells: number; attentionTrue: number; langs: number }
  perLang: Record<string, LangQuality>
  perType: Record<string, TypeQuality>
  perLangType: Record<string, LangTypeCps>
  recommendationsHint: { cpsDeltas: CpsDeltaHint[] }
  config: Record<string, string>
}

export interface Evidence { metric: string; value: string | number; sampleSize?: number }

export interface ConfigRecommendation {
  key: string; scope: 'global' | 'lang'; lang?: string
  current: string; proposed: string; confidence: RecConfidence
  rationale: string; expectedEffect?: string; evidence: Evidence[]
}
export interface VoiceRecommendation {
  lang: string; field: 'speed' | 'stability' | 'similarity_boost' | 'style'
  current: string; proposed: string; confidence: RecConfidence
  rationale: string; evidence: Evidence[]
}
export interface PromptRecommendation {
  promptKey: string; failurePattern: string; confidence: RecConfidence; rationale: string
  evidence: Evidence[]
  proposedEdit: { mode: 'rewrite' | 'patch'; rewrite?: string; patch?: { find: string; replace: string } } | null
}
export interface RecommendationSet {
  schema?: number
  generatedAt: string | null
  model?: string | null
  lessonId?: string | null
  runToken?: string | null
  summary?: string
  configRecommendations: ConfigRecommendation[]
  voiceRecommendations: VoiceRecommendation[]
  promptRecommendations: PromptRecommendation[]
}

export interface TuningRunSummary {
  id: string; lessonId: string | null; runToken: string | null; finishedAt: string | null
  mode: 'mock' | 'live'; langs: string[]; score: number | null
  attTrueRate: number; regenRate: number; cpsDeltaMax: number
}
export interface TuningTrend {
  metric: string
  points: { id: string; lessonId: string | null; finishedAt: string | null; value: number | null }[]
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
