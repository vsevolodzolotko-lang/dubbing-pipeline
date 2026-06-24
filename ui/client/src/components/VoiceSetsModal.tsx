import { useState } from 'react'
import { X, ChevronDown, ChevronRight, ArrowRight, Trash2 } from 'lucide-react'

// A voice set named after the course its voices were used on (de…tr → voice + tuning).
interface SetVoice { lang: string; voice_id?: string; voice_name?: string; model?: string; stability?: string; similarity_boost?: string; style?: string; speed?: string }
interface CourseSet { id: string; name: string; createdAt?: string; voices: SetVoice[] }

const VFIELDS = ['voice_id', 'voice_name', 'model', 'stability', 'similarity_boost', 'style', 'speed'] as const
function pick(src: object): Record<string, string> {
  const r = src as Record<string, unknown>
  const o: Record<string, string> = {}
  for (const k of VFIELDS) if (r[k] != null && r[k] !== '') o[k] = String(r[k])
  return o
}

/**
 * The "Voice sets by course" window: the saved voice sets (named after the courses
 * they were used on, e.g. High Vibration / Kundalini / Somatic Yoga). Expand a set
 * to see its per-language voices; Apply writes the set into the voices table (gated);
 * Delete removes it; or save the current voices as a new course set.
 */
export function VoiceSetsModal({ sets, rows, writable, onChanged, onClose }: {
  sets: CourseSet[]
  rows: { lang: string }[]
  writable: boolean
  onChanged: () => void
  onClose: () => void
}) {
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  async function saveCurrent() {
    const name = window.prompt('Course name (e.g. High Vibration):')
    if (!name) return
    setBusy(true); setMsg(null)
    try {
      const body = { name, voices: rows.map((v) => ({ lang: v.lang, ...pick(v) })) }
      await fetch('/api/presets/set', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      onChanged(); setMsg(`Saved "${name}"`)
    } catch (e) { setMsg(e instanceof Error ? e.message : 'error') } finally { setBusy(false) }
  }

  async function apply(s: CourseSet) {
    if (!writable) { setMsg('write blocked — enable writes (and not during a run)'); return }
    if (!window.confirm(`Apply "${s.name}" (${s.voices.length} languages) to the voices table?`)) return
    setBusy(true); setMsg(null)
    try {
      const body = { voices: s.voices.map((v) => ({ lang: v.lang, fields: pick(v) })) }
      const res = await fetch('/api/voices/apply-set', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const d = await res.json().catch(() => ({}))
      setMsg(res.ok && d.ok ? `Applied "${s.name}" (${d.applied} languages)` : `${d.error || res.status}`)
    } catch (e) { setMsg(e instanceof Error ? e.message : 'error') } finally { setBusy(false) }
  }

  async function del(s: CourseSet) {
    if (!window.confirm(`Delete the "${s.name}" set?`)) return
    setBusy(true); setMsg(null)
    try { await fetch(`/api/presets/set/${s.id}`, { method: 'DELETE' }); onChanged() }
    catch (e) { setMsg(e instanceof Error ? e.message : 'error') } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 dark:bg-black/60" onClick={() => !busy && onClose()}>
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-xl border border-gray-200 bg-white shadow-xl dark:border-[#29292c] dark:bg-[#161617]"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 px-4 py-3 dark:border-[#29292c]">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Voice sets by course</h2>
          <span className="text-xs text-gray-400">{sets.length}</span>
          <button onClick={saveCurrent} disabled={busy}
            className="rounded border border-gray-300 bg-white px-2 py-1 text-xs hover:bg-gray-100 disabled:opacity-50 dark:border-[#3a3a3d] dark:bg-[#161617] dark:hover:bg-[#202023]">
            Save current voices as course set…
          </button>
          {msg && <span className="text-xs text-gray-500">{msg}</span>}
          <button onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"><X className="h-4 w-4" strokeWidth={1.75} /></button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-3">
          {sets.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-sm text-gray-400 dark:border-[#3a3a3d]">
              No course sets yet — save the current voices as a set.
            </div>
          ) : (
            <ul className="space-y-2">
              {sets.map((s) => {
                const open = openId === s.id
                return (
                  <li key={s.id} className="rounded-lg border border-gray-200 dark:border-[#29292c]">
                    <div className="flex items-center gap-2 px-3 py-2">
                      <button onClick={() => setOpenId(open ? null : s.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                        {open ? <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" strokeWidth={1.75} /> : <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" strokeWidth={1.75} />}
                        <span className="truncate font-medium text-gray-800 dark:text-gray-200">{s.name}</span>
                        <span className="shrink-0 text-xs text-gray-400">{s.voices.length} languages</span>
                      </button>
                      <button onClick={() => apply(s)} disabled={!writable || busy} title={writable ? '' : 'write blocked'}
                        className="flex items-center gap-1 rounded border border-gray-300 px-2 py-0.5 text-xs hover:bg-gray-100 disabled:opacity-40 dark:border-[#3a3a3d] dark:hover:bg-[#202023]">
                        <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.75} /> Apply
                      </button>
                      <button onClick={() => del(s)} disabled={busy} title="delete set" className="text-gray-400 hover:text-red-600"><Trash2 className="h-4 w-4" strokeWidth={1.75} /></button>
                    </div>
                    {open && (
                      <div className="overflow-x-auto border-t border-gray-100 px-3 py-2 dark:border-[#29292c]">
                        <table className="w-full text-xs">
                          <tbody>
                            {s.voices.map((v) => (
                              <tr key={v.lang} className="text-gray-600 dark:text-gray-300">
                                <td className="py-0.5 pr-3 font-mono text-gray-400">{v.lang}</td>
                                <td className="py-0.5 pr-3">{v.voice_name || '—'}</td>
                                <td className="py-0.5 pr-3 font-mono text-[11px] text-gray-400">spd {v.speed ?? '—'} · sty {v.style ?? '—'} · stab {v.stability ?? '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
