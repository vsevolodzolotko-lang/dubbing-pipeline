import { useEffect, useState } from 'react'
import { Sun, Moon, Monitor } from 'lucide-react'

type Theme = 'light' | 'dark' | 'system'

function apply(theme: Theme) {
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
}

/** Cycles light → dark → system, persisted in localStorage. The initial class
 *  is set pre-paint by the inline script in index.html (no flash). */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('theme') as Theme) || 'system')

  useEffect(() => {
    localStorage.setItem('theme', theme)
    apply(theme)
    if (theme !== 'system') return
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const h = () => apply('system')
    mq.addEventListener('change', h)
    return () => mq.removeEventListener('change', h)
  }, [theme])

  const cycle = () => setTheme((t) => (t === 'light' ? 'dark' : t === 'dark' ? 'system' : 'light'))
  const Icon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor
  const label = theme === 'light' ? 'Light' : theme === 'dark' ? 'Dark' : 'System'

  return (
    <button onClick={cycle} title={`Theme: ${label} — click to change`}
      className="rounded px-1.5 py-1 text-sm hover:bg-gray-100 dark:hover:bg-[#202023]">
      <Icon className="h-4 w-4" strokeWidth={1.75} />
    </button>
  )
}
