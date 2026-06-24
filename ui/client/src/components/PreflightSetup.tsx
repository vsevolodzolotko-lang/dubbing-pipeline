import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, ArrowRight, Check, Circle } from 'lucide-react'
import { useRunState } from '../api/useRunState'
import { fetchJson } from '../api/client'
import { startStagedRun, applyArchiveSettings, fetchPresets, applyVoiceSet } from '../api/staged'
import type { VoiceSet } from '../api/staged'
import type { ArchiveRun, ArchiveRunSummary } from '../api/types'

interface VoiceRow { lang: string; voice_id?: string; voice_name?: string }
interface ConfigRow { key: string; value: string; masked: boolean }
const CAN_START = new Set(['IDLE', 'COMPLETE', 'STOPPED', 'UNKNOWN'])
const ID_RE = /^[a-z][a-z0-9_]*$/

function slugify(s: string): string {
  let v = s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  if (!v) v = 'lesson'
  if (!/^[a-z]/.test(v)) v = `lesson_${v}`
  return v
}
const isPlaceholderVoice = (v?: VoiceRow) =>
  !!v && (/^voice_[a-z]{2}_id$/.test(v.voice_id || '') || /narrator$/i.test(v.voice_name || ''))

/**
 * Pre-flight setup shown after a file is dropped — confirm name, languages, and
 * readiness before the staged run starts. "Confirm, don't configure": fields are
 * pre-filled; the operator mostly glances and presses one button.
 */
