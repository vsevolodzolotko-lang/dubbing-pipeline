import { NavLink } from 'react-router-dom'
import { ArrowRight, Check, Hand, Play } from 'lucide-react'
import { useRunState } from '../api/useRunState'
import { STAGES, currentStage } from '../ui'

/**
 * Horizontal 3-gate spine for the staged flow, shown under the Header. Each gate
 * is ✓ done / ▶ running / ✋ awaiting-you / · todo. Clickable to jump to the
 * review surface; the gate awaiting the operator pulses amber. Hidden for the
 * legacy auto-flow (non-staged runs).
 */
export function StageRail() {
  const { state } = useRunState()
  if (!state?.staged) return null
  const cur = currentStage(state.state)
  const curIdx = cur ? cur.index : -1
  const done = state.state === 'COMPLETE'

  return (
    <div className="flex items-center gap-2 border-b border-gray-200 bg-gray-50 px-5 py-2 dark:border-[#29292c] dark:bg-[#0e0e10]">
      {STAGES.map((s, i) => {
        const isCur = i === curIdx
        const phase = isCur ? cur!.phase : null
        const status: 'done' | 'running' | 'gate' | 'todo' =
          done || i < curIdx ? 'done'
          : isCur && phase === 'running' ? 'running'
          : isCur && phase === 'gate' ? 'gate'
          : 'todo'
        return (
          <div key={s.key} className="flex items-center gap-2">
            {i > 0 && <ArrowRight className="h-4 w-4 text-gray-300 dark:text-gray-600" strokeWidth={1.75} />}
            <NavLink
              to={s.route}
              className={`flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${
                // completed / past gates → muted gray ("done, behind you"); the active
                // gate stands out (blue running / amber gate); future gates are a faint dashed outline.
                status === 'done' ? 'border-gray-300 bg-gray-100 text-gray-500 dark:border-[#3a3a3d] dark:bg-[#202023] dark:text-gray-400'
                : status === 'running' ? 'border-blue-300 bg-blue-100 text-blue-800 dark:border-blue-800 dark:bg-blue-900/40 dark:text-blue-300'
                : status === 'gate' ? 'animate-pulse border-amber-400 bg-amber-100 text-amber-900 dark:border-amber-700 dark:bg-amber-900/40 dark:text-amber-200'
                : 'border-dashed border-gray-300 bg-white text-gray-400 dark:border-[#3a3a3d] dark:bg-[#161617] dark:text-gray-500'}`}
            >
              <span>{glyph(status)}</span>
              <span>{i + 1}. {s.label}</span>
            </NavLink>
          </div>
        )
      })}
    </div>
  )
}

function glyph(s: 'done' | 'running' | 'gate' | 'todo'): React.ReactNode {
  const cls = 'inline-block h-3.5 w-3.5 align-[-0.2em]'
  return s === 'done' ? <Check className={cls} strokeWidth={1.75} />
    : s === 'running' ? <Play className={cls} strokeWidth={1.75} />
    : s === 'gate' ? <Hand className={cls} strokeWidth={1.75} />
    : '·'
}
