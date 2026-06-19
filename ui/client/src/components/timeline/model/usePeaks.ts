import { useEffect, useState } from 'react'
import type { Peaks } from './types'

interface PeaksState {
  peaks: Peaks | null
  /** durationSec from the response — present even when peaks are unavailable. */
  peaksDurationSec: number
  unavailable: boolean
}

/**
 * Fetch render-only waveform peaks. The endpoint returns
 * `{ durationSec, detail, overview }` or `{ unavailable, durationSec }` — both
 * carry a usable duration, so the timeline can size correctly without a waveform.
 */
export function usePeaks(url: string): PeaksState {
  const [state, setState] = useState<PeaksState>({ peaks: null, peaksDurationSec: 0, unavailable: false })

  useEffect(() => {
    let alive = true
    setState({ peaks: null, peaksDurationSec: 0, unavailable: false })
    fetch(url)
      .then((r) => r.json())
      .then((d) => {
        if (!alive || !d) return
        const dur = Number(d.durationSec) || 0
        if (d.unavailable) setState({ peaks: null, peaksDurationSec: dur, unavailable: true })
        else if (Array.isArray(d.detail)) setState({ peaks: d as Peaks, peaksDurationSec: dur, unavailable: false })
      })
      .catch(() => { if (alive) setState({ peaks: null, peaksDurationSec: 0, unavailable: true }) })
    return () => { alive = false }
  }, [url])

  return state
}
