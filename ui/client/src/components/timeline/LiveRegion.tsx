import { forwardRef, useImperativeHandle, useRef } from 'react'

export interface LiveRegionHandle { announce: (msg: string) => void }

/**
 * Polite screen-reader announcer. Updated imperatively (textContent) so frequent
 * announcements during nudge/commit don't re-render the editor tree.
 */
export const LiveRegion = forwardRef<LiveRegionHandle>(function LiveRegion(_props, ref) {
  const elRef = useRef<HTMLDivElement>(null)
  useImperativeHandle(ref, () => ({
    announce: (msg: string) => { if (elRef.current) elRef.current.textContent = msg },
  }))
  return <div ref={elRef} aria-live="polite" aria-atomic="true" className="sr-only" />
})
