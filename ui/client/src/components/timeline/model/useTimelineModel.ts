import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { RawSegment } from '../../../api/types'
import { retimeSegment } from '../../../api/staged'
import { ms } from '../lib/time'
import { segmentsSignature, toTSegments, type HistoryEntry, type TSegment, type Times } from './types'

function seed(tsegs: TSegment[]): Record<string, Times> {
  const o: Record<string, Times> = {}
  for (const s of tsegs) o[s.id] = { start: s.startSec, end: s.endSec }
  return o
}

interface State {
  work: Record<string, Times>
  history: HistoryEntry[]
  cursor: number
  sig: string
  ids: string
}

type Action =
  | { t: 'seed'; work: Record<string, Times>; sig: string; ids: string; clearHistory: boolean }
  | { t: 'apply'; id: string; next: Times; prev: Times; record: boolean }
  | { t: 'adopt'; id: string; times: Times; patch: boolean }
  | { t: 'revert'; id: string; prev: Times; popRecorded: boolean }
  | { t: 'cursor'; id: string; times: Times; delta: number }

function reducer(s: State, a: Action): State {
  switch (a.t) {
    case 'seed':
      return {
        work: a.work, sig: a.sig, ids: a.ids,
        history: a.clearHistory ? [] : s.history,
        cursor: a.clearHistory ? -1 : s.cursor,
      }
    case 'apply': {
      const work = { ...s.work, [a.id]: a.next }
      if (!a.record) return { ...s, work }
      const history = s.history.slice(0, s.cursor + 1)
      history.push({ id: a.id, prev: a.prev, next: a.next })
      return { ...s, work, history, cursor: history.length - 1 }
    }
    case 'adopt': {
      const work = { ...s.work, [a.id]: a.times }
      if (a.patch && s.cursor >= 0 && s.history[s.cursor]?.id === a.id) {
        const history = s.history.slice()
        history[s.cursor] = { ...history[s.cursor], next: a.times }
        return { ...s, work, history }
      }
      return { ...s, work }
    }
    case 'revert': {
      const work = { ...s.work, [a.id]: a.prev }
      if (!a.popRecorded) return { ...s, work }
      const history = s.history.slice(0, s.cursor)
      return { ...s, work, history, cursor: history.length - 1 }
    }
    case 'cursor':
      return { ...s, work: { ...s.work, [a.id]: a.times }, cursor: s.cursor + a.delta }
  }
}

/**
 * Canonical editing model. Holds a local working copy of segment times seeded
 * from props; persists every committed change to the server via `retimeSegment`
 * then triggers `onRetimed()` (React Query invalidation). The `editing` ref gates
 * re-seeding so a refetch never clobbers an in-flight edit; history is cleared
 * only on a structural change (merge/split renumber).
 */
type PersistFn = (id: string, startSec: number, endSec: number) => Promise<{ ok: boolean; enStart?: number; enEnd?: number; error?: string }>

/**
 * @param persist How a committed time is written to the server. Defaults to the
 *   per-segment EN-slot retime (transcript gate); the audio gate passes a
 *   per-language slot retime so each language moves independently.
 */
export function useTimelineModel(segments: RawSegment[], onRetimed: () => void, persist?: PersistFn) {
  const tsegs = useMemo(() => toTSegments(segments), [segments])

  const [state, dispatch] = useReducer(reducer, undefined, () => ({
    work: seed(tsegs),
    history: [],
    cursor: -1,
    sig: segmentsSignature(segments),
    ids: tsegs.map((s) => s.id).join(','),
  }))
  const stateRef = useRef(state)
  stateRef.current = state

  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<Record<string, boolean>>({})
  const editingRef = useRef(false)

  // Reconcile on new props — never mid-edit; no-op on an identical signature.
  useEffect(() => {
    if (editingRef.current) return
    const sig = segmentsSignature(segments)
    if (sig === stateRef.current.sig) return
    const ids = tsegs.map((s) => s.id).join(',')
    dispatch({ t: 'seed', work: seed(tsegs), sig, ids, clearHistory: ids !== stateRef.current.ids })
  }, [segments, tsegs])

  const getTimes = useCallback((id: string): Times => {
    return stateRef.current.work[id] ?? { start: 0, end: 0 }
  }, [])

  // Round-trip a time to the server; adopt server's (possibly re-clamped) value.
  const persistRef = useRef(persist)
  persistRef.current = persist
  const persistServer = useCallback(async (id: string, next: Times, patchHistory: boolean): Promise<boolean> => {
    setPending((p) => ({ ...p, [id]: true }))
    try {
      const doPersist = persistRef.current ?? ((segId: string, s: number, e: number) => retimeSegment(segId, s, e))
      const r = await doPersist(id, ms(next.start), ms(next.end))
      if (!r.ok) { setError(r.error || 'Failed to change timing'); return false }
      if (r.enStart != null && r.enEnd != null) {
        dispatch({ t: 'adopt', id, times: { start: r.enStart, end: r.enEnd }, patch: patchHistory })
      }
      return true
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg.includes('409') ? 'Retime is unavailable in live mode' : 'Retime error')
      return false
    } finally {
      setPending((p) => { const n = { ...p }; delete n[id]; return n })
    }
  }, [])

  // Commit a finished gesture (drag/nudge): optimistic apply + one history entry + persist.
  const commit = useCallback(async (id: string, next: Times) => {
    const prev = stateRef.current.work[id]
    if (!prev || (prev.start === next.start && prev.end === next.end)) { editingRef.current = false; return }
    setError(null)
    editingRef.current = true
    dispatch({ t: 'apply', id, next, prev, record: true })
    const ok = await persistServer(id, next, true)
    if (!ok) dispatch({ t: 'revert', id, prev, popRecorded: true })
    editingRef.current = false
    onRetimed()
  }, [persistServer, onRetimed])

  const undo = useCallback(async () => {
    const s = stateRef.current
    if (s.cursor < 0) return
    const e = s.history[s.cursor]
    setError(null)
    editingRef.current = true
    dispatch({ t: 'cursor', id: e.id, times: e.prev, delta: -1 })
    const ok = await persistServer(e.id, e.prev, false)
    if (!ok) dispatch({ t: 'cursor', id: e.id, times: e.next, delta: +1 }) // server rejected → undo the undo
    editingRef.current = false
    onRetimed()
  }, [persistServer, onRetimed])

  const redo = useCallback(async () => {
    const s = stateRef.current
    if (s.cursor >= s.history.length - 1) return
    const e = s.history[s.cursor + 1]
    setError(null)
    editingRef.current = true
    dispatch({ t: 'cursor', id: e.id, times: e.next, delta: +1 })
    const ok = await persistServer(e.id, e.next, false)
    if (!ok) dispatch({ t: 'cursor', id: e.id, times: e.prev, delta: -1 }) // server rejected → undo the redo
    editingRef.current = false
    onRetimed()
  }, [persistServer, onRetimed])

  /** Gate reconcile while a pointer drag is live (before the commit fires). */
  const setDragging = useCallback((b: boolean) => { editingRef.current = b }, [])

  return {
    tsegs,
    getTimes,
    commit,
    undo,
    redo,
    setDragging,
    canUndo: state.cursor >= 0,
    canRedo: state.cursor < state.history.length - 1,
    isPending: (id: string) => Boolean(pending[id]),
    busy: Object.keys(pending).length > 0,
    error,
    clearError: () => setError(null),
    // version bumps whenever committed times change → lets the lane re-read getTimes
    version: state.work,
  }
}

export type TimelineModel = ReturnType<typeof useTimelineModel>
