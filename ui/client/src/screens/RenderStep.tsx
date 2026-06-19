import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check } from 'lucide-react'
import { useRunState } from '../api/useRunState'
import { getRenderPlan, startRender, type RenderPlan } from '../api/staged'

/**
 * Stage 4/4 — assemble the full per-lang file from the reviewed segments. A
 * separate step (not folded into the audio gate) so the operator can pick where
 * to save the result before building. RENDER_REVIEW = choose + build; RENDERING
 * = building; COMPLETE = done (file saved to the chosen destination).
 */
export function RenderStep() {
  const { state } = useRunState()
  const nav = useNavigate()
  const [plan, setPlan] = useState<RenderPlan | null>(null)
  const [dest, setDest] = useState('')
  const [custom, setCustom] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const st = state?.state
  const atGate = st === 'RENDER_REVIEW'
  const rendering = st === 'RENDERING'
  const done = st === 'COMPLETE'

  useEffect(() => {
    getRenderPlan().then((p) => { setPlan(p); setDest((d) => d || p.destination) }).catch(() => {})
  }, [st])

  async function build() {
    setBusy(true); setErr(null)
    try {
      const r = await startRender(dest)
      if (!r.ok) { setErr(r.error || 'не вдалося запустити склейку'); return }
    } catch (e) { setErr(e instanceof Error ? e.message : 'помилка') }
    finally { setBusy(false) }
  }

  if (!plan || (!atGate && !rendering && !done)) {
    return (
      <div className="mx-auto max-w-3xl p-6 text-sm text-gray-400">
        Склейку повного файлу буде доступно у staged-флоу після перевірки аудіо (кнопка «Затвердити аудіо»).
      </div>
    )
  }

  const enabled = atGate && Boolean(state?.enableWrites) && dest.trim().length > 0
  const langCount = plan.langs.length

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl p-6">
          <div className="mb-1 flex items-center gap-3">
            <h1 className="text-lg font-semibold">Склейка повного файлу</h1>
            <span className="text-sm text-gray-500">{langCount} мов</span>
            {done && <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-800 dark:bg-green-900/40 dark:text-green-300">готово</span>}
          </div>
          <p className="mb-4 max-w-prose text-sm text-gray-500 dark:text-gray-400">
            З перевірених сегментів збираємо суцільний аудіофайл на кожну мову (+ субтитри .vtt).
            Обери, куди зберегти результат, і запусти склейку.
          </p>

          {/* files to assemble */}
          <div className="mb-4 rounded-lg border border-gray-200 dark:border-[#29292c]">
            <div className="border-b border-gray-100 px-3 py-2 text-xs font-medium text-gray-500 dark:border-[#29292c]">
              Файли · {langCount} мов × (wav + vtt)
            </div>
            <ul className="divide-y divide-gray-100 dark:divide-[#29292c]">
              {plan.files.map((f) => (
                <li key={f} className="flex items-center gap-2 px-3 py-1.5 font-mono text-xs text-gray-700 dark:text-gray-300">
                  {f}
                  {done && <Check className="ml-auto inline-block h-3.5 w-3.5 align-[-0.2em] text-green-600 dark:text-green-400" strokeWidth={1.75} />}
                </li>
              ))}
            </ul>
          </div>

          {/* destination chooser */}
          <div className="mb-4">
            <label className="text-xs font-medium text-gray-500">Куди зберегти</label>
            <div className="mt-1.5 space-y-1.5">
              {plan.presets.map((p) => (
                <label key={p} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                  <input type="radio" name="dest" disabled={!atGate}
                    checked={!custom && dest === p} onChange={() => { setCustom(false); setDest(p) }} />
                  <span className="font-mono text-xs">{p}</span>
                </label>
              ))}
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input type="radio" name="dest" disabled={!atGate} checked={custom} onChange={() => setCustom(true)} />
                <span>Інша тека…</span>
              </label>
              {custom && (
                <input value={dest} disabled={!atGate} onChange={(e) => setDest(e.target.value)}
                  placeholder="напр. Drive · clients/acme/output"
                  className="ml-6 w-full max-w-md rounded border border-gray-300 px-2 py-1 font-mono text-xs dark:border-[#3a3a3d] dark:bg-[#161617]" />
              )}
            </div>
          </div>

          {err && <div className="rounded bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950/50 dark:text-red-300">{err}</div>}
        </div>
      </div>

      {/* full-width action bar (mirrors the review gates) */}
      <div className="sticky bottom-0 z-10 border-t border-gray-200 bg-white px-5 py-3 dark:border-[#29292c] dark:bg-[#161617]">
        <div className="flex items-center gap-4">
          <div className="min-w-0">
            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">Етап 4/4 · Склейка повного файлу</div>
            <div className="truncate text-xs text-gray-500 dark:text-gray-400">
              {done ? `Збережено у: ${plan.destination}` : `Зберегти у: ${dest || plan.destination}`}
            </div>
          </div>
          <div className="ml-auto flex items-center gap-3">
            {done ? (
              <>
                <button onClick={() => nav('/archive')}
                  className="rounded-md border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50 dark:border-[#3a3a3d] dark:hover:bg-[#202023]">Переглянути в архіві</button>
                <button onClick={() => nav('/lesson')}
                  className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white">Новий урок</button>
              </>
            ) : (
              <button onClick={build} disabled={!enabled || busy || rendering}
                className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:bg-gray-300 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white dark:disabled:bg-[#3a3a3d] dark:disabled:text-gray-400">
                {rendering ? 'Збираю повний файл…' : busy ? 'Запускаю…' : 'Зібрати повний файл'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
