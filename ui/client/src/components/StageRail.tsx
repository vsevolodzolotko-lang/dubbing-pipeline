import { NavLink } from 'react-router-dom'
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
    <div className="flex items-center gap-2 border-b border-gray-200 bg-gray-50 px-5 py-2 dark:border-[#332b22] dark:bg-[#16130f]">
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
            {i > 0 && <span className="text-gray-300 dark:text-gray-600">→</span>}
            <NavLink
              to={s.route}
              className={`flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${
                status === 'done' ? 'border-green-300 bg-green-100 text-green-800 dark:border-green-800 dark:bg-green-900/40 dark:text-green-300'
                : status === 'running' ? 'border-blue-300 bg-blue-100 text-blue-800 dark:border-blue-800 dark:bg-blue-900/40 dark:text-blue-300'
                : status === 'gate' ? 'animate-pulse border-amber-400 bg-amber-100 text-amber-900 dark:border-amber-700 dark:bg-amber-900/40 dark:text-amber-200'
                : 'border-gray-200 bg-white text-gray-400 dark:border-[#473d31] dark:bg-[#1c1814] dark:text-gray-500'}`}
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

function glyph(s: 'done' | 'running' | 'gate' | 'todo') {
  return s === 'done' ? '✓' : s === 'running' ? '▶' : s === 'gate' ? '✋' : '·'
}
