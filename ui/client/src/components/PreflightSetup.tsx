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
export function PreflightSetup({ fileName, videoName, onCancel }: { fileName: string; videoName?: string | null; onCancel: () => void }) {
  const { state } = useRunState()
  const nav = useNavigate()

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
  const dup = archive.find((r) => r.lessonId === lessonId)
  const missingVoice = selected.filter((l) => !(voiceOf(l)?.voice_id || '').trim())
  const placeholderVoice = selected.filter((l) => isPlaceholderVoice(voiceOf(l)))
  const cpsIssues = selected.filter((l) => {
    const v = Number(cpsOf(l)); return !cpsOf(l) || isNaN(v) || v < 5 || v > 25
  })
  const canStart = Boolean(state?.enableWrites) && CAN_START.has(state?.state ?? '')
  const busyRun = state?.staged && !canStart

  const blocks: string[] = []
  if (!idValid) blocks.push('некоректна назва уроку')
  if (!selected.length) blocks.push('не вибрано жодної мови')
  if (missingVoice.length) blocks.push(`нема voice_id: ${missingVoice.join(', ')}`)
  if (!state?.enableWrites) blocks.push('записи вимкнені')
  if (busyRun) blocks.push('triває інший staged-ран')
  const warns: string[] = []
  if (dup) warns.push(`урок «${lessonId}» вже в архіві`)
  if (placeholderVoice.length) warns.push(`голос-плейсхолдер: ${placeholderVoice.join(', ')}`)
  if (cpsIssues.length) warns.push(`CPS не задано/поза межами: ${cpsIssues.join(', ')}`)

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
      if (!res.ok) { setErr(res.error || 'не вдалося застосувати'); return }
      if (res.activeLangs?.length) setSel(new Set(res.activeLangs))
      loadSettings()
      setApplied(arcDetail?.lessonId || arcId)
    } catch (e) { setErr(e instanceof Error ? e.message : 'помилка') }
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
      if (!res.ok) { setErr(res.error || 'не вдалося застосувати шаблон'); return }
      loadSettings() // refresh readiness chips with the new voices
      setTplApplied(tplSet.name)
    } catch (e) { setErr(e instanceof Error ? e.message : 'помилка') }
    finally { setBusy(false) }
  }

  async function start() {
    if (blocks.length || busy) return
    setBusy(true); setErr(null)
    try {
      const res = await startStagedRun(lessonId, selected)
      if (!res.ok) { setErr(res.error || 'не вдалося стартувати'); return }
      nav('/transcript')
    } catch (e) { setErr(e instanceof Error ? e.message : 'помилка') }
    finally { setBusy(false) }
  }

  const firstLang = selected[0] || 'de'

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Підготовка уроку</h2>
        <button onClick={onCancel} className="ml-auto text-xs text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">скасувати</button>
      </div>
      <div className="flex flex-col gap-0.5 text-xs text-gray-400">
        <span>аудіо: {fileName}</span>
        <span>{videoName ? `відео: ${videoName} · референс (необов'язково)` : 'відео: не додано · референс необов’язковий'}</span>
      </div>

      {/* lesson name */}
      <div>
        <label className="text-xs font-medium text-gray-500">Назва уроку (lesson_id)</label>
        <div className="mt-1 flex items-center gap-2">
          <input value={lessonId} onChange={(e) => setLessonId(e.target.value)}
            className={`w-56 rounded border px-2 py-1 font-mono text-sm dark:bg-[#161617] ${idValid ? 'border-gray-300 dark:border-[#3a3a3d]' : 'border-red-400 dark:border-red-700'}`} />
          {!idValid && (
            <button onClick={() => setLessonId(slugify(lessonId))} className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50 dark:border-[#3a3a3d] dark:hover:bg-[#202023]">
              авто-фікс <ArrowRight className="inline-block h-3.5 w-3.5 align-[-0.2em]" strokeWidth={1.75} /> {slugify(lessonId)}
            </button>
          )}
        </div>
        {!idValid && <div className="mt-1 text-xs text-red-600 dark:text-red-400">тільки малі латинські літери, цифри, «_»; починати з літери</div>}
        <div className="mt-1 font-mono text-[11px] text-gray-400">
          <ArrowRight className="inline-block h-3.5 w-3.5 align-[-0.2em]" strokeWidth={1.75} /> {lessonId}_seg_001 · {lessonId}_full_{firstLang}.wav
        </div>
        {dup && <div className="mt-1 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"><AlertTriangle className="inline-block h-3.5 w-3.5 align-[-0.2em]" strokeWidth={1.75} /> урок «{lessonId}» уже озвучено — старт перепише його output</div>}
      </div>

      {/* languages */}
      <div>
        <label className="text-xs font-medium text-gray-500">Мови ({selected.length})</label>
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
          <button onClick={() => setSel(new Set(allLangs))} className="rounded-full px-2 py-1 text-xs text-gray-400 underline">усі</button>
        </div>
      </div>

      {/* readiness */}
      <div className="space-y-1 text-xs">
        <ReadyRow label="Голоси" ok={!missingVoice.length && !placeholderVoice.length}
          bad={missingVoice.length > 0}
          text={missingVoice.length ? `нема voice_id: ${missingVoice.join(', ')} (блокує)`
            : placeholderVoice.length ? `плейсхолдер: ${placeholderVoice.join(', ')}` : 'усі вибрані мови мають голос'}
          link="/voices" />
        <ReadyRow label="CPS" ok={!cpsIssues.length} bad={false}
          text={cpsIssues.length ? `перевір cps_estimate: ${cpsIssues.join(', ')}` : 'CPS у нормі для вибраних мов'}
          link="/config" />
        <ReadyRow label="Стан" ok={canStart} bad={!canStart}
          text={busyRun ? 'triває інший staged-ран' : !state?.enableWrites ? 'записи вимкнені (ENABLE_WRITES)' : 'вільно — можна стартувати'} />
      </div>

      {/* start from saved settings: archive snapshot OR voice template (always shown) */}
      <div className="space-y-2 rounded-lg border border-gray-200 p-2 dark:border-[#29292c]">
        <div className="text-xs font-medium text-gray-500">Старт із збереженого</div>

        {/* archive — full settings snapshot of a past run */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-28 shrink-0 text-[11px] text-gray-400">Архів</span>
          {archive.length === 0 ? (
            <span className="text-[11px] text-gray-400">архів порожній</span>
          ) : (
            <>
              <select value={arcId} onChange={(e) => pickArchive(e.target.value)}
                className="rounded border border-gray-300 px-1.5 py-0.5 text-xs dark:border-[#3a3a3d] dark:bg-[#161617]">
                <option value="">— чистий старт —</option>
                {archive.map((r) => <option key={r.id} value={r.id}>{r.lessonId} ({r.langCount} мов)</option>)}
              </select>
              {arcId && <button onClick={applyArchive} disabled={busy} className="rounded bg-gray-900 px-2 py-0.5 text-xs text-white hover:bg-gray-700 disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900">Застосувати</button>}
              {applied && <span className="text-xs text-green-700 dark:text-green-400"><Check className="inline-block h-3.5 w-3.5 align-[-0.2em]" strokeWidth={1.75} /> з «{applied}»</span>}
            </>
          )}
        </div>
        {arcDetail && !applied && <ArchiveDiff detail={arcDetail} voices={voices} config={config} />}

        {/* voice template — just a saved set of voices */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-28 shrink-0 text-[11px] text-gray-400">Шаблон голосів</span>
          {sets.length === 0 ? (
            <span className="text-[11px] text-gray-400">шаблонів нема — збережи набір на <a href="/voices" className="text-blue-600 underline dark:text-blue-400">/voices</a></span>
          ) : (
            <>
              <select value={tplId} onChange={(e) => pickTemplate(e.target.value)}
                className="rounded border border-gray-300 px-1.5 py-0.5 text-xs dark:border-[#3a3a3d] dark:bg-[#161617]">
                <option value="">— не застосовувати —</option>
                {sets.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.voices.length} мов)</option>)}
              </select>
              {tplSet && <button onClick={applyTemplate} disabled={busy} className="rounded bg-gray-900 px-2 py-0.5 text-xs text-white hover:bg-gray-700 disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900">Застосувати</button>}
              {tplApplied && <span className="text-xs text-green-700 dark:text-green-400"><Check className="inline-block h-3.5 w-3.5 align-[-0.2em]" strokeWidth={1.75} /> голоси з «{tplApplied}»</span>}
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
          {busy ? 'Стартую…' : blocks.length ? `Недоступно: ${blocks[0]}` : warns.length ? `Почати попри попередження (${warns.length})` : 'Почати урок'}
        </button>
        <p className="mt-2 text-[11px] text-gray-400">Окремий шлях від авто-потоку: файл у Drive <code>01_input</code> досі стартує повну автоматику без воріт.</p>
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
      {link && !ok && <a href={link} className="ml-auto inline-flex items-center gap-1 text-blue-600 underline dark:text-blue-400">налаштувати <ArrowRight className="inline-block h-3.5 w-3.5 align-[-0.2em]" strokeWidth={1.75} /></a>}
    </div>
  )
}

