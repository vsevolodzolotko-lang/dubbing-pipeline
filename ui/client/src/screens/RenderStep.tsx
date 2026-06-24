import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Check, FileText, Captions, Table, Braces, AudioLines, Film, Package, Clapperboard,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useRunState } from '../api/useRunState'
import { useLesson } from '../api/queries'
import { getRenderPlan, startRender, type RenderPlan } from '../api/staged'
import {
  cuesFor, toVTT, toSRT, toTranslationCSV, toManifest,
  downloadText, downloadUrl, downloadSequence,
} from '../lib/exporters'

/**
 * Export hub (stage 4/4). Two things live here: (1) the staged assemble gate —
 * stitch the reviewed segments into continuous per-language files at RENDER_REVIEW;
 * (2) an export catalog — pull deliverables (subtitles, sheets, audio, …) out of the
 * reviewed localization. Text artifacts are generated client-side from the model;
 * audio uses the existing /api/audio endpoints; video/bundle are server render (Фаза P).
 */
export function RenderStep() {
  const { state } = useRunState()
  const { data: lesson } = useLesson()
  const nav = useNavigate()
  const [plan, setPlan] = useState<RenderPlan | null>(null)
  const [dest, setDest] = useState('')
  const [custom, setCustom] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [excluded, setExcluded] = useState<Set<string>>(new Set())

  const st = state?.state
  const atGate = st === 'RENDER_REVIEW'
  const rendering = st === 'RENDERING'
  const done = st === 'COMPLETE'
  const assembled = done || !!plan?.built
  const audioReady = st != null && ['AUDIO_REVIEW', 'RENDER_REVIEW', 'RENDERING', 'COMPLETE'].includes(st)

  useEffect(() => {
    getRenderPlan().then((p) => { setPlan(p); setDest((d) => d || p.destination) }).catch(() => {})
  }, [st])

  const langs = lesson?.langs ?? []
  const targets = langs.filter((l) => l !== 'en')
  const selected = langs.filter((l) => !excluded.has(l))
  const selectedTargets = selected.filter((l) => l !== 'en')
  const lid = lesson?.lessonId || plan?.lessonId || 'lesson'

  function toggle(l: string) {
    setExcluded((prev) => {
      const next = new Set(prev)
      next.has(l) ? next.delete(l) : next.add(l)
      return next
    })
  }

  async function build() {
    setBusy(true); setErr(null)
    try {
      const r = await startRender(dest)
      if (!r.ok) { setErr(r.error || 'failed to start assemble'); return }
    } catch (e) { setErr(e instanceof Error ? e.message : 'error') }
    finally { setBusy(false) }
  }

  // ── export actions (client-side text + existing audio endpoints) ─────────────
  const exportVtt = (l: string) => lesson && downloadText(`${lid}_${l}.vtt`, toVTT(cuesFor(lesson, l)), 'text/vtt;charset=utf-8')
  const exportSrt = (l: string) => lesson && downloadText(`${lid}_${l}.srt`, toSRT(cuesFor(lesson, l)), 'application/x-subrip;charset=utf-8')
  const exportCsv = () => lesson && downloadText(`${lid}_translations.csv`, toTranslationCSV(lesson), 'text/csv;charset=utf-8')
  const exportJson = () => lesson && downloadText(`${lid}_manifest.json`, JSON.stringify(toManifest(lesson), null, 2), 'application/json')
  const exportFullAudio = (l: string) => downloadUrl(`${lid}_full_${l}.wav`, `/api/audio/full/${l}`)
  const exportEnAudio = () => downloadUrl(`${lid}_en.wav`, '/api/audio/en')
  async function exportSegments(l: string) {
    const items = (lesson?.segments ?? [])
      .map((s) => { const rk = s.cells[l]?.rowKey; return rk ? { filename: `${lid}_${l}_${s.segmentId}.wav`, url: `/api/audio/segment/${rk}` } : null })
      .filter((x): x is { filename: string; url: string } => x !== null)
    if (!items.length) { setNote(`No per-segment audio for ${l.toUpperCase()} yet.`); return }
    setNote(`Downloading ${items.length} segment files for ${l.toUpperCase()}… (allow multiple downloads if prompted)`)
    await downloadSequence(items)
    setNote(`Queued ${items.length} segment files for ${l.toUpperCase()}.`)
  }

  if (!lesson || !lesson.segments.length) {
    return (
      <div className="mx-auto max-w-3xl p-6 text-sm text-gray-400">
        Export becomes available once a lesson has been recognized and translated. Open or start a project first.
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-1 flex items-center gap-3">
        <h1 className="text-lg font-semibold">Export</h1>
        <span className="text-sm text-gray-500">{targets.length} languages · {lesson.segments.length} segments</span>
        {done && <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-800 dark:bg-green-900/40 dark:text-green-300">assembled</span>}
      </div>
      <p className="mb-4 max-w-prose text-sm text-gray-500 dark:text-gray-400">
        Assemble the continuous per-language files and pull deliverables out of the reviewed localization —
        subtitles, the translation sheet, audio and (server-side) video.
      </p>

      {/* language selector — scopes per-language and "all" actions */}
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs font-medium text-gray-500">Languages</span>
        {langs.map((l) => {
          const on = !excluded.has(l)
          return (
            <button key={l} onClick={() => toggle(l)}
              className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${on
                ? 'border-gray-900 bg-gray-900 text-white dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900'
                : 'border-gray-300 text-gray-500 hover:bg-gray-100 dark:border-[#3a3a3d] dark:text-gray-400 dark:hover:bg-[#202023]'}`}>
              {l.toUpperCase()}
            </button>
          )
        })}
      </div>

      {/* ── 1. assemble (staged gate) ───────────────────────────────────────── */}
      <Group icon={Clapperboard} title="Assemble full files" tag="step 4/4">
        <div className="px-3 py-2.5">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Stitch the reviewed segments into one continuous {`{lang}`}.wav (+ .vtt) per language and save to Drive.
          </p>
          {assembled ? (
            <div className="mt-2 flex items-center gap-2 text-xs text-green-700 dark:text-green-400">
              <Check className="h-3.5 w-3.5" strokeWidth={1.75} /> Assembled — saved to {plan?.destination || dest}
            </div>
          ) : atGate || rendering ? (
            <div className="mt-2">
              <div className="mb-1 text-xs font-medium text-gray-500">Where to save</div>
              <div className="space-y-1">
                {(plan?.presets ?? []).map((p) => (
                  <label key={p} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                    <input type="radio" name="dest" disabled={!atGate}
                      checked={!custom && dest === p} onChange={() => { setCustom(false); setDest(p) }} />
                    <span className="font-mono text-xs">{p}</span>
                  </label>
                ))}
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                  <input type="radio" name="dest" disabled={!atGate} checked={custom} onChange={() => setCustom(true)} />
                  <span>Other folder…</span>
                </label>
                {custom && (
                  <input value={dest} disabled={!atGate} onChange={(e) => setDest(e.target.value)}
                    placeholder="e.g. Drive · clients/acme/output"
                    className="ml-6 w-full max-w-md rounded border border-gray-300 px-2 py-1 font-mono text-xs dark:border-[#3a3a3d] dark:bg-[#161617]" />
                )}
              </div>
              <button onClick={build} disabled={!(atGate && Boolean(state?.enableWrites) && dest.trim()) || busy || rendering}
                className="mt-2.5 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:bg-gray-300 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white dark:disabled:bg-[#3a3a3d] dark:disabled:text-gray-400">
                {rendering ? 'Assembling full files…' : busy ? 'Starting…' : 'Assemble full files'}
              </button>
              {err && <div className="mt-2 rounded bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950/50 dark:text-red-300">{err}</div>}
            </div>
          ) : (
            <div className="mt-2 text-xs text-amber-600 dark:text-amber-400">
              Unlocks after you approve the audio. Subtitles and the translation sheet below are already exportable.
            </div>
          )}
        </div>
      </Group>

      {note && <div className="mb-3 rounded bg-blue-50 p-2 text-xs text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">{note}</div>}

      {/* ── 2. subtitles ─────────────────────────────────────────────────────── */}
      <Group icon={Captions} title="Subtitles">
        <Row icon={FileText} title="WebVTT (.vtt)" desc="One cue file per language, timed to the localized slots.">
          <LangBtns langs={selected} onPick={exportVtt} />
          {selected.length > 1 && <AllBtn onClick={() => selected.forEach(exportVtt)} />}
        </Row>
        <Row icon={FileText} title="SubRip (.srt)" desc="Same cues in the .srt format players and editors expect.">
          <LangBtns langs={selected} onPick={exportSrt} />
          {selected.length > 1 && <AllBtn onClick={() => selected.forEach(exportSrt)} />}
        </Row>
      </Group>

      {/* ── 3. data ──────────────────────────────────────────────────────────── */}
      <Group icon={Table} title="Data">
        <Row icon={Table} title="Translation sheet (.csv)" desc="Segment timings + EN and every language's text in one table.">
          <Btn onClick={exportCsv} label="Download CSV" />
        </Row>
        <Row icon={Braces} title="Timing manifest (.json)" desc="Machine-readable: per-segment slots, durations and text per language.">
          <Btn onClick={exportJson} label="Download JSON" />
        </Row>
      </Group>

      {/* ── 4. audio ─────────────────────────────────────────────────────────── */}
      <Group icon={AudioLines} title="Audio">
        <Row icon={AudioLines} title="Full localized audio (.wav)" desc="One continuous track per language."
          hint={!assembled ? 'Available after the assemble step above.' : undefined}>
          {assembled
            ? <><LangBtns langs={selectedTargets} onPick={exportFullAudio} />{selectedTargets.length > 1 && <AllBtn onClick={() => selectedTargets.forEach(exportFullAudio)} />}</>
            : <span className="text-xs text-gray-400">—</span>}
        </Row>
        <Row icon={AudioLines} title="Per-segment audio (.wav)" desc="Each segment's localized clip, one file per segment."
          hint={!audioReady ? 'Available after the audio is synthesized.' : 'Fires a separate download per segment.'}>
          {audioReady
            ? <LangBtns langs={selectedTargets} onPick={exportSegments} />
            : <span className="text-xs text-gray-400">—</span>}
        </Row>
        <Row icon={AudioLines} title="Original EN audio (.wav)" desc="The source narration, for reference or re-import.">
          <Btn onClick={exportEnAudio} label="Download EN" />
        </Row>
      </Group>

      {/* ── 5. video (server render) ─────────────────────────────────────────── */}
      <Group icon={Film} title="Video">
        <Row icon={Film} title="Video + localized audio" desc="The reference video muxed with each language's track (mp4)." serverSide />
        <Row icon={Clapperboard} title="Video + soft subtitles" desc="The video with selectable subtitle tracks embedded." serverSide />
      </Group>

      {/* ── 6. bundle (server render) ────────────────────────────────────────── */}
      <Group icon={Package} title="Bundle">
        <Row icon={Package} title="Full project (.zip)" desc="Every artifact above for the selected languages in one archive." serverSide />
      </Group>

      <div className="mt-5 flex items-center gap-3">
        <button onClick={() => nav('/projects')}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50 dark:border-[#3a3a3d] dark:hover:bg-[#202023]">Back to projects</button>
        {done && <span className="text-xs text-gray-400">Lesson complete · {plan?.destination}</span>}
      </div>
    </div>
  )
}

// ── small presentational pieces ──────────────────────────────────────────────
function Group({ icon: Icon, title, tag, children }: { icon: LucideIcon; title: string; tag?: string; children: React.ReactNode }) {
  return (
    <div className="mb-4 rounded-lg border border-gray-200 dark:border-[#29292c]">
      <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2 text-xs font-semibold text-gray-600 dark:border-[#29292c] dark:text-gray-300">
        <Icon className="h-4 w-4 text-gray-400" strokeWidth={1.75} /> {title}
        {tag && <span className="ml-auto rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-[#202023]">{tag}</span>}
      </div>
      <div className="divide-y divide-gray-100 dark:divide-[#29292c]">{children}</div>
    </div>
  )
}

function Row({ icon: Icon, title, desc, hint, serverSide, children }: {
  icon: LucideIcon
  title: string; desc: string; hint?: string; serverSide?: boolean; children?: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-3 px-3 py-2.5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" strokeWidth={1.75} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{title}</span>
          {serverSide && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">server render · Фаза P</span>}
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400">{desc}</div>
        {hint && <div className="mt-0.5 text-[11px] text-amber-600 dark:text-amber-400">{hint}</div>}
        {children && <div className="mt-1.5 flex flex-wrap items-center gap-1.5">{children}</div>}
      </div>
    </div>
  )
}

function Btn({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button onClick={onClick}
      className="rounded border border-gray-300 px-2.5 py-0.5 text-xs font-medium text-gray-700 hover:bg-gray-100 dark:border-[#3a3a3d] dark:text-gray-200 dark:hover:bg-[#202023]">
      {label}
    </button>
  )
}

function AllBtn({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="rounded border border-gray-900 bg-gray-900 px-2.5 py-0.5 text-xs font-medium text-white hover:bg-gray-700 dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white">
      All
    </button>
  )
}

function LangBtns({ langs, onPick }: { langs: string[]; onPick: (l: string) => void }) {
  return <>{langs.map((l) => <Btn key={l} onClick={() => onPick(l)} label={l.toUpperCase()} />)}</>
}
