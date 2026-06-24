import { useMemo } from 'react'
import type { Word } from '../../api/staged'

/** Faint marks at word boundaries of the active segment — the snap affordance. */
export function WordTicks({ words, timeToX }: { words: Word[]; timeToX: (t: number) => number }) {
  const bounds = useMemo(() => {
    const s = new Set<number>()
    for (const w of words) { s.add(w.start); s.add(w.end) }
    return [...s]
  }, [words])
  if (!bounds.length) return null
  return (
    <>
      {bounds.map((b, i) => (
        <div key={i} aria-hidden style={{ transform: `translateX(${timeToX(b)}px)` }}
          className="pointer-events-none absolute top-0 bottom-0 left-0 z-0 w-px bg-blue-400/25" />
      ))}
    </>
  )
}
