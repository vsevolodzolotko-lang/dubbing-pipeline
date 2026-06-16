import { NavLink } from 'react-router-dom'

const DAILY = [
  { to: '/lesson', label: 'Урок', icon: '🎬' },
  { to: '/review', label: 'Перевірка', icon: '🔍' },
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
  return (
    <nav className="w-56 shrink-0 border-r border-gray-200 bg-white flex flex-col">
      <div className="px-4 py-4 text-lg font-semibold tracking-tight">Dubbing Studio</div>
      <Section title="Щоденна робота" items={DAILY} />
      <Section title="Налаштування" items={SETTINGS} warn />
      <div className="mt-auto px-4 py-3 text-xs">
        <NavLink to="/setup" className="text-gray-400 hover:text-gray-700">Доступи / діагностика</NavLink>
      </div>
    </nav>
  )
}

function Section({ title, items, warn }: { title: string; items: typeof DAILY; warn?: boolean }) {
  return (
    <div className="px-2 py-2">
      <div className={`px-2 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide ${warn ? 'text-amber-600' : 'text-gray-400'}`}>
        {title}
      </div>
      {items.map((it) => (
        <NavLink
          key={it.to}
          to={it.to}
          className={({ isActive }) =>
            `flex items-center gap-2 rounded-md px-3 py-2 text-sm ${
              isActive ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-100'
            }`}
        >
          <span>{it.icon}</span>
          <span>{it.label}</span>
        </NavLink>
      ))}
    </div>
  )
}