export function PreflightSetup({ fileName, videoName, onCancel, onStart }: {
  fileName: string
  videoName?: string | null
  onCancel: () => void
  // Override the start action (Projects/Dashboard pass a "create project" closure);
  // defaults to the legacy staged-start. Same { ok, error } contract.
  onStart?: (lessonId: string, langs: string[]) => Promise<{ ok: boolean; error?: string }>
}) {
  const { state } = useRunState()
  const nav = useNavigate()
  // Project-create mode (onStart provided): a new project is its own sheet/dataset,
  // so the ACTIVE project's run state is irrelevant — don't gate on it (the legacy
  // single-lesson flow still does, to avoid stomping the one in-flight run).
  const projectMode = Boolean(onStart)

  const [lessonId, setLessonId] = useState(() => fileName.replace(/\.(wav|mp3|m4a)$/i, ''))
  const [voices, setVoices] = useState<VoiceRow[]>([])
  const [config, setConfig] = useState<ConfigRow[]>([])
  const [archive, setArchive] = useState<ArchiveRunSummary[]>([])
  const [sel, setSel] = useState<Set<string> | null>(null) // null until defaults computed
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // start-from-archive
  const [arcId, setArcId] = useState<string>('')
  const [arcDetail, setArcDetail] = useState<ArchiveRun | null>(null)
  const [applied, setApplied] = useState<string | null>(null)
  // start-from-voice-template
  const [sets, setSets] = useState<VoiceSet[]>([])
  const [tplId, setTplId] = useState<string>('')
  const [tplApplied, setTplApplied] = useState<string | null>(null)

  const allLangs = useMemo(() => voices.map((v) => v.lang), [voices])

  function loadSettings() {
    fetchJson<{ rows: VoiceRow[] }>('/api/voices').then((d) => setVoices(d.rows || [])).catch(() => {})
    fetchJson<{ rows: ConfigRow[] }>('/api/config').then((d) => setConfig(d.rows || [])).catch(() => {})
  }
  useEffect(() => {
    loadSettings()
    fetchJson<{ rows: ArchiveRunSummary[] }>('/api/archive').then((d) => setArchive(d.rows || [])).catch(() => {})
    fetchPresets().then((d) => setSets(d.sets || [])).catch(() => {})
  }, [])

  // default language selection from the last archived run (else all)
  useEffect(() => {
    if (sel !== null || !allLangs.length) return
    const last = archive[0]?.langs?.filter((l) => allLangs.includes(l))
    setSel(new Set(last && last.length ? last : allLangs))
  }, [allLangs, archive, sel])

  const selected = useMemo(() => allLangs.filter((l) => sel?.has(l)), [allLangs, sel])
  const cpsOf = (l: string) => config.find((r) => r.key === `cps_estimate_${l}`)?.value
  const voiceOf = (l: string) => voices.find((v) => v.lang === l)

  // ── readiness ──
  const idValid = ID_RE.test(lessonId)
  // The "already voiced → overwrites output" warning only applies to the legacy
  // single-sheet flow; a new project has its own sheet/folders, so suppress it.
  const dup = projectMode ? undefined : archive.find((r) => r.lessonId === lessonId)
  const missingVoice = selected.filter((l) => !(voiceOf(l)?.voice_id || '').trim())
  const placeholderVoice = selected.filter((l) => isPlaceholderVoice(voiceOf(l)))
  const cpsIssues = selected.filter((l) => {
    const v = Number(cpsOf(l)); return !cpsOf(l) || isNaN(v) || v < 5 || v > 25
  })
  const canStart = Boolean(state?.enableWrites) && (projectMode || CAN_START.has(state?.state ?? ''))
  const busyRun = !projectMode && state?.staged && !canStart

  const blocks: string[] = []
  if (!idValid) blocks.push('invalid lesson name')
  if (!selected.length) blocks.push('no language selected')
  if (missingVoice.length) blocks.push(`missing voice_id: ${missingVoice.join(', ')}`)
  if (!state?.enableWrites) blocks.push('writes disabled')
  if (busyRun) blocks.push('another staged run is in progress')
  const warns: string[] = []
  if (dup) warns.push(`lesson "${lessonId}" is already in the archive`)
  if (placeholderVoice.length) warns.push(`placeholder voice: ${placeholderVoice.join(', ')}`)
  if (cpsIssues.length) warns.push(`CPS unset/out of range: ${cpsIssues.join(', ')}`)

  function toggle(l: string) {
    const base = new Set(sel ?? allLangs)
    if (base.has(l)) base.delete(l); else base.add(l)
    setSel(base)
  }

  async function applyArchive() {
    if (!arcId) return
    setBusy(true); setErr(null)
    try {
      const res = await applyArchiveSettings(arcId)
      if (!res.ok) { setErr(res.error || 'failed to apply'); return }
      if (res.activeLangs?.length) setSel(new Set(res.activeLangs))
      loadSettings()
      setApplied(arcDetail?.lessonId || arcId)
    } catch (e) { setErr(e instanceof Error ? e.message : 'error') }
    finally { setBusy(false) }
  }

  async function pickArchive(id: string) {
    setArcId(id); setArcDetail(null); setApplied(null)
    if (id) { try { setArcDetail(await fetchJson<ArchiveRun>(`/api/archive/${id}`)) } catch { /* */ } }
  }

  const tplSet = sets.find((s) => s.id === tplId) || null
  function pickTemplate(id: string) { setTplId(id); setTplApplied(null) }
  async function applyTemplate() {
    if (!tplSet) return
    setBusy(true); setErr(null)
    try {
      const res = await applyVoiceSet(tplSet.voices)
      if (!res.ok) { setErr(res.error || 'failed to apply template'); return }
      loadSettings() // refresh readiness chips with the new voices
      setTplApplied(tplSet.name)
    } catch (e) { setErr(e instanceof Error ? e.message : 'error') }
    finally { setBusy(false) }
  }

  async function start() {
    if (blocks.length || busy) return
    setBusy(true); setErr(null)
    try {
      const res = onStart ? await onStart(lessonId, selected) : await startStagedRun(lessonId, selected)
      if (!res.ok) { setErr(res.error || 'failed to start'); return }
      nav('/transcript')
    } catch (e) { setErr(e instanceof Error ? e.message : 'error') }
    finally { setBusy(false) }
  }

  const firstLang = selected[0] || 'de'

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Lesson setup</h2>
        <button onClick={onCancel} className="ml-auto text-xs text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">cancel</button>
      </div>
      <div className="flex flex-col gap-0.5 text-xs text-gray-400">
        <span>audio: {fileName}</span>
        <span>{videoName ? `video: ${videoName} · reference (optional)` : 'video: not added · reference is optional'}</span>
      </div>

      {/* lesson name */}
      <div>
        <label className="text-xs font-medium text-gray-500">Lesson name (lesson_id)</label>
        <div className="mt-1 flex items-center gap-2">
          <input value={lessonId} onChange={(e) => setLessonId(e.target.value)}
            className={`w-56 rounded border px-2 py-1 font-mono text-sm dark:bg-[#161617] ${idValid ? 'border-gray-300 dark:border-[#3a3a3d]' : 'border-red-400 dark:border-red-700'}`} />
          {!idValid && (
            <button onClick={() => setLessonId(slugify(lessonId))} className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50 dark:border-[#3a3a3d] dark:hover:bg-[#202023]">
              auto-fix <ArrowRight className="inline-block h-3.5 w-3.5 align-[-0.2em]" strokeWidth={1.75} /> {slugify(lessonId)}
            </button>
          )}
        </div>
        {!idValid && <div className="mt-1 text-xs text-red-600 dark:text-red-400">lowercase Latin letters, digits, "_" only; must start with a letter</div>}
        <div className="mt-1 font-mono text-[11px] text-gray-400">
          <ArrowRight className="inline-block h-3.5 w-3.5 align-[-0.2em]" strokeWidth={1.75} /> {lessonId}_seg_001 · {lessonId}_full_{firstLang}.wav
        </div>
        {dup && <div className="mt-1 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"><AlertTriangle className="inline-block h-3.5 w-3.5 align-[-0.2em]" strokeWidth={1.75} /> lesson "{lessonId}" is already localized — starting will overwrite its output</div>}
      </div>

      {/* languages */}
      <div>
        <label className="text-xs font-medium text-gray-500">Languages ({selected.length})</label>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {allLangs.map((l) => {
            const on = sel?.has(l)
            const bad = missingVoice.includes(l)
            const warn = !bad && (placeholderVoice.includes(l) || cpsIssues.includes(l))
            return (
              <button key={l} onClick={() => toggle(l)}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
                  on ? (bad ? 'border-red-400 bg-red-50 text-red-700 dark:border-red-700 dark:bg-red-950/40 dark:text-red-300'
                    : warn ? 'border-amber-400 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
                    : 'border-gray-900 bg-gray-900 text-white dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900')
                  : 'border-gray-300 bg-white text-gray-500 dark:border-[#3a3a3d] dark:bg-[#161617] dark:text-gray-400'}`}>
                {l.toUpperCase()}
              </button>
            )
          })}
          <button onClick={() => setSel(new Set(allLangs))} className="rounded-full px-2 py-1 text-xs text-gray-400 underline">all</button>
        </div>
      </div>

      {/* readiness */}
      <div className="space-y-1 text-xs">
        <ReadyRow label="Voices" ok={!missingVoice.length && !placeholderVoice.length}
          bad={missingVoice.length > 0}
          text={missingVoice.length ? `missing voice_id: ${missingVoice.join(', ')} (blocking)`
            : placeholderVoice.length ? `placeholder: ${placeholderVoice.join(', ')}` : 'all selected languages have a voice'}
          link="/voices" />
        <ReadyRow label="CPS" ok={!cpsIssues.length} bad={false}
          text={cpsIssues.length ? `check cps_estimate: ${cpsIssues.join(', ')}` : 'CPS is within range for the selected languages'}
          link="/config" />
        <ReadyRow label="State" ok={canStart} bad={!canStart}
          text={busyRun ? 'another staged run is in progress' : !state?.enableWrites ? 'writes disabled (ENABLE_WRITES)' : 'free — ready to start'} />
      </div>

      {/* start from saved settings: archive snapshot OR voice template (always shown) */}
      <div className="space-y-2 rounded-lg border border-gray-200 p-2 dark:border-[#29292c]">
        <div className="text-xs font-medium text-gray-500">Start from saved</div>

        {/* archive — full settings snapshot of a past run */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-28 shrink-0 text-[11px] text-gray-400">Archive</span>
          {archive.length === 0 ? (
            <span className="text-[11px] text-gray-400">archive is empty</span>
          ) : (
            <>
              <select value={arcId} onChange={(e) => pickArchive(e.target.value)}
                className="rounded border border-gray-300 px-1.5 py-0.5 text-xs dark:border-[#3a3a3d] dark:bg-[#161617]">
                <option value="">— clean start —</option>
                {archive.map((r) => <option key={r.id} value={r.id}>{r.lessonId} ({r.langCount} langs)</option>)}
              </select>
              {arcId && <button onClick={applyArchive} disabled={busy} className="rounded bg-gray-900 px-2 py-0.5 text-xs text-white hover:bg-gray-700 disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900">Apply</button>}
              {applied && <span className="text-xs text-green-700 dark:text-green-400"><Check className="inline-block h-3.5 w-3.5 align-[-0.2em]" strokeWidth={1.75} /> from "{applied}"</span>}
            </>
          )}
        </div>
        {arcDetail && !applied && <ArchiveDiff detail={arcDetail} voices={voices} config={config} />}

        {/* voice template — just a saved set of voices */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-28 shrink-0 text-[11px] text-gray-400">Voice template</span>
          {sets.length === 0 ? (
            <span className="text-[11px] text-gray-400">no templates — save a set at <a href="/voices" className="text-blue-600 underline dark:text-blue-400">/voices</a></span>
          ) : (
            <>
              <select value={tplId} onChange={(e) => pickTemplate(e.target.value)}
                className="rounded border border-gray-300 px-1.5 py-0.5 text-xs dark:border-[#3a3a3d] dark:bg-[#161617]">
                <option value="">— do not apply —</option>
                {sets.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.voices.length} langs)</option>)}
              </select>
              {tplSet && <button onClick={applyTemplate} disabled={busy} className="rounded bg-gray-900 px-2 py-0.5 text-xs text-white hover:bg-gray-700 disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900">Apply</button>}
              {tplApplied && <span className="text-xs text-green-700 dark:text-green-400"><Check className="inline-block h-3.5 w-3.5 align-[-0.2em]" strokeWidth={1.75} /> voices from "{tplApplied}"</span>}
            </>
          )}
        </div>
        {tplSet && !tplApplied && <TemplateDiff set={tplSet} voices={voices} selected={selected} />}
      </div>

      {err && <div className="rounded bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950/50 dark:text-red-300">{err}</div>}

      {/* start */}
      <div>
        <button onClick={start} disabled={blocks.length > 0 || busy}
          className={`w-full rounded-md px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed ${
            blocks.length ? 'bg-gray-300 dark:bg-[#3a3a3d] dark:text-gray-500'
            : warns.length ? 'bg-amber-600 hover:bg-amber-700'
            : 'bg-green-700 hover:bg-green-800'}`}>
          {busy ? (projectMode ? 'Creating…' : 'Starting…') : blocks.length ? `Unavailable: ${blocks[0]}` : warns.length ? `Start despite warnings (${warns.length})` : projectMode ? 'Create project' : 'Start lesson'}
        </button>
        <p className="mt-2 text-[11px] text-gray-400">Separate path from the auto flow: a file in Drive <code>01_input</code> still starts full automation without gates.</p>
      </div>
    </div>
  )
}

function ReadyRow({ label, ok, bad, text, link }: { label: string; ok: boolean; bad: boolean; text: string; link?: string }) {
  const dotClass = bad
    ? 'inline-block h-2.5 w-2.5 fill-red-500 text-red-500'
    : ok
      ? 'inline-block h-2.5 w-2.5 fill-green-500 text-green-500'
      : 'inline-block h-2.5 w-2.5 fill-amber-500 text-amber-500'
  return (
    <div className="flex items-center gap-2">
      <Circle className={dotClass} />
      <span className="w-14 shrink-0 font-medium text-gray-600 dark:text-gray-400">{label}</span>
      <span className="text-gray-600 dark:text-gray-400">{text}</span>
      {link && !ok && <a href={link} className="ml-auto inline-flex items-center gap-1 text-blue-600 underline dark:text-blue-400">configure <ArrowRight className="inline-block h-3.5 w-3.5 align-[-0.2em]" strokeWidth={1.75} /></a>}
    </div>
  )
}

function ArchiveDiff({ detail, voices, config }: { detail: ArchiveRun; voices: VoiceRow[]; config: ConfigRow[] }) {
  const changes: string[] = []
  for (const l of detail.settings.activeLangs) {
    const snapV = detail.settings.voices.find((v) => v.lang === l)?.voice_id
    const liveV = voices.find((v) => v.lang === l)?.voice_id
    if (snapV && liveV && snapV !== liveV) changes.push(`${l}: voice will change`)
    const snapC = detail.settings.config[`cps_estimate_${l}`]
    const liveC = config.find((r) => r.key === `cps_estimate_${l}`)?.value
    if (snapC && liveC && snapC !== liveC) changes.push(`cps ${l}: ${liveC}–${snapC}`)
  }
  return (
    <div className="mt-1.5 text-[11px] text-gray-500 dark:text-gray-400">
      Languages: {detail.settings.activeLangs.join(', ')}.{' '}
      {changes.length ? `Changes: ${changes.slice(0, 5).join('; ')}${changes.length > 5 ? '…' : ''}` : 'settings match the current ones'}
    </div>
  )
}

function TemplateDiff({ set, voices, selected }: { set: VoiceSet; voices: VoiceRow[]; selected: string[] }) {
  const willChange: string[] = []
  let covered = 0
  for (const l of selected) {
    const tpl = set.voices.find((v) => v.lang === l)
    if (!tpl) continue
    covered++
    const live = voices.find((v) => v.lang === l)?.voice_id || ''
    if (tpl.voice_id && tpl.voice_id !== live) willChange.push(l)
  }
  const missing = selected.filter((l) => !set.voices.some((v) => v.lang === l))
  return (
    <div className="text-[11px] text-gray-500 dark:text-gray-400">
      Covers {covered}/{selected.length} selected languages.{' '}
      {willChange.length ? `Voice will change: ${willChange.join(', ')}.` : 'voices match.'}
      {missing.length ? ` Not in template: ${missing.join(', ')}.` : ''}
    </div>
  )
}
