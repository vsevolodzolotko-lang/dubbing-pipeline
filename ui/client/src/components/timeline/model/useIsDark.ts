import { useEffect, useState } from 'react'

/** Reactive flag for the class-based dark mode (<html class="dark">), so canvas
 *  layers repaint with the right colours when the theme is toggled. */
export function useIsDark(): boolean {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  useEffect(() => {
    const el = document.documentElement
    const obs = new MutationObserver(() => setDark(el.classList.contains('dark')))
    obs.observe(el, { attributes: true, attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [])
  return dark
}
