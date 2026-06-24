import { useState } from 'react'
import { useArchive } from '../api/queries'
import { fetchJson } from '../api/client'
import type { ArchiveRun } from '../api/types'

const fmtDate = (iso: string) => { try { return new Date(iso).toLocaleString('uk-UA', { dateStyle: 'medium', timeStyle: 'short' }) } catch { return iso } }
const VOICE_FIELDS = ['voice_id', 'voice_name', 'model', 'stability', 'similarity_boost', 'style', 'speed', 'notes']

export function Archive() {
  const { data, isLoading } = useArchive()
  const runs = data?.rows ?? []
  const [selId, setSelId] = useState<string | null>(null)
  const [detail, setDetail] = useState<ArchiveRun | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)

  async function open(id: string) {
    setSelId(id); setLoadingDetail(true); setDetail(null)
    try { setDetail(await fetchJson<ArchiveRun>(`/api/archive/${id}`)) }
    catch { /* ignore */ }
    finally { setLoadingDetail(false) }
  }

  return (
    <div className="grid grid-cols-1 gap-6 p-6 lg:grid-cols-[1fr_24rem]">
      <section>
        <h1 className="mb-1 text-lg font-semibold text-gray-900 dark:text-gray-100">Архів уроків</h1>
        <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
          Кожен завершений поетапний урок зберігається тут зі знімком налаштувань, що діяли на момент озвучення.
        </p>
        {isLoading ? <div className="text-sm text-gray-400">Завантаження…</div>
          : runs.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-sm text-gray-400 dark:border-[#3a3a3d] dark:text-gray-500">
              Ще немає завершених уроків. Проведи staged-урок до кінця («Завершити урок») — і він зʼявиться тут.
            </div>
          ) : (
            <ol className="space-y-2">
              {runs.map((r) => {
                const sel = r.id === selId
                return (
                  <li key={r.id}>
                    <button onClick={() => open(r.id)}
                      className={`w-full rounded-lg border p-3 text-left ${
                        sel ? 'border-gray-900 bg-white dark:border-gray-100 dark:bg-[#161617]'
                        : 'border-gray-200 bg-white hover:border-gray-300 dark:border-[#29292c] dark:bg-[#161617] dark:hover:border-gray-600'}`}>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900 dark:text-gray-100">{r.lessonId ?? '—'}</span>
                        <span className="ml-auto text-xs text-gray-400">{fmtDate(r.finishedAt)}</span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px]">
                        <Badge>{r.segCount} сегм.</Badge>
                        <Badge>{r.langCount} мов</Badge>
                        <Badge tone={r.needsAttention.pct > 0 ? 'amber' : 'green'}>
                          увага {r.needsAttention.pct}% ({r.needsAttention.count}/{r.needsAttention.total})
                        </Badge>
                      </div>
                    </button>
                  </li>
                )
              })}
            </ol>
          )}
      </section>

      <aside className="lg:sticky lg:top-4 self-start">
        <h2 className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-300">Знімок налаштувань</h2>
        {loadingDetail ? <div className="text-sm text-gray-400">Завантаження…</div>
          : !detail ? <div className="text-sm text-gray-400">Обери урок зі списку</div>
          : <Snapshot run={detail} />}
      </aside>
    </div>
  )
}

function Snapshot({ run }: { run: ArchiveRun }) {
  const { settings } = run
  const cfg = Object.entries(settings.config || {})
  return (
    <div className="space-y-3 text-sm">
      <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-[#29292c] dark:bg-[#161617]">
        <div className="text-xs font-medium text-gray-400">Урок</div>
        <div className="text-gray-900 dark:text-gray-100">{run.lessonId} · {fmtDate(run.finishedAt)}</div>
        <div className="mt-1 flex flex-wrap gap-1.5 text-[11px]">
          {settings.activeLangs.map((l) => <Badge key={l}>{l}</Badge>)}
        </div>
      </div>

      <details open className="rounded-lg border border-gray-200 bg-white dark:border-[#29292c] dark:bg-[#161617]">
        <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-gray-600 dark:text-gray-300">Голоси ({settings.voices.length})</summary>
        <div className="space-y-2 border-t border-gray-100 p-2 dark:border-[#29292c]">
          {settings.voices.map((v, i) => (
            <div key={i} className="rounded border border-gray-100 p-2 dark:border-[#29292c]">
              <div className="mb-1 font-mono text-xs font-semibold text-gray-700 dark:text-gray-200">{v.lang}</div>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
                {VOICE_FIELDS.filter((f) => v[f] != null && v[f] !== '').map((f) => (
                  <div key={f} className="flex justify-between gap-2">
                    <dt className="text-gray-400">{f}</dt>
                    <dd className="truncate text-gray-700 dark:text-gray-300" title={String(v[f])}>{String(v[f])}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </details>

      <details className="rounded-lg border border-gray-200 bg-white dark:border-[#29292c] dark:bg-[#161617]">
        <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-gray-600 dark:text-gray-300">Параметри ({cfg.length})</summary>
        <div className="overflow-auto border-t border-gray-100 dark:border-[#29292c]">
          <table className="w-full text-xs">
            <tbody>
              {cfg.map(([k, v]) => (
                <tr key={k} className="border-t border-gray-50 first:border-0 dark:border-[#29292c]">
                  <td className="px-2 py-1 font-mono text-gray-400">{k}</td>
                  <td className="px-2 py-1 text-gray-800 dark:text-gray-200">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <details className="rounded-lg border border-gray-200 bg-white dark:border-[#29292c] dark:bg-[#161617]">
        <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-gray-600 dark:text-gray-300">AI-промпт перевірки</summary>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap border-t border-gray-100 p-3 font-mono text-[11px] text-gray-700 dark:border-[#29292c] dark:text-gray-300">{settings.aiPrompt}</pre>
      </details>
    </div>
  )
}

function Badge({ children, tone = 'gray' }: { children: React.ReactNode; tone?: 'gray' | 'green' | 'amber' }) {
  const cls = tone === 'green' ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300'
    : tone === 'amber' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
    : 'bg-gray-100 text-gray-600 dark:bg-[#202023] dark:text-gray-300'
  return <span className={`rounded px-1.5 py-0.5 ${cls}`}>{children}</span>
}
