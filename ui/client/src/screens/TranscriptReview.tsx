import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Scissors } from 'lucide-react'
import { useSegments } from '../api/queries'
import { useRunState } from '../api/useRunState'
import { canWriteTranscript } from '../ui'
import { GateBar } from '../components/GateBar'
import { VideoReference } from '../components/timeline/VideoReference'
import { SegmentTimeline } from '../components/timeline/SegmentTimeline'
import { useRunMedia } from '../api/runMedia'
import { saveTranscript, mergeSegment, splitSegment, fetchWords, type Word } from '../api/staged'
import type { RawSegment } from '../api/types'

const n = (v: string | number) => (v === '' || v == null ? null : Number(v))
const shortId = (id: string) => id.replace(/^.*_seg_/, 'seg ')

function parseWordConf(v: unknown): number[] {
  try { const a = JSON.parse(String(v ?? '[]')); return Array.isArray(a) ? a.map(Number) : [] } catch { return [] }
}

// Render text with low-confidence STT words highlighted (per word, not the whole
// phrase). `conf` is aligned to whitespace-split words; empty → plain text.
function renderConfWords(text: string, conf: number[]) {
  if (!conf.length) return text
  let wi = 0
  return text.split(/(\s+)/).map((p, i) => {
    if (!p || /^\s+$/.test(p)) return p
    const c = conf[wi++]
    return typeof c === 'number' && c < 0.8
      ? <mark key={i} title={`recognition confidence ${Math.round(c * 100)}%`}
          className="rounded-sm bg-amber-200/90 px-0.5 text-amber-900 dark:bg-amber-600/40 dark:text-amber-100">{p}</mark>
      : <span key={i}>{p}</span>
  })
}

