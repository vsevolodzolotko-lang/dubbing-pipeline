import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { RunState } from './types'

export interface RegenStatus {
  active: boolean
  stale?: boolean
  total?: number
  remaining?: number
  rowKeys?: string[]
  elapsedSec?: number
  justFinished?: boolean
  event?: 'done' | 'stale' | null
}

interface RunCtx {
  state: RunState | null
  connected: boolean
  regen: RegenStatus
  // Proactively pull the current run state + refetch all data — used right after a
  // project switch so the UI follows the active project even if the SSE stream is
  // momentarily stale (e.g. just after a server restart).
  refresh: () => void
}

const Ctx = createContext<RunCtx>({ state: null, connected: false, regen: { active: false }, refresh: () => {} })

/**
 * Single EventSource to /api/events. Holds the latest run state and invalidates
 * lesson/localization queries when rows change. The snapshot is authoritative,
 * so reconnect just re-receives a full `state`.
 */
export function RunStateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<RunState | null>(null)
  const [connected, setConnected] = useState(false)
  const [regen, setRegen] = useState<RegenStatus>({ active: false })
  const qc = useQueryClient()
  const esRef = useRef<EventSource | null>(null)

  // initial regen status (SSE pushes live updates, but a fresh tab/reload mid-regen needs it now)
  useEffect(() => {
    fetch('/api/regen/status').then((r) => r.json()).then((d) => { if (d) setRegen(d) }).catch(() => {})
  }, [])

  useEffect(() => {
    let closed = false
    function connect() {
      const es = new EventSource('/api/events')
      esRef.current = es
      es.addEventListener('open', () => setConnected(true))
      es.addEventListener('state', (e) => {
        try {
          setState(JSON.parse((e as MessageEvent).data))
          // A state push fires on staged transitions AND when the active project
          // switches (open/create → snapshot.onActiveChange resets the diff cache,
          // so `rows_changed` won't fire). Refresh ALL run-scoped data so the whole
          // UI follows the active project, not just the gate data sources.
          qc.invalidateQueries({ queryKey: ['lesson'] })
          qc.invalidateQueries({ queryKey: ['localizations'] })
          qc.invalidateQueries({ queryKey: ['segments'] })
          qc.invalidateQueries({ queryKey: ['translations'] })
          qc.invalidateQueries({ queryKey: ['projects'] })
          qc.invalidateQueries({ queryKey: ['tuning'] }) // refresh Tuning metrics on state change (incl. COMPLETE)
        } catch { /* ignore */ }
      })
      es.addEventListener('regen', (e) => {
        try { setRegen(JSON.parse((e as MessageEvent).data)) } catch { /* ignore */ }
      })
      es.addEventListener('rows_changed', () => {
        qc.invalidateQueries({ queryKey: ['lesson'] })
        qc.invalidateQueries({ queryKey: ['localizations'] })
      })
      es.addEventListener('error', () => {
        setConnected(false)
        es.close()
        if (!closed) setTimeout(connect, 3000) // browser also retries, belt-and-suspenders
      })
    }
    connect()
    return () => { closed = true; esRef.current?.close() }
  }, [qc])

  const refresh = useCallback(() => {
    fetch('/api/state').then((r) => r.json()).then((d) => { if (d) setState(d) }).catch(() => {})
    qc.invalidateQueries() // refetch every run-scoped query for the (possibly new) active project
  }, [qc])

  return <Ctx.Provider value={{ state, connected, regen, refresh }}>{children}</Ctx.Provider>
}

export function useRunState() {
  return useContext(Ctx)
}
