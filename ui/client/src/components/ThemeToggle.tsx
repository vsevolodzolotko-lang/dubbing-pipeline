import { useEffect, useState } from 'react'

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
  const icon = theme === 'light' ? '☀️' : theme === 'dark' ? '🌙' : '🖥️'
  const label = theme === 'light' ? 'Світла' : theme === 'dark' ? 'Темна' : 'Системна'

  return (
    <button onClick={cycle} title={`Тема: ${label} — клік щоб змінити`}
      className="rounded px-1.5 py-1 text-sm hover:bg-gray-100 dark:hover:bg-[#262019]">
      {icon}
    </button>
  )
}
