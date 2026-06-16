import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
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
}

const Ctx = createContext<RunCtx>({ state: null, connected: false, regen: { active: false } })

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
        try { setState(JSON.parse((e as MessageEvent).data)) } catch { /* ignore */ }
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

  return <Ctx.Provider value={{ state, connected, regen }}>{children}</Ctx.Provider>
}

export function useRunState() {
  return useContext(Ctx)
}