function ArchiveDiff({ detail, voices, config }: { detail: ArchiveRun; voices: VoiceRow[]; config: ConfigRow[] }) {
  const changes: string[] = []
  for (const l of detail.settings.activeLangs) {
    const snapV = detail.settings.voices.find((v) => v.lang === l)?.voice_id
    const liveV = voices.find((v) => v.lang === l)?.voice_id
    if (snapV && liveV && snapV !== liveV) changes.push(`${l}: голос зміниться`)
    const snapC = detail.settings.config[`cps_estimate_${l}`]
    const liveC = config.find((r) => r.key === `cps_estimate_${l}`)?.value
    if (snapC && liveC && snapC !== liveC) changes.push(`cps ${l}: ${liveC}–${snapC}`)
  }
  return (
    <div className="mt-1.5 text-[11px] text-gray-500 dark:text-gray-400">
      Мови: {detail.settings.activeLangs.join(', ')}.{' '}
      {changes.length ? `Зміни: ${changes.slice(0, 5).join('; ')}${changes.length > 5 ? '…' : ''}` : 'налаштування збігаються з поточними'}
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
      Покриває {covered}/{selected.length} вибраних мов.{' '}
      {willChange.length ? `Голос зміниться: ${willChange.join(', ')}.` : 'голоси збігаються.'}
      {missing.length ? ` Немає в шаблоні: ${missing.join(', ')}.` : ''}
    </div>
  )
}
