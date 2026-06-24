import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import {
  PenLine, Languages, AudioLines, Download, Sparkles,
  Mic, MessageSquareText, SlidersHorizontal, Settings, Activity, FolderOpen,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useRunState } from '../api/useRunState'
import { useProjects } from '../api/queries'
import { openProject } from '../api/projects'
import { currentStage, STAGES } from '../ui'

interface NavItem { to: string; label: string; icon: LucideIcon }

const DAILY: NavItem[] = [
  { to: '/projects', label: 'Projects', icon: FolderOpen },
  { to: '/transcript', label: 'Transcript', icon: PenLine },
  { to: '/translation', label: 'Translation', icon: Languages },
  { to: '/qa', label: 'AI analysis', icon: Sparkles },
  { to: '/review', label: 'Audio', icon: AudioLines },
  { to: '/render', label: 'Export', icon: Download },
]

const SETTINGS: NavItem[] = [
  { to: '/voices', label: 'Voices', icon: Mic },
  { to: '/prompts', label: 'Prompts', icon: MessageSquareText },
  { to: '/cps', label: 'Tuning', icon: SlidersHorizontal },
  { to: '/config', label: 'Configuration', icon: Settings },
]

export function Sidebar() {
  const { state } = useRunState()
  // Route of the gate currently awaiting the operator (amber dot).
  const cur = state?.staged ? currentStage(state.state) : null
  const gateRoute = cur?.phase === 'gate' ? STAGES[cur.index]?.route : null

  return (
    <nav className="flex w-56 shrink-0 flex-col border-r border-gray-200 bg-white dark:border-[#29292c] dark:bg-[#161617]">
      <div className="px-4 py-4 font-serif text-lg font-semibold tracking-tight text-gray-900 dark:text-gray-100">Localization Studio</div>
      <ProjectSwitcher />
      <Section title="Daily" items={DAILY} gateRoute={gateRoute} />
      <Section title="Settings" items={SETTINGS} warn />
      <div className="mt-auto px-2 py-3">
        <NavLink to="/setup"
          className={({ isActive }) =>
            `flex items-center gap-2.5 rounded-md px-3 py-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 ${
              isActive ? 'text-gray-700 dark:text-gray-200' : 'text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-300'
            }`}>
          <Activity className="h-4 w-4 shrink-0" strokeWidth={1.75} />
          <span>Access / diagnostics</span>
        </NavLink>
      </div>
    </nav>
  )
}

// Quick active-project switch. Changing the selection re-points the active project
// and refreshes the run state + data so every screen follows it immediately.
function ProjectSwitcher() {
  const { data } = useProjects()
  const { refresh } = useRunState()
  const [busy, setBusy] = useState(false)
  const projects = data?.rows ?? []
  const activeId = data?.activeId ?? ''
  if (!projects.length) return null

  async function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const id = e.target.value
    if (!id || id === activeId) return
    setBusy(true)
    try { await openProject(id); refresh() }
    catch { /* ignore — switcher is best-effort */ }
    finally { setBusy(false) }
  }

  return (
    <div className="px-3 pb-1">
      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-gray-400">Active project</label>
      <select value={activeId} disabled={busy} onChange={onChange}
        className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 disabled:opacity-50 dark:border-[#3a3a3d] dark:bg-[#161617] dark:text-gray-200">
        {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    </div>
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
                <span className="ml-auto h-2 w-2 animate-pulse rounded-full bg-amber-400" title="awaiting your approval" />
              )}
            </>
          )}
        </NavLink>
      ))}
    </div>
  )
}
