import { fetchJson, postJson } from './client'

export type Gate = 'transcript' | 'translations' | 'audio'

export interface Word { word: string; punctuated_word: string; start: number; end: number }

// ── staged lifecycle ────────────────────────────────────────────────────────
export const startStagedRun = (lessonId?: string, langs?: string[]) =>
  postJson<{ ok: boolean; lessonId?: string; langs?: string[]; error?: string }>('/api/staged/start', { lessonId, langs })

// Apply a past run's settings snapshot to live config/voices/prompt before start.
export const applyArchiveSettings = (id: string) =>
  postJson<{ ok: boolean; activeLangs?: string[]; error?: string }>(`/api/archive/${id}/apply`, {})

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

// ── voice presets / templates (local library) ───────────────────────────────
export interface VoicePreset {
  id: string; name: string; createdAt?: string
  voice_id?: string; voice_name?: string; model?: string
  stability?: string; similarity_boost?: string; style?: string; speed?: string
}
export interface VoiceSet { id: string; name: string; createdAt?: string; voices: (VoicePreset & { lang: string })[] }

export const fetchPresets = () => fetchJson<{ voices: VoicePreset[]; sets: VoiceSet[] }>('/api/presets')

const VOICE_FIELDS = ['voice_id', 'voice_name', 'model', 'stability', 'similarity_boost', 'style', 'speed'] as const
function pickVoiceFields(src: VoicePreset): Record<string, string> {
  const o: Record<string, string> = {}
  for (const k of VOICE_FIELDS) { const val = src[k]; if (val != null && val !== '') o[k] = String(val) }
  return o
}

// Apply a saved voice SET to the live voices tab (one batch, each lang's fields).
export const applyVoiceSet = (voices: (VoicePreset & { lang: string })[]) =>
  postJson<{ ok: boolean; applied?: number; error?: string }>('/api/voices/apply-set', {
    voices: voices.map((v) => ({ lang: v.lang, fields: pickVoiceFields(v) })),
  })

// Editable prompt that drives the AI translation check ({{lang}} placeholder).
export const getTranslationPrompt = () =>
  fetchJson<{ value: string; default: string; editable: boolean }>('/api/translation-prompt')
export const saveTranslationPrompt = (value: string) =>
  postJson<{ ok: boolean }>('/api/translation-prompt', { value })
