import { fetchJson, postJson } from './client'

export type Gate = 'transcript' | 'translations' | 'audio'

export interface Word { word: string; punctuated_word: string; start: number; end: number }

// ── staged lifecycle ────────────────────────────────────────────────────────
export const startStagedRun = (lessonId?: string) =>
  postJson<{ ok: boolean; lessonId?: string; error?: string }>('/api/staged/start', { lessonId })

export const approveGate = (gate: Gate) =>
  postJson<{ ok: boolean; stage?: string; status?: string; error?: string }>(`/api/approve/${gate}`, {})

export const probeSecondDrop = () =>
  postJson<{ ok: boolean; busy: boolean; error?: string }>('/api/staged/second-drop', {})

// ── transcript stage ──────────────────────────────────────────────────────
export const saveTranscript = (rows: { segmentId: string; enText: string }[]) =>
  postJson<{ ok: boolean; written: number }>('/api/transcript', { rows })

export const mergeSegment = (segmentId: string) =>
  postJson<{ ok: boolean; segments: number }>('/api/segments/merge', { segmentId })

export const splitSegment = (segmentId: string, wordIndex: number) =>
  postJson<{ ok: boolean; segments: number }>('/api/segments/split', { segmentId, wordIndex })

export const fetchWords = (segmentId: string) =>
  fetchJson<{ segmentId: string; words: Word[] }>(`/api/segments/${segmentId}/words`)

// ── translation stage ──────────────────────────────────────────────────────
export const saveTranslations = (rows: { segmentId: string; lang: string; text: string }[]) =>
  postJson<{ ok: boolean; written: number }>('/api/translations', { rows })

// "Перевірити AI" — batch LLM check of selected segments for ONE language.
export interface CheckResult { segment_id: string; ok: boolean; comment: string; suggestion: string | null }
export interface CheckReport { lang: string; generatedAt: string; mode: string; count: number; results: CheckResult[] }
export const checkTranslations = (lang: string, segmentIds: string[]) =>
  postJson<CheckReport>('/api/translation-check', { lang, segmentIds })

// Editable prompt that drives the AI translation check ({{lang}} placeholder).
export const getTranslationPrompt = () =>
  fetchJson<{ value: string; default: string; editable: boolean }>('/api/translation-prompt')
export const saveTranslationPrompt = (value: string) =>
  postJson<{ ok: boolean }>('/api/translation-prompt', { value })
