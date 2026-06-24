import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, ArrowRight, AudioLines } from 'lucide-react'
import { useProjects } from '../api/queries'
import { openProject, startAsProject, type Project, type ProjectStatus } from '../api/projects'
import { StagedDropzone, type DroppedMedia } from '../components/StagedDropzone'
import { PreflightSetup } from '../components/PreflightSetup'
import { useRunMedia } from '../api/runMedia'
import { useRunState } from '../api/useRunState'
import { TONE_CLASSES, type Tone } from '../ui'

const STATUS_META: Record<ProjectStatus, { label: string; tone: Tone }> = {
  new: { label: 'Новий', tone: 'gray' },
  in_progress: { label: 'В обробці', tone: 'blue' },
  review: { label: 'На перевірці', tone: 'amber' },
  done: { label: 'Готово', tone: 'green' },
  stopped: { label: 'Зупинено', tone: 'gray' },
}

const fmtDate = (iso: string) => {
  try { return new Date(iso).toLocaleString('uk-UA', { dateStyle: 'medium', timeStyle: 'short' }) } catch { return iso }
}

// Where opening a project lands: review/done → audio gate, otherwise the lesson dashboard.
const destFor = (status?: ProjectStatus) => (status === 'review' || status === 'done' ? '/review' : '/lesson')

export function Projects() {
  const { data, isLoading } = useProjects()
  const projects = data?.rows ?? []
  const activeId = data?.activeId ?? null
  const nav = useNavigate()
  const { refresh } = useRunState()
  const { setVideo } = useRunMedia()

  const [creating, setCreating] = useState(false)
  const [pendingFile, setPendingFile] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  function onMedia({ audioName, videoFile }: DroppedMedia) {
    if (videoFile) setVideo(videoFile)
    if (audioName) setPendingFile(audioName)
  }

  async function open(p: Project) {
    setBusyId(p.id); setErr(null)
    try {
      const res = await openProject(p.id)
      if (!res.ok) { setErr(res.error || 'не вдалося відкрити'); return }
      refresh()
      nav(destFor(res.project?.status))
    } catch (e) { setErr(e instanceof Error ? e.message : 'помилка') }
    finally { setBusyId(null) }
  }

  // New-project flow: drop a file → pre-flight (which creates the project + starts).
  if (creating) {
    return (
      <div className="p-6">
        <div className="mx-auto max-w-2xl">
          <div className="mb-3 flex items-center gap-2">
            <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Новий проєкт</h1>
            <button onClick={() => { setCreating(false); setPendingFile(null); setVideo(null) }}
              className="ml-auto text-xs text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">← до списку</button>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-[#29292c] dark:bg-[#161617]">
            {pendingFile ? (
              <PreflightSetup fileName={pendingFile}
                onCancel={() => setPendingFile(null)}
                onStart={(lessonId, langs) => startAsProject(lessonId, pendingFile, langs)} />
            ) : (
              <StagedDropzone onMedia={onMedia} />
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Проєкти</h1>
        <button onClick={() => setCreating(true)}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white">
          <Plus className="h-4 w-4" strokeWidth={2} /> Новий проєкт
        </button>
      </div>
      <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
        Кожен завантажений файл — окремий проєкт зі своїм листом і теками. Відкрий, щоб послухати готове аудіо,
        переглянути позначене проблемним і внести правки чи перезапустити.
      </p>

      {err && <div className="mb-3 rounded bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950/50 dark:text-red-300">{err}</div>}

      {isLoading ? (
        <div className="text-sm text-gray-400">Завантаження…</div>
      ) : projects.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-sm text-gray-400 dark:border-[#3a3a3d] dark:text-gray-500">
          Ще немає проєктів. Натисни «Новий проєкт» і перетягни EN-аудіо.
        </div>
      ) : (
        <ol className="space-y-2">
          {projects.map((p) => {
            const meta = STATUS_META[p.status] ?? STATUS_META.new
            const isActive = p.id === activeId
            const na = p.summary.needsAttention
            return (
              <li key={p.id}
                className={`rounded-lg border bg-white p-3 dark:bg-[#161617] ${
                  isActive ? 'border-gray-900 dark:border-gray-100' : 'border-gray-200 dark:border-[#29292c]'}`}>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-900 dark:text-gray-100">{p.name}</span>
                  {isActive && <span className="rounded bg-gray-900 px-1.5 py-0.5 text-[10px] font-medium text-white dark:bg-gray-100 dark:text-gray-900">активний</span>}
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${TONE_CLASSES[meta.tone]}`}>{meta.label}</span>
                  <span className="ml-auto text-xs text-gray-400">{fmtDate(p.updatedAt)}</span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                  <Badge>{p.summary.segCount} сегм.</Badge>
                  <Badge>{p.summary.langCount} мов</Badge>
                  {p.summary.langs.length > 0 && <span className="font-mono text-gray-400">{p.summary.langs.join(' · ')}</span>}
                  {na.total > 0 && (
                    <Badge tone={na.count > 0 ? 'amber' : 'green'}>увага {na.pct}% ({na.count}/{na.total})</Badge>
                  )}
                  <button onClick={() => open(p)} disabled={busyId === p.id}
                    className="ml-auto inline-flex items-center gap-1 rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-[#3a3a3d] dark:text-gray-200 dark:hover:bg-[#202023]">
                    {busyId === p.id ? 'Відкриваю…' : <>{p.status === 'done' || p.status === 'review' ? <AudioLines className="h-3.5 w-3.5" strokeWidth={1.75} /> : <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.75} />} Відкрити</>}
                  </button>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}

function Badge({ children, tone = 'gray' }: { children: React.ReactNode; tone?: 'gray' | 'green' | 'amber' }) {
  const cls = tone === 'green' ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300'
    : tone === 'amber' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
    : 'bg-gray-100 text-gray-600 dark:bg-[#202023] dark:text-gray-300'
  return <span className={`rounded px-1.5 py-0.5 ${cls}`}>{children}</span>
}
