import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, ChevronDown, ChevronRight, ExternalLink, Play, Save, X } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchJson } from '../api/client'
import { useRunState } from '../api/useRunState'
import { canWrite, writeBlockReason } from '../ui'
import { VoiceSetsModal } from '../components/VoiceSetsModal'
import type { Lesson } from '../api/types'

interface Voice {
  lang: string; voice_id?: string; voice_name?: string; model?: string
  stability?: string; similarity_boost?: string; style?: string; speed?: string; notes?: string
}
interface Preset { id: string; name: string; createdAt?: string; voice_id?: string; voice_name?: string; model?: string; stability?: string; similarity_boost?: string; style?: string; speed?: string }
interface VoiceSet { id: string; name: string; createdAt?: string; voices: (Preset & { lang: string })[] }
interface Library { voices: Preset[]; sets: VoiceSet[] }

const NUM_FIELDS: { key: keyof Voice; label: string; min: number; max: number; step: number }[] = [
  { key: 'stability', label: 'stability', min: 0, max: 1, step: 0.05 },
  { key: 'similarity_boost', label: 'similarity', min: 0, max: 1, step: 0.05 },
  { key: 'style', label: 'style', min: 0, max: 1, step: 0.05 },
  { key: 'speed', label: 'speed', min: 0.5, max: 1.5, step: 0.01 },
]
const VFIELDS = ['voice_id', 'voice_name', 'model', 'stability', 'similarity_boost', 'style', 'speed'] as const
function pick(src: object) {
  const r = src as Record<string, unknown>
  const o: Record<string, string> = {}
  for (const k of VFIELDS) if (r[k] != null && r[k] !== '') o[k] = String(r[k])
  return o
}

type ApplySignal = { lang: string; fields: Record<string, string>; n: number }

export function Voices() {
  const { state } = useRunState()
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['voices'], queryFn: () => fetchJson<{ rows: Voice[] }>('/api/voices') })
  const { data: lesson } = useQuery({ queryKey: ['lesson'], queryFn: () => fetchJson<Lesson>('/api/lesson') })
  const { data: lib } = useQuery({ queryKey: ['presets'], queryFn: () => fetchJson<Library>('/api/presets') })
  const [apply, setApply] = useState<ApplySignal | null>(null)

  const samples = useMemo(() => {
    const m: Record<string, string> = {}
    for (const s of lesson?.segments ?? []) for (const [lg, c] of Object.entries(s.cells)) if (!m[lg] && c.textTranslated) m[lg] = c.textTranslated
    return m
  }, [lesson])

  if (isLoading) return <div className="p-8 text-sm text-gray-400">Loading voices…</div>
  const writable = canWrite(state)
  const live = state?.mode === 'live'
  const rows = data?.rows ?? []
  const langs = rows.map((v) => v.lang)
  const refreshLib = () => qc.invalidateQueries({ queryKey: ['presets'] })

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">Voices</h1>
        {!writable && <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-700">editing: {writeBlockReason(state)}</span>}
      </div>
      <p className="mt-1 max-w-prose text-sm text-gray-500">
        ElevenLabs parameters for each language. Paste text and <b>preview the voice</b> with the current (even unsaved) parameters.{' '}
        <a href="https://elevenlabs.io/app/voice-library" target="_blank" rel="noreferrer" className="text-blue-700 underline">Voice Library <ExternalLink className="inline-block h-3.5 w-3.5 align-[-0.2em]" strokeWidth={1.75} /></a>
      </p>

      <LibraryPanel lib={lib} rows={rows} langs={langs} writable={writable} onChanged={refreshLib}
        onApplyToLang={(lang, fields) => setApply((p) => ({ lang, fields, n: (p?.n ?? 0) + 1 }))} />

      <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-2">
        {rows.map((v) => (
          <VoiceCard key={v.lang} voice={v} writable={writable} live={live} sample={samples[v.lang] || ''}
            apply={apply?.lang === v.lang ? apply : null}
            onSaved={() => qc.invalidateQueries({ queryKey: ['voices'] })} onLibraryChanged={refreshLib} />
        ))}
      </div>
    </div>
  )
}

