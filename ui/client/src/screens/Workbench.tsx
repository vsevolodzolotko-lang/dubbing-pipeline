import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  X, Check, RefreshCw, ShoppingBasket, Lightbulb, AlertTriangle,
  Scissors, FastForward, Blocks, Footprints, ArrowLeftRight, HelpCircle,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useLesson } from '../api/queries'
import { cellClass, canWrite, writeBlockReason } from '../ui'
import { useRunState } from '../api/useRunState'
import { useRunMedia } from '../api/runMedia'
import { useCart } from '../api/cart'
import { AudioTimeline } from '../components/timeline/AudioTimeline'
import { VideoReference } from '../components/timeline/VideoReference'
import { GateBar } from '../components/GateBar'
import { normalizeSegments } from '../api/staged'
import { getRegenOld } from '../api/regenHistory'
import type { Cause, Cell, SegmentRow } from '../api/types'

type Filter = 'all' | 'qa' | 'review'

export function Workbench() {
  const { data, isLoading, error } = useLesson()
  const { state, regen } = useRunState()
  const { videoUrl } = useRunMedia()
  const cart = useCart()
  const qc = useQueryClient()
  const inFlight = new Set(regen.active ? (regen.rowKeys ?? []) : [])
  const [selected, setSelected] = useState<{ seg: number; lang: string } | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [editedText, setEditedText] = useState('')
  const [verdictMsg, setVerdictMsg] = useState<string | null>(null)
  const [normMsg, setNormMsg] = useState<string | null>(null)
  // Reference video lives here (bottom, beside the matrix) and is the playback
  // clock the AudioTimeline drives.
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null)
  const [videoDuration, setVideoDuration] = useState(0)
  // Bidirectional scroll sync (matrix vertical ↔ timeline horizontal). We sync by
  // SCROLL FRACTION, not by segment, so the two always hit their ends together —
  // matrix at the bottom ⇔ timeline at its far right. A short time-lock on the
  // follower swallows the echo scroll, so there's no feedback loop.
  const matrixScrollRef = useRef<HTMLDivElement>(null)
  const [tlScroller, setTlScroller] = useState<HTMLDivElement | null>(null)
  const lockMatrixUntil = useRef(0)
  const lockTimelineUntil = useRef(0)
  const LOCK_MS = 140
  // matrix vertical scroll → drive the timeline to the same scroll fraction
  function onMatrixScroll() {
    if (Date.now() < lockMatrixUntil.current) return // echo from a timeline-driven scroll
    const m = matrixScrollRef.current
    if (!m || !tlScroller) return
    const mMax = m.scrollHeight - m.clientHeight
    const tMax = tlScroller.scrollWidth - tlScroller.clientWidth
    if (mMax <= 0 || tMax <= 0) return // content fits — nothing to sync
    lockTimelineUntil.current = Date.now() + LOCK_MS // suppress the timeline's echo
    tlScroller.scrollLeft = (m.scrollTop / mMax) * tMax
  }
  // Scroll the matrix so segment `idx` sits just below the sticky header (the
  // language-name row) — not hidden behind it.
  function scrollMatrixToSeg(idx: number) {
    const c = matrixScrollRef.current
    if (!c) return
    const row = c.querySelector<HTMLElement>(`tr[data-segidx="${idx}"]`)
    if (!row) return
    const headH = c.querySelector('thead')?.getBoundingClientRect().height ?? 0
    const delta = row.getBoundingClientRect().top - c.getBoundingClientRect().top - headH - 8
    if (Math.abs(delta) > 2) c.scrollTop += delta
  }
  // timeline horizontal scroll → drive the matrix to the same scroll fraction
  useEffect(() => {
    if (!tlScroller) return
    const onScroll = () => {
      if (Date.now() < lockTimelineUntil.current) return // echo from a matrix-driven scroll
      const m = matrixScrollRef.current
      if (!m) return
      const tMax = tlScroller.scrollWidth - tlScroller.clientWidth
      const mMax = m.scrollHeight - m.clientHeight
      if (tMax <= 0 || mMax <= 0) return
      lockMatrixUntil.current = Date.now() + LOCK_MS // suppress the matrix's echo
      m.scrollTop = (tlScroller.scrollLeft / tMax) * mMax
    }
    tlScroller.addEventListener('scroll', onScroll, { passive: true })
    return () => tlScroller.removeEventListener('scroll', onScroll)
  }, [tlScroller])
  const writable = canWrite(state)

  const selCell = selected && data ? data.segments[selected.seg]?.cells[selected.lang] : null
  const selSegRow = selected && data ? data.segments[selected.seg] : null

  // reset edited text when the selected cell changes
  useEffect(() => {
    setEditedText(selCell?.textTranslated ?? '')
    setVerdictMsg(null)
  }, [selected, selCell?.textTranslated])

  // Selecting a segment (matrix cell OR timeline block) scrolls the matrix to it.
  // (Timeline scroll + playhead seek happen in AudioTimeline's `selected` effect.)
  useEffect(() => {
    if (!selected) return
    // Both the matrix (here) and the timeline (AudioTimeline) jump to frame the
    // selected segment — lock both so neither programmatic scroll drives the other.
    const until = Date.now() + 300
    lockMatrixUntil.current = until
    lockTimelineUntil.current = until
    scrollMatrixToSeg(selected.seg)
  }, [selected?.seg]) // eslint-disable-line react-hooks/exhaustive-deps

  async function verdict(value: 'TRUE' | 'FALSE') {
    if (!writable || !selCell?.rowKey) return
    setVerdictMsg('…')
    try {
      const res = await fetch('/api/attention', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: [{ rowKey: selCell.rowKey, value }] }),
      })
      setVerdictMsg(res.ok ? (value === 'FALSE' ? 'Accepted' : 'Flagged') : `Error: ${(await res.json()).error}`)
    } catch (e) { setVerdictMsg(String(e)) }
  }

  function addToCart() {
    if (!selCell?.rowKey || !selSegRow) return
    cart.add({
      rowKey: selCell.rowKey, segmentId: selSegRow.segmentId, lang: selected!.lang,
      oldText: selCell.textTranslated ?? '', newText: editedText,
    })
    setVerdictMsg('In cart')
  }

  async function normalize(rowKeys: string[]) {
    if (!writable || !rowKeys.length) return
    setNormMsg('…')
    try {
      const r = await normalizeSegments(rowKeys)
      setNormMsg(r.ok ? `Normalized ${r.normalized} to -23 LUFS` : (r.error || 'failed'))
      qc.invalidateQueries({ queryKey: ['lesson'] })
    } catch (e) { setNormMsg(e instanceof Error ? e.message : 'normalization error') }
  }
  const allRowKeys = () => data ? data.segments.flatMap((s) => Object.values(s.cells).map((c) => c.rowKey).filter((k): k is string => Boolean(k))) : []

  // Keyboard: F ok, T bad, R cart, Esc close. (Space = timeline playback, handled in AudioTimeline.)
  const kbd = useRef<(e: KeyboardEvent) => void>(() => {})
  kbd.current = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA') return
    if (e.key === 'f' || e.key === 'F' || e.key === 'а' || e.key === 'А') verdict('FALSE')
    else if (e.key === 't' || e.key === 'T' || e.key === 'е' || e.key === 'Е') verdict('TRUE')
    else if (e.key === 'r' || e.key === 'R' || e.key === 'к' || e.key === 'К') addToCart()
    else if (e.key === 'Escape') setSelected(null)
  }
  useEffect(() => {
    if (!selected) return
    const h = (e: KeyboardEvent) => kbd.current(e)
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [selected])

  const segments = useMemo(() => {
    if (!data) return []
    const all = data.segments.map((s, i) => ({ s, i }))
    if (filter === 'all') return all
    if (filter === 'review') return all.filter(({ s }) => Object.values(s.cells).some((c) => c.status === 'REVIEW'))
    return all.filter(({ s }) => Object.values(s.cells).some(isProblem))
  }, [data, filter])

  if (isLoading) return <div className="p-8 text-sm text-gray-400">Loading lesson…</div>
  if (error) return <div className="p-8 text-sm text-red-600">Error: {String(error)}</div>
  if (!data || data.segments.length === 0) return <div className="p-8 text-sm text-gray-400">No lesson data.</div>

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* pinned: header + timeline stay visible while the matrix scrolls below */}
        <div className="shrink-0 px-4 pt-4">
        <div className="mb-3 flex items-center gap-2">
          <h1 className="text-lg font-semibold">Review · {data.lessonId}</h1>
          <div className="ml-3 flex rounded-md border border-gray-300 dark:border-[#3a3a3d] text-sm">
            <FilterBtn active={filter === 'all'} onClick={() => setFilter('all')}>All</FilterBtn>
            <FilterBtn active={filter === 'qa'} onClick={() => setFilter('qa')}>Problematic</FilterBtn>
            <FilterBtn active={filter === 'review'} onClick={() => setFilter('review')}>After regen</FilterBtn>
          </div>
          {writable && (
            <button onClick={() => normalize(allRowKeys())} title="normalize loudness of all dubs to -23 LUFS"
              className="rounded-md border border-gray-300 dark:border-[#3a3a3d] px-2 py-1 text-xs hover:bg-gray-100 dark:hover:bg-[#202023]">
              Normalize all -23 LUFS
            </button>
          )}
          {normMsg && <span className="text-xs text-gray-500">{normMsg}</span>}
          <Legend />
        </div>

          <AudioTimeline
            segments={data.segments}
            langs={data.langs}
            selected={selected}
            editable={writable}
            inFlight={inFlight}
            video={videoEl}
            videoDuration={videoDuration}
            onScrollerReady={setTlScroller}
            onSelectCell={(seg, lang) => setSelected({ seg, lang })}
            onRetimed={() => qc.invalidateQueries({ queryKey: ['lesson'] })}
          />
        </div>

        {/* matrix scrolls on its own; the video reference is pinned beside it (always visible) */}
        <div className="flex min-h-0 flex-1 gap-6 px-4 pb-4 pt-4">
        <div ref={matrixScrollRef} onScroll={onMatrixScroll} className="min-h-0 flex-1 overflow-auto">
        <table className="border-separate border-spacing-1 text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-20 bg-[#f6f7f9] dark:bg-[#202023] px-2 py-1 text-left text-xs font-medium text-gray-500">Segment</th>
              {data.langs.map((l) => (
                <th key={l} className="sticky top-0 z-10 bg-[#f6f7f9] dark:bg-[#202023] px-2 py-1 text-xs font-mono font-medium text-gray-500">{l}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {segments.map(({ s, i }) => (
              <tr key={s.segmentId} data-segidx={i}>
                <td className="sticky left-0 z-10 w-[34rem] max-w-[34rem] truncate bg-[#f6f7f9] dark:bg-[#202023] px-2 py-1 text-sm text-gray-600" title={s.enText}>
                  <span className="font-mono text-gray-400">{shortId(s.segmentId)}</span>{' '}
                  {s.movementLocked && <span title="segment with movement"><Footprints className="inline-block h-3 w-3 align-[-0.15em] text-gray-400" strokeWidth={1.75} /></span>}{' '}
                  {s.enText}
                </td>
                {data.langs.map((l) => {
                  const c = s.cells[l]
                  const isSel = selected?.seg === i && selected?.lang === l
                  const regening = Boolean(c.rowKey && inFlight.has(c.rowKey))
                  return (
                    <td key={l} className="p-0">
                      <button
                        onClick={() => setSelected({ seg: i, lang: l })}
                        className={`grid h-7 w-9 place-items-center rounded border text-[11px] ${cellClass(c.status, c.needsRetts)} ${isSel ? 'ring-2 ring-gray-900' : ''} ${regening ? 'animate-pulse ring-1 ring-blue-400' : ''}`}
                        title={regening ? 'regenerating…' : c.diagnosis?.primary}
                      >
                        {regening ? <RefreshCw className="h-3 w-3 animate-spin" strokeWidth={1.75} /> : cellGlyph(c)}
                      </button>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
        </div>

        <div className="flex w-72 shrink-0 flex-col self-stretch min-h-0 lg:w-2/5 lg:min-w-[22rem] lg:max-w-[42rem]">
          <div className="mb-1 shrink-0 text-xs font-medium text-gray-500 dark:text-gray-400">Reference video</div>
          <div className="min-h-0 flex-1">
            <VideoReference videoUrl={videoUrl} onVideoEl={setVideoEl} onDuration={setVideoDuration} fill />
          </div>
        </div>
        </div>
      </div>

      {selCell && selSegRow && (
        <DetailPanel
          key={selCell.rowKey}
          cell={selCell}
          seg={selSegRow}
          lang={selected!.lang}
          editedText={editedText}
          setEditedText={setEditedText}
          writable={writable}
          blockReason={writeBlockReason(state)}
          inFlight={selCell.rowKey ? inFlight.has(selCell.rowKey) : false}
          inCart={selCell.rowKey ? cart.has(selCell.rowKey) : false}
          verdictMsg={verdictMsg}
          onVerdict={verdict}
          onAddCart={addToCart}
          onNormalize={() => selCell.rowKey && normalize([selCell.rowKey])}
          onClose={() => setSelected(null)}
        />
      )}
      </div>

      {state?.staged && state.state === 'AUDIO_REVIEW' && (
        <GateBar
          gate="audio"
          title="Stage 3/4 · Audio (segments)"
          summary={`${data.segments.length} segments · ${state.needsAttention.count} need attention · next — assemble the full file`}
          primaryLabel="Approve audio"
        />
      )}
    </div>
  )
}

function DetailPanel({ cell, seg, lang, editedText, setEditedText, writable, blockReason, inFlight, inCart, verdictMsg, onVerdict, onAddCart, onNormalize, onClose }: {
  cell: Cell; seg: SegmentRow; lang: string
  editedText: string; setEditedText: (v: string) => void
  writable: boolean; blockReason: string; inFlight: boolean; inCart: boolean; verdictMsg: string | null
  onVerdict: (v: 'TRUE' | 'FALSE') => void; onAddCart: () => void; onNormalize: () => void; onClose: () => void
}) {
  const d = cell.diagnosis
  const edited = editedText !== (cell.textTranslated ?? '')
  const regenOld = cell.status === 'REVIEW' && cell.rowKey ? getRegenOld(cell.rowKey) : null
  return (
    <aside className="flex w-96 shrink-0 flex-col overflow-auto border-l border-gray-200 dark:border-[#29292c] bg-white dark:bg-[#161617] p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="font-mono text-xs text-gray-400">{shortId(seg.segmentId)} · {lang}</div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:text-gray-300"><X className="h-4 w-4" strokeWidth={1.75} /></button>
      </div>

      <div className="mb-3 rounded-md bg-gray-50 p-3 dark:bg-[#202023] text-sm">
        <div className="text-xs font-medium text-gray-400">EN original</div>
        <div className="text-gray-700 dark:text-gray-300">{seg.enText}</div>
        <div className="mt-2 flex items-center justify-between">
          <span className="text-xs font-medium text-gray-400">Translation ({lang})</span>
          {edited && <span className="text-[10px] text-amber-600">edited — add to cart</span>}
        </div>
        <textarea
          value={editedText}
          onChange={(e) => setEditedText(e.target.value)}
          disabled={!writable}
          rows={3}
          className="mt-1 w-full resize-y rounded border border-gray-300 dark:border-[#3a3a3d] px-2 py-1 text-sm text-gray-900 dark:text-gray-100 disabled:bg-gray-100 dark:disabled:bg-[#202023]"
        />
      </div>

      {inFlight && (
        <div className="mb-3 animate-pulse rounded-md bg-blue-50 dark:bg-blue-950/40 dark:text-blue-200 px-2 py-1.5 text-sm text-blue-800"><RefreshCw className="inline-block h-3.5 w-3.5 align-[-0.2em] animate-spin" strokeWidth={1.75} /> Regenerating… wait for it to finish.</div>
      )}

      {regenOld && (
        <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs">
          <div className="font-medium text-amber-800">After regeneration — compare:</div>
          <div className="mt-1 text-gray-500 line-through">{regenOld.old}</div>
          <div className="text-green-800">{regenOld.neu}</div>
        </div>
      )}

      {/* actions */}
      <div className="mb-3">
        <div className="flex flex-wrap gap-2">
          <button onClick={() => onVerdict('FALSE')} disabled={!writable}
            title={writable ? 'F key' : blockReason}
            className="rounded-md border border-green-300 bg-green-50 px-3 py-1.5 text-sm text-green-800 hover:bg-green-100 disabled:opacity-40">OK</button>
          <button onClick={() => onVerdict('TRUE')} disabled={!writable}
            title={writable ? 'T key' : blockReason}
            className="rounded-md border border-red-300 bg-red-50 px-3 py-1.5 text-sm text-red-800 hover:bg-red-100 disabled:opacity-40">Bad</button>
          <button onClick={onAddCart} disabled={!writable}
            title={writable ? 'R key' : blockReason}
            className="rounded-md border border-gray-300 dark:border-[#3a3a3d] px-3 py-1.5 text-sm hover:bg-gray-100 disabled:opacity-40"><ShoppingBasket className="inline-block h-3.5 w-3.5 align-[-0.2em]" strokeWidth={1.75} /> {inCart ? 'Update in cart' : 'To cart'}</button>
          <button onClick={onNormalize} disabled={!writable}
            title={writable ? 'normalize loudness to -23 LUFS' : blockReason}
            className="rounded-md border border-gray-300 dark:border-[#3a3a3d] px-3 py-1.5 text-sm hover:bg-gray-100 disabled:opacity-40">Norm. -23 LUFS</button>
        </div>
        {cell.normalizedLufs != null && <div className="mt-1 text-[11px] text-emerald-600 dark:text-emerald-400">normalized to {cell.normalizedLufs} LUFS</div>}
        {!writable && <div className="mt-1 text-[11px] text-amber-600">{blockReason}</div>}
        {verdictMsg && <div className="mt-1 text-xs text-gray-500">{verdictMsg}</div>}
      </div>

      {d && (
        <div className="mb-3">
          <SeverityChip severity={d.severity} />
          <div className="mt-2 text-sm font-medium text-gray-900 dark:text-gray-100">{d.primary}</div>
          {d.causes.length > 0 && (
            <div className="mt-3">
              <div className="mb-1 text-xs font-medium text-gray-500">Possible causes</div>
              <ul className="space-y-1.5">
                {d.causes.map((c, i) => <CauseRow key={i} cause={c} />)}
              </ul>
            </div>
          )}
          {d.advice && (
            <div className="mt-3 rounded-md bg-blue-50 dark:bg-blue-950/40 dark:text-blue-200 px-2 py-1.5 text-sm text-blue-900"><Lightbulb className="inline-block h-3.5 w-3.5 align-[-0.2em]" strokeWidth={1.75} /> {d.advice}</div>
          )}
          {d.fill && (
            <div className="mt-3">
              <div className="text-xs text-gray-500">Localized {d.fill.real?.toFixed(1)}s / slot {d.fill.slot?.toFixed(1)}s</div>
              <div className="mt-1 h-1.5 w-full rounded bg-gray-100">
                <div className="h-1.5 rounded bg-gray-500" style={{ width: `${Math.min(100, (d.fill.real / d.fill.slot) * 100)}%` }} />
              </div>
            </div>
          )}
        </div>
      )}

      <details className="mt-3 text-xs text-gray-500">
        <summary className="cursor-pointer">Technical details</summary>
        <div className="mt-2 text-[11px] text-gray-400">Hotkeys: Space — play/pause · F — ok · T — bad · R — to cart · listen on the timeline at left</div>
        {d && d.facts.length > 0 && (
          <div className="mt-2">
            <div className="mb-1 font-medium text-gray-500">What automation did</div>
            <ul className="space-y-1">
              {d.facts.map((t, i) => <li key={i}>• {t}</li>)}
            </ul>
          </div>
        )}
        <dl className="mt-2 grid grid-cols-2 gap-1">
          <Tech k="phase2_outcome" v={cell.phase2Outcome} />
          <Tech k="final_speed" v={cell.finalSpeed} />
          <Tech k="shorten_retries" v={cell.shortenRetries} />
          <Tech k="expansion_attempts" v={cell.expansionAttempts} />
          <Tech k="borrowed_sec" v={cell.borrowedSec} />
          <Tech k="last_regen_at" v={cell.lastRegenAt} />
          <Tech k="audio_file_id" v={cell.audioFileId} />
          <Tech k="row_key" v={cell.rowKey} />
        </dl>
      </details>
    </aside>
  )
}

function Tech({ k, v }: { k: string; v: unknown }) {
  return (
    <>
      <dt className="font-mono text-gray-400">{k}</dt>
      <dd className="truncate text-gray-700 dark:text-gray-300" title={String(v ?? '')}>{v === '' || v == null ? '—' : String(v)}</dd>
    </>
  )
}

const CAUSE_ICON: Record<string, LucideIcon> = {
  length: Scissors, speed: FastForward, density: Blocks, movement: Footprints,
  regen: RefreshCw, phase2: ArrowLeftRight, tech: AlertTriangle, tight: HelpCircle,
}

function CauseRow({ cause }: { cause: Cause }) {
  const certain = cause.confidence === 'certain'
  const Icon = CAUSE_ICON[cause.kind]
  return (
    <li className="flex items-start gap-2 text-sm">
      <span className="mt-0.5 shrink-0">{Icon ? <Icon className="h-3.5 w-3.5" strokeWidth={1.75} /> : '•'}</span>
      <span className="flex-1 text-gray-700 dark:text-gray-300">{cause.text}</span>
      <span
        className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
          certain ? 'bg-gray-200 text-gray-600' : 'bg-amber-100 text-amber-700'}`}
        title={certain ? 'fact from pipeline data' : 'inference based on signals'}
      >
        {certain ? 'certain' : 'likely'}
      </span>
    </li>
  )
}

function SeverityChip({ severity }: { severity: string }) {
  const map: Record<string, string> = {
    ok: 'bg-green-100 text-green-800', bad: 'bg-red-100 text-red-800',
    review: 'bg-amber-100 text-amber-800', queued: 'bg-blue-100 text-blue-800', warn: 'bg-amber-100 text-amber-800',
  }
  const label: Record<string, string> = { ok: 'No issues', bad: 'Needs attention', review: 'For review', queued: 'In cart', warn: 'Attention' }
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${map[severity] ?? map.warn}`}>{label[severity] ?? severity}</span>
}

function FilterBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`px-3 py-1 first:rounded-l-md last:rounded-r-md ${active ? 'bg-gray-900 text-white' : 'bg-white dark:bg-[#161617] text-gray-600'}`}>
      {children}
    </button>
  )
}

function Legend() {
  return (
    <div className="ml-auto flex gap-3 text-[11px] text-gray-500">
      <Lg cls="bg-green-50 border-green-200" t="ok" />
      <Lg cls="bg-red-100 border-red-200" t="attention" />
      <Lg cls="bg-amber-100 border-amber-200" t="review" />
      <Lg cls="bg-blue-100 border-blue-200" t="in cart" />
    </div>
  )
}
function Lg({ cls, t }: { cls: string; t: string }) {
  return <span className="flex items-center gap-1"><span className={`h-3 w-3 rounded border ${cls}`} />{t}</span>
}

function isProblem(c: Cell) {
  if (c.status === 'TRUE' || c.status === 'REVIEW') return true
  if (c.phase2Outcome && c.phase2Outcome !== 'accepted') return true
  if ((c.shortenRetries ?? 0) >= 3) return true
  return false
}
function cellGlyph(c: Cell): React.ReactNode {
  if (c.needsRetts) return <RefreshCw className="h-3 w-3 animate-spin" strokeWidth={1.75} />
  if (c.status === 'TRUE') return '!'
  if (c.status === 'REVIEW') return '?'
  if (c.status === 'MISSING') return '·'
  return <Check className="h-3 w-3" strokeWidth={1.75} />
}
function shortId(segmentId: string) {
  const m = segmentId.match(/_seg_(\d+)$/)
  return m ? `seg_${m[1]}` : segmentId
}
