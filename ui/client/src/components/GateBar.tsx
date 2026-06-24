import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Check } from 'lucide-react'
import { useRunState } from '../api/useRunState'
import { approveGate, type Gate } from '../api/staged'
import { writeBlockReason } from '../ui'

const GATE_STATE: Record<Gate, string> = {
  transcript: 'TRANSCRIPT_REVIEW',
  translations: 'TRANSLATION_REVIEW',
  audio: 'AUDIO_REVIEW',
}

// Where to send the operator once a gate is approved (the next stage's screen).
const NEXT_ROUTE: Record<Gate, string> = {
  transcript: '/translation',
  translations: '/review',
  audio: '/render', // audio review → separate assemble-file step
}

interface Props {
  gate: Gate
  title: string
  summary?: ReactNode
  /** Soft-gate: unresolved high-severity items. If non-empty, the confirm
   *  dialog warns and the button reads "затвердити попри попередження". */
  warnings?: string[]
  primaryLabel: string
}

/**
 * Sticky footer "approve & continue" gate. Enabled only when the run is paused
 * at THIS gate and writes are on. Soft-gate warnings don't block — they surface
 * in the confirm dialog and the operator can override.
 */
export function GateBar({ gate, title, summary, warnings = [], primaryLabel }: Props) {
  const { state } = useRunState()
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const atGate = state?.state === GATE_STATE[gate]
  const enabled = atGate && Boolean(state?.enableWrites)

  async function confirm() {
    setBusy(true); setErr(null)
    try {
      const res = await approveGate(gate)
      if (!res.ok) { setErr(res.error || 'failed'); return }
      setOpen(false)
      nav(NEXT_ROUTE[gate]) // jump to the next stage's screen
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sticky bottom-0 z-10 border-t border-gray-200 bg-white px-5 py-3 dark:border-[#29292c] dark:bg-[#161617]">
      <div className="flex items-center gap-4">
        <div className="min-w-0">
          <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{title}</div>
          {summary && <div className="truncate text-xs text-gray-500 dark:text-gray-400">{summary}</div>}
        </div>
        <div className="ml-auto flex items-center gap-3">
          {warnings.length > 0 && (
            <span className="text-xs text-amber-700 dark:text-amber-400"><AlertTriangle className="inline-block h-3.5 w-3.5 align-[-0.2em]" strokeWidth={1.75} /> {warnings.length} unresolved notes</span>
          )}
          <button
            onClick={() => { setErr(null); setOpen(true) }}
            disabled={!enabled}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:bg-gray-300 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white dark:disabled:bg-[#3a3a3d] dark:disabled:text-gray-400"
            title={enabled ? '' : (writeBlockReason(state) || 'unavailable at this stage')}
          >
            {warnings.length > 0
              ? <AlertTriangle className="inline-block h-3.5 w-3.5 align-[-0.2em]" strokeWidth={1.75} />
              : <Check className="inline-block h-3.5 w-3.5 align-[-0.2em]" strokeWidth={1.75} />} {primaryLabel}
          </button>
        </div>
      </div>
      {!enabled && !atGate && (
        <div className="mt-1 text-xs text-gray-400">Available when the pipeline pauses at this gate.</div>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 dark:bg-black/60" onClick={() => !busy && setOpen(false)}>
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl dark:bg-[#161617] dark:text-gray-100" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold">{primaryLabel}?</h3>
            {summary && <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">{summary}</p>}
            {warnings.length > 0 && (
              <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
                <div className="font-medium">Unresolved AI notes ({warnings.length}):</div>
                <ul className="mt-1 list-disc pl-5 text-xs">
                  {warnings.slice(0, 6).map((w, i) => <li key={i}>{w}</li>)}
                  {warnings.length > 6 && <li>...{warnings.length - 6} more</li>}
                </ul>
                <div className="mt-2 text-xs">You can approve despite them — the decision is yours.</div>
              </div>
            )}
            {err && <div className="mt-3 rounded-md bg-red-50 p-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">{err}</div>}
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setOpen(false)} disabled={busy} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 dark:border-[#3a3a3d] dark:hover:bg-[#202023]">
                Cancel
              </button>
              <button onClick={confirm} disabled={busy} className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:bg-gray-300 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white">
                {busy ? 'Running...' : warnings.length > 0 ? 'Approve despite warnings' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
