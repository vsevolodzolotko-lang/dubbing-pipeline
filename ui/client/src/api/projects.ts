import { fetchJson, postJson } from './client'

export type ProjectStatus = 'new' | 'in_progress' | 'review' | 'done' | 'stopped'

export interface ProjectSummary {
  segCount: number
  langCount: number
  langs: string[]
  needsAttention: { count: number; total: number; pct: number }
}

export interface Project {
  id: string
  name: string
  sourceFileName: string
  templateId: string | null
  spreadsheetId: string
  schemaVersion: number
  folders: { input: string; segmentOutput: string; full: string; vtt: string }
  status: ProjectStatus
  createdAt: string
  updatedAt: string
  summary: ProjectSummary
  // Real-time run state (mock-derived; null in live until Фаза 6). RUN_STATES string.
  liveState?: string | null
}

export const listProjects = () => fetchJson<{ rows: Project[]; activeId: string | null }>('/api/projects')

export const getProject = (id: string) => fetchJson<Project>(`/api/projects/${id}`)

export const createProject = (name: string, sourceFileName: string, langs: string[]) =>
  postJson<{ ok: boolean; project?: Project; run?: { ok: boolean; error?: string }; error?: string }>(
    '/api/projects', { name, sourceFileName, langs })

export const openProject = (id: string) =>
  postJson<{ ok: boolean; project?: Project; error?: string }>(`/api/projects/${id}/open`, {})

// Shared "start as project" used by both the Projects screen and the Dashboard
// dropzone: create the project (which seeds + starts the staged run) and normalize
// the result to PreflightSetup's { ok, error } contract.
export async function startAsProject(name: string, sourceFileName: string, langs: string[]): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await createProject(name, sourceFileName, langs)
    return { ok: !!res.ok, error: res.error || res.run?.error }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'failed to create project' }
  }
}