export function TranscriptReview() {
  const { state } = useRunState()
  const { data, isLoading } = useSegments()
  const qc = useQueryClient()
  const editable = canWriteTranscript(state)
  const segs = data?.rows ?? []
  const { videoUrl } = useRunMedia()
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null)
  const [videoDuration, setVideoDuration] = useState(0)

  const [selected, setSelected] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null) // which card's textarea is open
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [splitFor, setSplitFor] = useState<string | null>(null)
  const [words, setWords] = useState<Word[]>([])
  const [busyMsg, setBusyMsg] = useState<string | null>(null)

  // keep selection valid as the segment set changes (merge/split renumber)
  useEffect(() => {
    if (segs.length && !segs.some((s) => s.segment_id === selected)) setSelected(segs[0].segment_id)
  }, [segs, selected])

  const refresh = () => qc.invalidateQueries({ queryKey: ['segments'] })

  async function commitEdit(seg: RawSegment) {
    const draft = drafts[seg.segment_id]
    if (draft == null || draft === seg.en_text) return
    try {
      await saveTranscript([{ segmentId: seg.segment_id, enText: draft }])
      refresh()
    } catch (e) { setBusyMsg(e instanceof Error ? e.message : 'save failed') }
  }

  async function doMerge(id: string) {
    setBusyMsg(null)
    try { await mergeSegment(id); setDrafts({}); setSplitFor(null); refresh() }
    catch (e) { setBusyMsg(e instanceof Error ? e.message : 'merge failed') }
  }

  async function openSplit(id: string) {
    if (splitFor === id) { setSplitFor(null); return }
    try {
      const r = await fetchWords(id)
      setWords(r.words); setSplitFor(id)
    } catch (e) { setBusyMsg(e instanceof Error ? e.message : 'failed to load words') }
  }

  async function doSplit(id: string, wordIndex: number) {
    setBusyMsg(null)
    try { await splitSegment(id, wordIndex); setSplitFor(null); setDrafts({}); refresh() }
    catch (e) { setBusyMsg(e instanceof Error ? e.message : 'split failed') }
  }

  const editedCount = segs.filter((s) => drafts[s.segment_id] != null && drafts[s.segment_id] !== s.en_text).length

  // Bidirectional scroll sync: segment list (vertical) ↔ timeline (horizontal).
  // A short time-lock on the follower swallows the echo, so there's no feedback loop.
  const listScrollRef = useRef<HTMLDivElement>(null)
  const [focusSeg, setFocusSeg] = useState<number | null>(null)
  const focusRafRef = useRef(0)
  const lastFocusRef = useRef<number | null>(null)
  const lockListUntil = useRef(0)
  const lockTimelineUntil = useRef(0)
  const LOCK_MS = 140
  function onListScroll() {
    if (Date.now() < lockListUntil.current) return
    cancelAnimationFrame(focusRafRef.current)
    focusRafRef.current = requestAnimationFrame(() => {
      const c = listScrollRef.current
      if (!c) return
      const top = c.getBoundingClientRect().top
      for (const r of c.querySelectorAll<HTMLElement>('li[data-segidx]')) {
        if (r.getBoundingClientRect().bottom > top + 4) {
          const idx = Number(r.dataset.segidx)
          if (Number.isInteger(idx) && idx !== lastFocusRef.current) {
            lastFocusRef.current = idx
            lockTimelineUntil.current = Date.now() + LOCK_MS
            setFocusSeg(idx)
          }
          break
        }
      }
    })
  }
  function onTimelineView(idx: number) {
    if (Date.now() < lockTimelineUntil.current) return
    const c = listScrollRef.current
    if (!c) return
    const row = c.querySelector<HTMLElement>(`li[data-segidx="${idx}"]`)
    if (!row) return
    const delta = row.getBoundingClientRect().top - c.getBoundingClientRect().top - 8
    if (Math.abs(delta) > 2) { lastFocusRef.current = idx; lockListUntil.current = Date.now() + LOCK_MS; c.scrollTop += delta }
  }

  return (
    <div className="flex h-full flex-col">
      {/* pinned: timeline stays visible while the segment list scrolls below */}
      {segs.length > 0 && (
        <div className="shrink-0 px-6 pt-6">
          <SegmentTimeline segments={segs} editable={editable} selected={selected}
            onSelect={setSelected} onRetimed={refresh} focusSeg={focusSeg} onViewSeg={onTimelineView}
            video={videoEl} videoDuration={videoDuration} />
        </div>
      )}
      <div className="flex min-h-0 flex-1 gap-6 px-6 pb-6 pt-4">
        {/* ── segment list (scrolls) ── */}
        <div ref={listScrollRef} onScroll={onListScroll} className="min-h-0 flex-1 overflow-auto">
          <section className="max-w-3xl">
            <div className="mb-3 flex items-center gap-3">
              <h1 className="text-lg font-semibold">Transcript Review</h1>
              <span className="text-sm text-gray-500">{segs.length} segments</span>
              {!editable && <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-500">read-only (stage not yet in review)</span>}
            </div>
            {busyMsg && <div className="mb-3 rounded-md bg-red-50 p-2 text-sm text-red-700">{busyMsg}</div>}
            {isLoading ? <div className="text-sm text-gray-400">Loading…</div> : (
              <ol className="space-y-2">
                {segs.map((seg, i) => {
                  const draft = drafts[seg.segment_id] ?? seg.en_text
                  const dirty = drafts[seg.segment_id] != null && drafts[seg.segment_id] !== seg.en_text
                  const move = String(seg.movement_keywords || '').trim()
                  const isSel = seg.segment_id === selected
                  const wordConf = parseWordConf(seg.stt_word_conf)
                  // overall chip = the lowest-confidence word in the segment
                  const overall = wordConf.length ? Math.min(...wordConf) : Number(seg.stt_confidence)
                  const hasConf = Number.isFinite(overall)
                  const editing = editingId === seg.segment_id
                  const cardCls = isSel
                    ? 'border-gray-900 dark:border-gray-100 bg-white dark:bg-[#161617]'
                    : 'border-gray-200 dark:border-[#29292c] bg-white dark:bg-[#161617] hover:border-gray-300 dark:hover:border-gray-600'
                  return (
                    <li key={seg.segment_id} data-segidx={i}
                      onClick={() => setSelected(seg.segment_id)}
                      className={`rounded-lg border p-2 ${cardCls}`}>
                      <div className="mb-1 flex items-center gap-2 text-xs text-gray-500">
                        <span className="font-mono">{shortId(seg.segment_id)}</span>
                        <span>{fmt(n(seg.en_start_sec))}–{fmt(n(seg.en_end_sec))}с ({fmt(n(seg.en_duration_sec))}с)</span>
                        {hasConf && (
                          <span title={overall < 0.8 ? 'low-confidence words are highlighted — review and fix' : 'recognition confidence (STT)'}
                            className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${overall < 0.8 ? 'bg-amber-200 text-amber-900 dark:bg-amber-900/50 dark:text-amber-200' : 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'}`}>
                            {Math.round(overall * 100)}%
                          </span>
                        )}
                        {move && <span className="rounded bg-purple-100 px-1.5 py-0.5 text-purple-700" title="movement — strict alignment">{move}</span>}
                        {dirty && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">edited</span>}
                      </div>
                      {editing ? (
                        <textarea
                          autoFocus
                          value={draft}
                          disabled={!editable}
                          onChange={(e) => setDrafts((d) => ({ ...d, [seg.segment_id]: e.target.value }))}
                          onBlur={() => { commitEdit(seg); setEditingId(null) }}
                          rows={2}
                          className="w-full resize-none rounded border border-gray-200 dark:border-[#29292c] px-2 py-1 text-sm disabled:bg-gray-50 dark:bg-[#161617] dark:disabled:bg-[#202023] disabled:text-gray-500"
                        />
                      ) : (
                        <div
                          onClick={(e) => { e.stopPropagation(); setSelected(seg.segment_id); if (editable) setEditingId(seg.segment_id) }}
                          title={editable ? 'click to edit' : undefined}
                          className={`min-h-[2.5rem] w-full whitespace-pre-wrap break-words rounded border border-gray-200 px-2 py-1 text-sm leading-snug dark:border-[#29292c] ${editable ? 'cursor-text' : ''}`}
                        >
                          {renderConfWords(draft, dirty ? [] : wordConf)}
                        </div>
                      )}
                      {editable && (
                        <div className="mt-1 flex gap-2 text-xs">
                          <button onClick={(e) => { e.stopPropagation(); openSplit(seg.segment_id) }}
                            className="rounded border border-gray-300 dark:border-[#3a3a3d] px-2 py-0.5 hover:bg-gray-50"><Scissors className="inline-block h-3.5 w-3.5 align-[-0.2em]" strokeWidth={1.75} /> split</button>
                          {i < segs.length - 1 && (
                            <button onClick={(e) => { e.stopPropagation(); doMerge(seg.segment_id) }}
                              className="rounded border border-gray-300 dark:border-[#3a3a3d] px-2 py-0.5 hover:bg-gray-50">merge with next</button>
                          )}
                        </div>
                      )}
                      {splitFor === seg.segment_id && (
                        <SplitPicker words={words} onPick={(k) => doSplit(seg.segment_id, k)} />
                      )}
                    </li>
                  )
                })}
              </ol>
            )}
          </section>
        </div>

        {/* ── reference video (pinned beside the list; drives timeline playback) ── */}
        <aside className="flex w-[22rem] shrink-0 flex-col self-stretch min-h-0 lg:w-2/5 lg:min-w-[22rem] lg:max-w-[42rem]">
            <h2 className="mb-2 shrink-0 text-sm font-semibold text-gray-700 dark:text-gray-300">Reference video</h2>
            <div className="min-h-0 flex-1">
              <VideoReference videoUrl={videoUrl} onVideoEl={setVideoEl} onDuration={setVideoDuration} fill />
            </div>
            <p className="mt-3 shrink-0 text-xs text-gray-400">
              Fix the text (typos/misheard words), split/merge segments. Timings recalculate automatically.
            </p>
          </aside>
        </div>

      <GateBar
        gate="transcript"
        title="Stage 1/3 · Transcript"
        summary={`${segs.length} segments${editedCount ? ` · ${editedCount} edited` : ''}`}
        primaryLabel="Approve and continue"
      />
    </div>
  )
}

function SplitPicker({ words, onPick }: { words: Word[]; onPick: (k: number) => void }) {
  return (
    <div className="mt-2 rounded-md border border-blue-200 bg-blue-50 p-2 dark:border-blue-900 dark:bg-blue-950/40">
      <div className="mb-1 text-xs text-blue-800 dark:text-blue-300">Click between words to split the segment:</div>
      <div className="flex flex-wrap items-center gap-0.5 text-sm">
        {words.map((w, i) => (
          <span key={i} className="flex items-center">
            <span className="rounded px-1 py-0.5">{w.punctuated_word}</span>
            {i < words.length - 1 && (
              <button onClick={() => onPick(i)} title={`split after "${w.punctuated_word}"`}
                className="mx-0.5 rounded px-1 text-blue-400 hover:bg-blue-200 hover:text-blue-800">|</button>
            )}
          </span>
        ))}
      </div>
    </div>
  )
}

function fmt(v: number | null) { return v == null ? '—' : v.toFixed(1) }
