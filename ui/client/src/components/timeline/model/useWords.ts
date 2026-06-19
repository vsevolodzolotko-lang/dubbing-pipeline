import { useCallback, useMemo, useRef, useState } from 'react'
import { fetchWords, type Word } from '../../../api/staged'

/**
 * Lazy per-segment word-boundary cache for snap. Words are heuristic in mock and
 * 409 in live mode → on 409 snapping is silently disabled (drag still works).
 * Evict a segment after a retime so the next drag refetches fresh boundaries.
 */
export function useWords() {
  const cache = useRef<Map<string, Word[]>>(new Map())
  const [snapDisabled, setSnapDisabled] = useState(false)

  const get = useCallback(async (id: string): Promise<Word[]> => {
    const hit = cache.current.get(id)
    if (hit) return hit
    try {
      const r = await fetchWords(id)
      cache.current.set(id, r.words)
      return r.words
    } catch (e) {
      if (e instanceof Error && e.message.includes('409')) setSnapDisabled(true)
      cache.current.set(id, [])
      return []
    }
  }, [])

  const peek = useCallback((id: string) => cache.current.get(id) ?? null, [])
  const evict = useCallback((id: string) => { cache.current.delete(id) }, [])

  // Stable identity (changes only when snapDisabled flips) — consumers use this
  // in effect deps, so an unstable object would cause render loops.
  return useMemo(() => ({ get, peek, evict, snapDisabled }), [get, peek, evict, snapDisabled])
}
