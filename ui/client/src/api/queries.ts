import { useQuery } from '@tanstack/react-query'
import { fetchJson } from './client'
import { listProjects } from './projects'
import { getTuningReport, listTuningRuns, getTuningTrend, getTuningAdvice } from './tuning'
import type { ArchiveRunSummary, Lesson, RawSegment, SetupStatus } from './types'

export function useProjects() {
  // Poll so the dashboard board reflects projects advancing in the background
  // (SSE only pushes the active project's state changes).
  return useQuery({ queryKey: ['projects'], queryFn: listProjects, refetchInterval: 5000 })
}

export function useArchive() {
  return useQuery({
    queryKey: ['archive'],
    queryFn: () => fetchJson<{ rows: ArchiveRunSummary[] }>('/api/archive'),
  })
}

export function useLesson() {
  return useQuery({ queryKey: ['lesson'], queryFn: () => fetchJson<Lesson>('/api/lesson') })
}

export function useSegments() {
  return useQuery({
    queryKey: ['segments'],
    queryFn: () => fetchJson<{ rows: RawSegment[] }>('/api/segments'),
  })
}

export function useSetupStatus() {
  return useQuery({ queryKey: ['setup'], queryFn: () => fetchJson<SetupStatus>('/api/setup/status') })
}

// ── Tuning tab ───────────────────────────────────────────────────────────────
export function useTuningReport(runId?: string) {
  return useQuery({ queryKey: ['tuning', 'report', runId ?? 'latest'], queryFn: () => getTuningReport(runId) })
}
export function useTuningRuns() {
  return useQuery({ queryKey: ['tuning', 'runs'], queryFn: listTuningRuns })
}
export function useTuningTrend(metric: string, lessonId?: string) {
  return useQuery({ queryKey: ['tuning', 'trend', metric, lessonId ?? 'all'], queryFn: () => getTuningTrend(metric, lessonId) })
}
export function useTuningAdvice() {
  return useQuery({ queryKey: ['tuning', 'advice'], queryFn: getTuningAdvice })
}
