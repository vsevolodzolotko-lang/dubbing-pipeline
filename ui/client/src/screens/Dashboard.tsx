import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Hand, Play, Check, Circle, ArrowDownUp } from 'lucide-react'
import { useProjects } from '../api/queries'
import { openProject, startAsProject, type Project, type ProjectStatus } from '../api/projects'
import { StagedDropzone, type DroppedMedia } from '../components/StagedDropzone'
import { PreflightSetup } from '../components/PreflightSetup'
import { useRunMedia } from '../api/runMedia'
import { useRunState } from '../api/useRunState'
import { STATE_COPY, TONE_CLASSES, type Tone } from '../ui'

// Buckets by the project's live run state (or a coarse fallback from stored status).
const RUNNING = new Set(['STARTING', 'ARCHIVING', 'STT', 'TRANSLATING', 'SYNTHESIZING', 'RENDERING', 'REGENERATING'])
const REVIEW = new Set(['TRANSCRIPT_REVIEW', 'TRANSLATION_REVIEW', 'AUDIO_REVIEW', 'RENDER_REVIEW'])
const DONE = new Set(['COMPLETE', 'STOPPED'])

const FALLBACK: Record<ProjectStatus, string> = {
  new: 'IDLE', in_progress: 'SYNTHESIZING', review: 'AUDIO_REVIEW', done: 'COMPLETE', stopped: 'STOPPED',
}

const effState = (p: Project) => p.liveState || FALLBACK[p.status] || 'IDLE'
const stateLabel = (s: string) => (s === 'IDLE' ? 'New' : STATE_COPY[s as keyof typeof STATE_COPY]?.label ?? s)
const stateTone = (s: string): Tone => (s === 'IDLE' ? 'gray' : STATE_COPY[s as keyof typeof STATE_COPY]?.tone ?? 'gray')

function bucket(s: string): 'queue' | 'review' | 'done' | 'new' {
  if (RUNNING.has(s)) return 'queue'
  if (REVIEW.has(s)) return 'review'
  if (DONE.has(s)) return 'done'
  return 'new'
}

// Which screen to land on when opening a project, by its state.
function routeFor(s: string): string {
  if (s === 'STT' || s === 'TRANSCRIPT_REVIEW') return '/transcript'
  if (s === 'TRANSLATING' || s === 'TRANSLATION_REVIEW') return '/translation'
  if (s === 'RENDERING' || s === 'RENDER_REVIEW') return '/render'
  return '/review' // synth/audio/complete/stopped/idle
}

const SECTIONS: { key: 'queue' | 'review' | 'done' | 'new'; title: string }[] = [
  { key: 'queue', title: 'In progress' },
  { key: 'review', title: 'Awaiting review' },
  { key: 'done', title: 'Ready' },
  { key: 'new', title: 'New' },
]

