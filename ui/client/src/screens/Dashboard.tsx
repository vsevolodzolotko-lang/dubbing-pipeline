import { useEffect, useState } from 'react'
import { Check, Hand, Play, ArrowRight } from 'lucide-react'
import { useRunState } from '../api/useRunState'
import { STATE_COPY, TONE_CLASSES } from '../ui'
import { StagedDropzone, type DroppedMedia } from '../components/StagedDropzone'
import { PreflightSetup } from '../components/PreflightSetup'
import { useRunMedia } from '../api/runMedia'
import type { RunState } from '../api/types'

const RUNNING = new Set(['STARTING', 'ARCHIVING', 'STT', 'TRANSLATING', 'SYNTHESIZING', 'STOPPING', 'REGENERATING'])

export function Dashboard() {
  const { state } = useRunState()
  const { videoName, setVideo } = useRunMedia()
  const [pendingFile, setPendingFile] = useState<string | null>(null)

  function onMedia({ audioName, videoFile }: DroppedMedia) {
    if (videoFile) setVideo(videoFile)      // attach reference video (object URL in context)
    if (audioName) setPendingFile(audioName) // opens Pre-flight; null = video-only drop, keep waiting
  }

  if (!state) return <Loading />

  const copy = STATE_COPY[state.state]

  // Pre-flight takes over the tab (full width) once a file is dropped.
  if (pendingFile) {
    return (
      <div className="p-6">
        <div className="mx-auto max-w-2xl rounded-xl border border-gray-200 bg-white p-5 dark:border-[#29292c] dark:bg-[#161617]">
          <PreflightSetup fileName={pendingFile} videoName={videoName}
            onCancel={() => { setPendingFile(null); setVideo(null) }} />
        </div>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-6 p-6 lg:grid-cols-[1fr_18rem]">
      <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-[#29292c] dark:bg-[#161617]">
        <div className="mb-4 flex items-center gap-3">
          <h1 className="text-lg font-semibold">Прогрес рану</h1>
          <span className={`rounded-full border px-3 py-1 text-xs font-medium ${TONE_CLASSES[copy.tone]}`}>
            {copy.label}
          </span>
        </div>
        <Timers state={state} />
        <Stepper state={state} />
        {(state.state === 'COMPLETE' || state.state === 'STOPPED') && (
          <CompletionCard state={state} />
        )}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-[#29292c] dark:bg-[#161617]">
        <h2 className="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-300">Новий урок (поетапний)</h2>
        <StagedDropzone onMedia={onMedia} />
        {videoName && <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">відео-референс: {videoName}</p>}
      </section>
    </div>
  )
}

const STAGES_AUTO = [
  { key: 'archive', label: 'Архівація попереднього уроку', gate: false },
  { key: 'stt', label: 'Розпізнавання мовлення', gate: false },
  { key: 'translate', label: 'Переклад', gate: false },
  { key: 'synth', label: 'Синтез аудіо (мова за мовою)', gate: false },
  { key: 'done', label: 'Готово', gate: false },
] as const

// Staged flow inserts the three review gates between the work stages.
const STAGES_STAGED = [
  { key: 'stt', label: 'Розпізнавання мовлення', gate: false },
  { key: 'transcript_gate', label: 'Перевірка транскрипту', gate: true },
  { key: 'translate', label: 'Переклад', gate: false },
  { key: 'translation_gate', label: 'Перевірка перекладу', gate: true },
  { key: 'synth', label: 'Синтез аудіо (мова за мовою)', gate: false },
  { key: 'audio_gate', label: 'Перевірка аудіо (сегменти)', gate: true },
  { key: 'render', label: 'Склейка повного файлу', gate: true },
  { key: 'done', label: 'Готово', gate: false },
] as const

function Stepper({ state }: { state: RunState }) {
  const staged = Boolean(state.staged)
  const stages = staged ? STAGES_STAGED : STAGES_AUTO
  const reached = staged ? stagedProgress(state.state) : stageProgress(state)
  return (
    <ol className="space-y-2">
      {stages.map((s, i) => {
        const status = reached > i ? 'done' : reached === i ? 'active' : 'todo'
        return (
          <li key={s.key} className="flex items-start gap-3">
            <span className={`mt-0.5 flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${
              status === 'done' ? 'bg-gray-300 text-gray-600 dark:bg-[#3a3a3d] dark:text-gray-300'
              : status === 'active' ? (s.gate ? 'bg-amber-500 text-white' : 'bg-blue-500 text-white')
              : 'bg-gray-200 text-gray-400 dark:bg-[#202023]'}`}>
              {status === 'done' ? <Check className="h-3 w-3" strokeWidth={1.75} /> : status === 'active' ? (s.gate ? <Hand className="h-3 w-3" strokeWidth={1.75} /> : <Play className="h-3 w-3" strokeWidth={1.75} />) : '·'}
            </span>
            <div className="flex-1">
              <div className={`text-sm ${status === 'done' ? 'text-gray-400 dark:text-gray-500' : status === 'todo' ? 'text-gray-400' : 'text-gray-800 dark:text-gray-200'}`}>{s.label}</div>
              {s.key === 'synth' && status !== 'todo' && <LangProgress state={state} />}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

// Index into STAGES_STAGED for the current state.
function stagedProgress(stateName: string): number {
  switch (stateName) {
    case 'STT': return 0
    case 'TRANSCRIPT_REVIEW': return 1
    case 'TRANSLATING': return 2
    case 'TRANSLATION_REVIEW': return 3
    case 'SYNTHESIZING': return 4
    case 'AUDIO_REVIEW': return 5
    case 'RENDER_REVIEW': return 6
    case 'RENDERING': return 6
    case 'COMPLETE': return 8
    default: return 0
  }
}

function LangProgress({ state }: { state: RunState }) {
  const { synthByLang, currentLang, langDone, langTotal } = state.progress
  const langs = Object.keys(synthByLang)
  return (
    <div className="mt-1.5">
      <div className="flex flex-wrap gap-1.5 text-[11px]">
        {langs.map((l) => {
          const done = state.state === 'COMPLETE' || (synthByLang[l] > 0 && l !== currentLang && langDone > langs.indexOf(l))
          const active = l === currentLang
          return (
            <span key={l} className={`rounded px-1.5 py-0.5 font-mono ${
              done ? 'bg-green-100 text-green-700'
              : active ? 'bg-blue-100 text-blue-700'
              : 'bg-gray-100 text-gray-400'}`}>
              {done ? <Check className="inline-block h-3.5 w-3.5 align-[-0.2em]" strokeWidth={1.75} /> : active ? <Play className="inline-block h-3.5 w-3.5 align-[-0.2em]" strokeWidth={1.75} /> : '·'} {l}
            </span>
          )
        })}
      </div>
      <div className="mt-1 text-xs text-gray-400">{langDone} з {langTotal} мов готово</div>
    </div>
  )
}

function CompletionCard({ state }: { state: RunState }) {
  return (
    <div className="mt-5 rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-900 dark:bg-green-950/50">
      <div className="text-sm font-medium text-green-900 dark:text-green-200">
        {state.state === 'STOPPED' ? 'Зупинено' : 'Дубляж готовий'}
        {state.needsAttention.total > 0 && (
          <> · Потребують уваги: {state.needsAttention.pct}% ({state.needsAttention.count}/{state.needsAttention.total})</>
        )}
      </div>
      <a href="/review" className="mt-2 inline-block rounded-md bg-green-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-800">
        <ArrowRight className="inline-block h-3.5 w-3.5 align-[-0.2em]" strokeWidth={1.75} /> До перевірки
      </a>
    </div>
  )
}

function stageProgress(state: RunState): number {
  switch (state.state) {
    case 'ARCHIVING': case 'STARTING': return 0
    case 'STT': return 1
    case 'TRANSLATING': return 2
    case 'SYNTHESIZING': case 'STOPPING': case 'REGENERATING': return 3
    case 'COMPLETE': case 'STOPPED': return 5
    default: return state.runTokenPresent ? 3 : 0
  }
}

function Timers({ state }: { state: RunState }) {
  const now = useNow(RUNNING.has(state.state))
  const t = state.timing
  if (!t || (!t.runStartedAt && t.elapsedSec == null)) return null

  const running = RUNNING.has(state.state)
  const frozen = state.state === 'COMPLETE' || state.state === 'STOPPED'

  // elapsed: live while running, frozen total when done
  let elapsedMs: number | null = null
  if (running && t.runStartedAt) elapsedMs = now - Date.parse(t.runStartedAt)
  else if (t.elapsedSec != null) elapsedMs = t.elapsedSec * 1000

  // eta: only during synthesis, ticking down to etaAt
  let eta: React.ReactNode = null
  if (state.state === 'SYNTHESIZING') {
    if (t.etaAt) {
      const remMs = Date.parse(t.etaAt) - now
      eta = remMs > 1000
        ? <>≈ залишилось <b>{fmtHuman(remMs)}</b> · завершення ~{fmtClock(t.etaAt)}{t.rowsPerMin ? ` · ${t.rowsPerMin}/хв` : ''}</>
        : <>ось-ось завершиться…</>
    } else {
      eta = <span className="text-gray-400">оцінюю час завершення…</span>
    }
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-1 rounded-lg bg-gray-50 px-3 py-2 text-sm dark:bg-[#202023]">
      {elapsedMs != null && (
        <span>{frozen ? 'Тривало:' : 'Іде:'} <b className="tabular-nums">{fmtHMS(elapsedMs)}</b></span>
      )}
      {eta && <span className="text-gray-600">{eta}</span>}
      {(state.state === 'SYNTHESIZING' || state.state === 'REGENERATING') && t.rowsTotal > 0 && (
        <span className="text-gray-400">{t.rowsDone}/{t.rowsTotal} рядків</span>
      )}
    </div>
  )
}

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [active])
  return now
}

function pad(n: number) { return String(n).padStart(2, '0') }
function fmtHMS(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`
}
function fmtHuman(ms: number) {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} с`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} хв`
  const h = Math.floor(m / 60), rm = m % 60
  return rm ? `${h} год ${rm} хв` : `${h} год`
}
function fmtClock(iso: string) {
  return new Date(iso).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })
}

function Loading() {
  return <div className="p-8 text-sm text-gray-400">Завантаження стану…</div>
}
