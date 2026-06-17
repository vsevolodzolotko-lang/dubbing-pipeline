import { NavLink } from 'react-router-dom'
import { useRunState } from '../api/useRunState'
import { currentStage, STAGES } from '../ui'

const DAILY = [
  { to: '/lesson', label: 'Урок', icon: '🎬' },
  { to: '/transcript', label: 'Транскрипт', icon: '✍️' },
  { to: '/translation', label: 'Переклад', icon: '🌐' },
  { to: '/review', label: 'Аудіо', icon: '🔊' },
  { to: '/qa', label: 'AI-аналіз', icon: '🤖' },
]

const SETTINGS = [
  { to: '/voices', label: 'Голоси', icon: '🎙️' },
  { to: '/prompts', label: 'Промпти', icon: '📝' },
  { to: '/cps', label: 'Калібрування CPS', icon: '📏' },
  { to: '/config', label: 'Конфігурація', icon: '⚙️' },
  { to: '/archive', label: 'Архів', icon: '🗄️' },
]

export function Sidebar() {
  const { state } = useRunState()
  // Route of the gate currently awaiting the operator (amber dot).
  const cur = state?.staged ? currentStage(state.state) : null
  const gateRoute = cur?.phase === 'gate' ? STAGES[cur.index]?.route : null

  return (
    <nav className="w-56 shrink-0 border-r border-gray-200 bg-white flex flex-col dark:border-[#332b22] dark:bg-[#1c1814]">
      <div className="px-4 py-4 text-lg font-semibold tracking-tight text-gray-900 dark:text-gray-100">Localization Studio</div>
      <Section title="Щоденна робота" items={DAILY} gateRoute={gateRoute} />
      <Section title="Налаштування" items={SETTINGS} warn />
      <div className="mt-auto px-4 py-3 text-xs">
        <NavLink to="/setup" className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">Доступи / діагностика</NavLink>
      </div>
    </nav>
  )
}

function Section({ title, items, warn, gateRoute }: { title: string; items: typeof DAILY; warn?: boolean; gateRoute?: string | null }) {
  return (
    <div className="px-2 py-2">
      <div className={`px-2 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide ${warn ? 'text-amber-600 dark:text-amber-500' : 'text-gray-400'}`}>
        {title}
      </div>
      {items.map((it) => (
        <NavLink
          key={it.to}
          to={it.to}
          className={({ isActive }) =>
            `flex items-center gap-2 rounded-md px-3 py-2 text-sm ${
              isActive ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900' : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-[#262019]'
            }`}
        >
          <span>{it.icon}</span>
          <span>{it.label}</span>
          {gateRoute === it.to && (
            <span className="ml-auto h-2 w-2 animate-pulse rounded-full bg-amber-400" title="чекає на твоє підтвердження" />
          )}
        </NavLink>
      ))}
    </div>
  )
}