// ── sorting ──────────────────────────────────────────────────────────────────
type SortKey = 'updated' | 'name' | 'size' | 'langs' | 'attention'
const SORTS: { key: SortKey; label: string }[] = [
  { key: 'updated', label: 'Last updated' },
  { key: 'name', label: 'Name' },
  { key: 'size', label: 'Size (segments)' },
  { key: 'langs', label: 'Languages' },
  { key: 'attention', label: 'Needs attention' },
]
function compare(a: Project, b: Project, key: SortKey): number {
  switch (key) {
    case 'name': return a.name.localeCompare(b.name)
    case 'size': return a.summary.segCount - b.summary.segCount
    case 'langs': return a.summary.langCount - b.summary.langCount
    case 'attention': return a.summary.needsAttention.count - b.summary.needsAttention.count
    case 'updated': return (Date.parse(a.updatedAt) || 0) - (Date.parse(b.updatedAt) || 0)
  }
}
function shortDate(iso: string): string {
  const t = Date.parse(iso)
  if (!t) return ''
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function Dashboard() {
  const { data, isLoading } = useProjects()
  const projects = data?.rows ?? []
  const activeId = data?.activeId ?? null
  const nav = useNavigate()
  const { refresh } = useRunState()
  const { videoName, setVideo } = useRunMedia()

  const [pendingFile, setPendingFile] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'queue' | 'review' | 'done' | 'new'>('all')
  const [sortBy, setSortBy] = useState<SortKey>('updated')
  // Most sorts read best high→low; name reads best A→Z. asc=false means descending.
  const [asc, setAsc] = useState(false)

  function onMedia({ audioName, videoFile }: DroppedMedia) {
    if (videoFile) setVideo(videoFile)
    if (audioName) setPendingFile(audioName)
  }

  async function open(p: Project) {
    setBusyId(p.id); setErr(null)
    try {
      const res = await openProject(p.id)
      if (!res.ok) { setErr(res.error || 'could not open'); return }
      refresh()
      nav(routeFor(res.project?.liveState || effState(p)))
    } catch (e) { setErr(e instanceof Error ? e.message : 'error') }
    finally { setBusyId(null) }
  }

  // Drop-to-create takes over the tab (same flow as the Projects screen).
  if (pendingFile) {
    return (
      <div className="p-6">
        <div className="mx-auto max-w-2xl rounded-xl border border-gray-200 bg-white p-5 dark:border-[#29292c] dark:bg-[#161617]">
          <PreflightSetup fileName={pendingFile} videoName={videoName}
            onCancel={() => { setPendingFile(null); setVideo(null) }}
            onStart={(lessonId, langs) => startAsProject(lessonId, pendingFile, langs)} />
        </div>
      </div>
    )
  }

  const counts = {
    all: projects.length,
    queue: projects.filter((p) => bucket(effState(p)) === 'queue').length,
    review: projects.filter((p) => bucket(effState(p)) === 'review').length,
    done: projects.filter((p) => bucket(effState(p)) === 'done').length,
    new: projects.filter((p) => bucket(effState(p)) === 'new').length,
  }
  const ql = q.trim().toLowerCase()
  const visible = projects
    .filter((p) =>
      (!ql || p.name.toLowerCase().includes(ql)) &&
      (statusFilter === 'all' || bucket(effState(p)) === statusFilter))
    .sort((a, b) => (asc ? 1 : -1) * compare(a, b, sortBy))
  const FILTERS = [
    ['all', 'All', counts.all], ['queue', 'In progress', counts.queue], ['review', 'Review', counts.review],
    ['done', 'Ready', counts.done], ['new', 'New', counts.new],
  ] as const

  return (
    <div className="p-6">
      {/* full-width controls — keeps the list and the dropzone column top-aligned */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Projects</h1>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search projects…"
          className="ml-1 w-48 rounded-md border border-gray-300 bg-white px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 dark:border-[#3a3a3d] dark:bg-[#161617] dark:text-gray-200" />
        <div className="flex items-center gap-1">
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortKey)}
            className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 dark:border-[#3a3a3d] dark:bg-[#161617] dark:text-gray-200">
            {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <button onClick={() => setAsc((v) => !v)} title={asc ? 'Ascending' : 'Descending'}
            className="flex h-[30px] w-[30px] items-center justify-center rounded-md border border-gray-300 text-gray-500 hover:bg-gray-100 dark:border-[#3a3a3d] dark:text-gray-300 dark:hover:bg-[#202023]">
            <ArrowDownUp className={`h-3.5 w-3.5 ${asc ? 'rotate-180' : ''}`} strokeWidth={1.75} />
          </button>
        </div>
        <div className="ml-auto flex flex-wrap gap-1">
          {FILTERS.map(([key, label, c]) => (
            <button key={key} onClick={() => setStatusFilter(key)}
              className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusFilter === key
                ? 'border-gray-900 bg-gray-900 text-white dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900'
                : 'border-gray-300 text-gray-600 hover:bg-gray-100 dark:border-[#3a3a3d] dark:text-gray-300 dark:hover:bg-[#202023]'}`}>
              {label} <span className="opacity-60">{c}</span>
            </button>
          ))}
        </div>
      </div>

      {err && <div className="mb-3 rounded bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950/50 dark:text-red-300">{err}</div>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[4fr_1fr]">
        <section className="min-w-0">
          {isLoading ? (
            <div className="text-sm text-gray-400">Loading…</div>
          ) : projects.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-sm text-gray-400 dark:border-[#3a3a3d] dark:text-gray-500">
              No projects yet. Drop EN audio on the right to create the first one.
            </div>
          ) : visible.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-sm text-gray-400 dark:border-[#3a3a3d] dark:text-gray-500">
              Nothing matches the filter.
            </div>
          ) : (
            <div className="space-y-5">
              {SECTIONS.map((sec) => {
                const items = visible.filter((p) => bucket(effState(p)) === sec.key)
                if (!items.length) return null
                return (
                  <div key={sec.key}>
                    <div className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                      <SectionIcon k={sec.key} /> {sec.title} <span className="font-normal lowercase text-gray-300 dark:text-gray-600">{items.length}</span>
                    </div>
                    <ol className="space-y-1.5">
                      {items.map((p) => (
                        <ProjectCard key={p.id} p={p} active={p.id === activeId} busy={busyId === p.id} onOpen={() => open(p)} />
                      ))}
                    </ol>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        <section className="lg:sticky lg:top-4 self-start">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">New project</div>
          <StagedDropzone onMedia={onMedia} large />
          {videoName && <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">reference video: {videoName}</p>}
        </section>
      </div>
    </div>
  )
}

function ProjectCard({ p, active, busy, onOpen }: { p: Project; active: boolean; busy: boolean; onOpen: () => void }) {
  const s = effState(p)
  const na = p.summary.needsAttention
  const date = shortDate(p.updatedAt)
  return (
    <li>
      <button onClick={onOpen} disabled={busy}
        className={`w-full rounded-lg border bg-white p-2.5 text-left disabled:opacity-50 dark:bg-[#161617] ${
          active ? 'border-gray-900 dark:border-gray-100' : 'border-gray-200 hover:border-gray-300 dark:border-[#29292c] dark:hover:border-gray-600'}`}>
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-gray-900 dark:text-gray-100">{p.name}</span>
          {active && <span className="rounded bg-gray-900 px-1.5 py-0.5 text-[10px] font-medium text-white dark:bg-gray-100 dark:text-gray-900">active</span>}
          <span className={`ml-auto shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${TONE_CLASSES[stateTone(s)]}`}>{busy ? 'Opening…' : stateLabel(s)}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-gray-400">
          <span>{p.summary.segCount} seg.</span>
          <span>· {p.summary.langCount} langs</span>
          {date && <span>· {date}</span>}
          {na.total > 0 && na.count > 0 && (
            <span className="text-amber-600 dark:text-amber-400">· attention {na.count}/{na.total}</span>
          )}
        </div>
      </button>
    </li>
  )
}

function SectionIcon({ k }: { k: 'queue' | 'review' | 'done' | 'new' }) {
  const cls = 'h-3.5 w-3.5'
  if (k === 'queue') return <Play className={cls} strokeWidth={1.75} />
  if (k === 'review') return <Hand className={cls} strokeWidth={1.75} />
  if (k === 'done') return <Check className={cls} strokeWidth={1.75} />
  return <Circle className={cls} strokeWidth={1.75} />
}