function LibraryPanel({ lib, rows, langs, writable, onChanged, onApplyToLang }: {
  lib?: Library; rows: Voice[]; langs: string[]; writable: boolean
  onChanged: () => void; onApplyToLang: (lang: string, fields: Record<string, string>) => void
}) {
  const [setsOpen, setSetsOpen] = useState(false)
  const voices = lib?.voices ?? []
  const sets = lib?.sets ?? []

  async function delVoice(id: string) {
    await fetch(`/api/presets/voice/${id}`, { method: 'DELETE' })
    onChanged()
  }

  return (
    <div className="mt-4 rounded-xl border border-gray-200 dark:border-[#29292c] bg-gray-50 dark:bg-[#202023] p-4">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Voice library</h2>
        <button onClick={() => setSetsOpen(true)}
          className="rounded border border-gray-300 dark:border-[#3a3a3d] bg-white dark:bg-[#161617] px-2 py-1 text-xs hover:bg-gray-100 dark:hover:bg-[#29292c]">
          Voice sets by course ({sets.length})
        </button>
      </div>

      <div className="mt-3">
        <div className="mb-1 text-xs font-medium text-gray-500">Individual voices ({voices.length})</div>
        {voices.length === 0 ? <div className="text-xs text-gray-400">empty — save a voice from a card below</div> : (
          <ul className="grid grid-cols-1 gap-1 md:grid-cols-2">
            {voices.map((p) => (
              <li key={p.id} className="flex items-center gap-2 rounded border border-gray-200 dark:border-[#29292c] bg-white dark:bg-[#161617] px-2 py-1 text-sm">
                <span className="flex-1 truncate" title={`${p.voice_name || ''} ${p.voice_id || ''}`}>{p.name}</span>
                <LangApply langs={langs} onApply={(lang) => onApplyToLang(lang, pick(p))} />
                <button onClick={() => delVoice(p.id)} className="text-gray-400 hover:text-red-600"><X className="h-4 w-4" strokeWidth={1.75} /></button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {setsOpen && (
        <VoiceSetsModal sets={sets} rows={rows} writable={writable} onChanged={onChanged} onClose={() => setSetsOpen(false)} />
      )}
    </div>
  )
}

function LangApply({ langs, onApply }: { langs: string[]; onApply: (lang: string) => void }) {
  const [lang, setLang] = useState(langs[0] || '')
  return (
    <span className="flex items-center gap-1">
      <select value={lang} onChange={(e) => setLang(e.target.value)} className="rounded border border-gray-300 dark:border-[#3a3a3d] px-1 py-0.5 text-xs">
        {langs.map((l) => <option key={l} value={l}>{l}</option>)}
      </select>
      <button onClick={() => lang && onApply(lang)} className="rounded border border-gray-300 dark:border-[#3a3a3d] px-2 py-0.5 text-xs hover:bg-gray-100"><ArrowRight className="h-4 w-4" strokeWidth={1.75} /></button>
    </span>
  )
}

function VoiceCard({ voice, writable, live, sample, apply, onSaved, onLibraryChanged }: {
  voice: Voice; writable: boolean; live: boolean; sample: string
  apply: ApplySignal | null; onSaved: () => void; onLibraryChanged: () => void
}) {
  const [form, setForm] = useState<Voice>(voice)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const [saveErr, setSaveErr] = useState(false)
  const [testMsg, setTestMsg] = useState<string | null>(null)
  const [tests, setTests] = useState(0)
  const [showListen, setShowListen] = useState(false)
  const audioRef = useRef<HTMLAudioElement>(null)
  const urlRef = useRef<string | null>(null)

  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current) }, [])
  // apply a library preset into this card's form
  useEffect(() => { if (apply) { setForm((f) => ({ ...f, ...apply.fields })); setSaveErr(false); setSaveMsg('from library (click Save)') } }, [apply?.n]) // eslint-disable-line react-hooks/exhaustive-deps

  const changed = (Object.keys(voice) as (keyof Voice)[]).some((k) => (form[k] ?? '') !== (voice[k] ?? '')) ||
    VFIELDS.some((k) => (form[k] ?? '') !== (voice[k] ?? ''))
  const voiceIdChanged = (form.voice_id ?? '') !== (voice.voice_id ?? '')
  const set = (k: keyof Voice, val: string) => setForm((f) => ({ ...f, [k]: val }))

  async function save() {
    setBusy(true); setSaveMsg(null); setSaveErr(false)
    const fields: Record<string, string> = {}
    for (const k of VFIELDS) if ((form[k] ?? '') !== (voice[k] ?? '')) fields[k] = String(form[k] ?? '')
    try {
      const res = await fetch(`/api/voices/${voice.lang}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }) })
      const d = await res.json().catch(() => ({}))
      const ok = res.ok && d.ok
      setSaveErr(!ok)
      setSaveMsg(ok ? 'Saved' : `${d.error || res.status}`)
      if (ok) onSaved()
    } catch (e) { setSaveErr(true); setSaveMsg(`${e}`) } finally { setBusy(false) }
  }

  async function saveToLibrary() {
    const name = window.prompt(`Preset name for voice ${voice.lang}:`, form.voice_name || voice.lang)
    if (!name) return
    await fetch('/api/presets/voice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, ...pick(form) }) })
    onLibraryChanged(); setSaveErr(false); setSaveMsg(`"${name}" added to library`)
  }

  async function play() {
    if (!text.trim()) { setTestMsg('paste text'); return }
    setBusy(true); setTestMsg('synthesizing…')
    try {
      const res = await fetch('/api/voices/test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voiceId: form.voice_id, modelId: form.model || 'eleven_multilingual_v2', stability: form.stability, similarityBoost: form.similarity_boost, style: form.style, speed: form.speed, text }),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); setTestMsg(`${d.error || res.status}`); return }
      const blob = await res.blob()
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
      urlRef.current = URL.createObjectURL(blob)
      if (audioRef.current) { audioRef.current.src = urlRef.current; await audioRef.current.play().catch(() => {}) }
      setTests((n) => n + 1); setTestMsg(null)
    } catch (e) { setTestMsg(`${e}`) } finally { setBusy(false) }
  }

  return (
    <div className="rounded-xl border border-gray-200 dark:border-[#29292c] bg-white dark:bg-[#161617] p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="font-mono text-sm font-semibold">{voice.lang}</span>
        {changed && writable && <button onClick={save} disabled={busy} className="rounded bg-gray-900 px-2 py-1 text-xs text-white hover:bg-gray-700 disabled:opacity-50">Save</button>}
        <button onClick={saveToLibrary} className="inline-flex items-center gap-1 rounded border border-gray-300 dark:border-[#3a3a3d] px-2 py-1 text-xs hover:bg-gray-100 dark:hover:bg-[#202023]" title="Save these parameters to the library"><Save className="h-3.5 w-3.5" strokeWidth={1.75} /> To library</button>
        {saveMsg && <span className={`text-xs ${saveErr ? 'text-red-700' : 'text-gray-500'}`}>{saveMsg}</span>}
      </div>

      {/* row 1: identity — id (flex) · name · model */}
      <div className="flex flex-wrap items-end gap-2 text-sm">
        <label className="flex min-w-[10rem] flex-1 flex-col gap-0.5">
          <span className="text-[11px] text-gray-400">voice_id</span>
          <input value={form.voice_id ?? ''} onChange={(e) => set('voice_id', e.target.value)} disabled={!writable} className="rounded border border-gray-300 dark:border-[#3a3a3d] px-2 py-1 font-mono text-xs disabled:bg-gray-100 dark:disabled:bg-[#202023]" />
        </label>
        <label className="flex w-28 flex-col gap-0.5">
          <span className="text-[11px] text-gray-400">voice_name</span>
          <input value={form.voice_name ?? ''} onChange={(e) => set('voice_name', e.target.value)} disabled={!writable} className="rounded border border-gray-300 dark:border-[#3a3a3d] px-2 py-1 text-xs disabled:bg-gray-100 dark:disabled:bg-[#202023]" />
        </label>
        <label className="flex w-28 flex-col gap-0.5">
          <span className="text-[11px] text-gray-400">model</span>
          <input value={form.model ?? ''} onChange={(e) => set('model', e.target.value)} disabled={!writable} className="rounded border border-gray-300 dark:border-[#3a3a3d] px-2 py-1 text-xs disabled:bg-gray-100 dark:disabled:bg-[#202023]" />
        </label>
      </div>

      {/* row 2: the four tuning numbers, one compact row */}
      <div className="mt-2 grid grid-cols-4 gap-2 text-sm">
        {NUM_FIELDS.map((f) => (
          <label key={f.key} className="flex flex-col gap-0.5">
            <span className="text-[11px] text-gray-400">{f.label}</span>
            <input type="number" min={f.min} max={f.max} step={f.step} value={form[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)} disabled={!writable} className="rounded border border-gray-300 dark:border-[#3a3a3d] px-2 py-1 text-xs disabled:bg-gray-100 dark:disabled:bg-[#202023]" />
          </label>
        ))}
      </div>

      {voiceIdChanged && <div className="mt-2 rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">Note: voice changed — recalibrate CPS after the next lesson ({voice.lang}).</div>}

      {/* listen panel — collapsed by default to keep the card short */}
      <button onClick={() => setShowListen((s) => !s)}
        className="mt-2 flex w-full items-center gap-1 text-[11px] font-medium text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
        {showListen ? <ChevronDown className="h-4 w-4 shrink-0" strokeWidth={1.75} /> : <ChevronRight className="h-4 w-4 shrink-0" strokeWidth={1.75} />} Preview voice
      </button>
      {showListen && (
        <div className="mt-1.5 rounded-lg bg-gray-50 dark:bg-[#202023] p-2">
          {sample && <button onClick={() => setText(sample)} className="mb-1 text-[11px] text-blue-700 underline">example from lesson</button>}
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder={`Paste text in ${voice.lang}…`} className="w-full resize-y rounded border border-gray-300 dark:border-[#3a3a3d] px-2 py-1 text-sm" />
          <div className="mt-1 flex items-center gap-2">
            <button onClick={play} disabled={busy || !live} title={live ? '' : 'live mode only'} className="inline-flex items-center gap-1 rounded-md bg-gray-900 px-3 py-1 text-sm text-white hover:bg-gray-700 disabled:opacity-40"><Play className="h-3.5 w-3.5" strokeWidth={1.75} /> Preview</button>
            <span className="text-[11px] text-gray-400">{tests > 0 ? `tests: ${tests}` : 'PCM 44.1k, same as the pipeline'}</span>
            {testMsg && <span className="text-xs text-red-700">{testMsg}</span>}
          </div>
          <audio ref={audioRef} className="mt-2 w-full" controls />
        </div>
      )}
    </div>
  )
}
