import { fetchJson, postJson } from './client'

// Pipeline prompt templates (the `prompts` tab in live; per-project overrides in mock).
export interface PromptRow { key: string; group?: string; description: string; length: number; edited?: boolean }
export interface PromptDetail { key: string; group?: string; description: string; value: string; default?: string; edited?: boolean }

export const listPrompts = () => fetchJson<{ rows: PromptRow[] }>('/api/prompts')
export const getPromptDetail = (key: string) => fetchJson<PromptDetail>(`/api/prompts/${encodeURIComponent(key)}`)
export const savePrompt = (key: string, value: string) =>
  postJson<{ ok: boolean; error?: string }>(`/api/prompts/${encodeURIComponent(key)}`, { value })
