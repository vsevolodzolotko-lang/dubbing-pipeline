import { useQuery } from '@tanstack/react-query'
import { fetchJson } from './client'
import type { Lesson, SetupStatus } from './types'

export function useLesson() {
  return useQuery({ queryKey: ['lesson'], queryFn: () => fetchJson<Lesson>('/api/lesson') })
}

export function useSetupStatus() {
  return useQuery({ queryKey: ['setup'], queryFn: () => fetchJson<SetupStatus>('/api/setup/status') })
}
