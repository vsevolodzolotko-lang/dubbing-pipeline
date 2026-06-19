import { NavLink } from 'react-router-dom'
import {
  House, PenLine, Languages, AudioLines, Combine, Sparkles,
  Mic, MessageSquareText, Gauge, Settings, Archive, Activity,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useRunState } from '../api/useRunState'
import { currentStage, STAGES } from '../ui'

interface NavItem { to: string; label: string; icon: LucideIcon }

const DAILY: NavItem[] = [
  { to: '/lesson', label: 'Урок', icon: House },
  { to: '/transcript', label: 'Транскрипт', icon: PenLine },
  { to: '/translation', label: 'Переклад', icon: Languages },
  { to: '/review', label: 'Аудіо', icon: AudioLines },
  { to: '/render', label: 'Склейка', icon: Combine },
  { to: '/qa', label: 'AI-аналіз', icon: Sparkles },
]

const SETTINGS: NavItem[] = [
  { to: '/voices', label: 'Голоси', icon: Mic },
  { to: '/prompts', label: 'Промпти', icon: MessageSquareText },
  { to: '/cps', label: 'Калібрування CPS', icon: Gauge },
  { to: '/config', label: 'Конфігурація', icon: Settings },
  { to: '/archive', label: 'Архів', icon: Archive },
]

export function Sidebar() {
  const { state } = useRunState()
  // Route of the gate currently awaiting the operator (amber dot).
  const cur = state?.staged ? currentStage(state.state) : null
  const gateRoute = cur?.phase === 'gate' ? STAGES[cur.index]?.route : null

  return (
    <nav className="flex w-56 shrink-0 flex-col border-r border-gray-200 bg-white dark:border-[#29292c] dark:bg-[#161617]">
      <div className="px-4 py-4 font-serif text-lg font-semibold tracking-tight text-gray-900 dark:text-gray-100">Localization Studio</div>
      <Section title="Щоденна робота" items={DAILY} gateRoute={gateRoute} />
      <Section title="Налаштування" items={SETTINGS} warn />
      <div className="mt-auto px-2 py-3">
        <NavLink to="/setup"
          className={({ isActive }) =>
            `flex items-center gap-2.5 rounded-md px-3 py-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 ${
              isActive ? 'text-gray-700 dark:text-gray-200' : 'text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-300'
            }`}>
          <Activity className="h-4 w-4 shrink-0" strokeWidth={1.75} />
          <span>Доступи / діагностика</span>
        </NavLink>
      </div>
    </nav>
  )
}

function Section({ title, items, warn, gateRoute }: { title: string; items: NavItem[]; warn?: boolean; gateRoute?: string | null }) {
  return (
    <div className="px-2 py-2">
      <div className={`px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide ${warn ? 'text-amber-600 dark:text-amber-500' : 'text-gray-400'}`}>
        {title}
      </div>
      {items.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            `flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 ${
              isActive
                ? 'bg-gray-100 font-medium text-gray-900 dark:bg-[#202023] dark:text-white'
                : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-[#202023] dark:hover:text-gray-200'
            }`}
        >
          {({ isActive }) => (
            <>
              <Icon className={`h-[18px] w-[18px] shrink-0 ${isActive ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-gray-500'}`} strokeWidth={1.75} />
              <span>{label}</span>
              {gateRoute === to && (
                <span className="ml-auto h-2 w-2 animate-pulse rounded-full bg-amber-400" title="чекає на твоє підтвердження" />
              )}
            </>
          )}
        </NavLink>
      ))}
    </div>
  )
}
