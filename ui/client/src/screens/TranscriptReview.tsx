import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useSegments } from '../api/queries'
import { useRunState } from '../api/useRunState'
import { canWriteTranscript } from '../ui'
import { GateBar } from '../components/GateBar'
import { WaveformPlayer } from '../components/WaveformPlayer'
import { saveTranscript, mergeSegment, splitSegment, fetchWords, type Word } from '../api/staged'
import type { RawSegment } from '../api/types'

const n = (v: string | number) => (v === '' || v == null ? null : Number(v))
const shortId = (id: string) => id.replace(/^.*_seg_/, 'seg ')

export function TranscriptReview() {
  const { state } = useRunState()
  const { data, isLoading } = useSegments()
  const qc = useQueryClient()
  const editable = canWriteTranscript(state)
  const segs = data?.rows ?? []

  const [selected, setSelected] = useState<string | null>(null)
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
    } catch (e) { setBusyMsg(e instanceof Error ? e.message : 'помилка збереження') }
  }

  async function doMerge(id: string) {
    setBusyMsg(null)
    try { await mergeSegment(id); setDrafts({}); setSplitFor(null); refresh() }
    catch (e) { setBusyMsg(e instanceof Error ? e.message : 'merge не вдалося') }
  }

  async function openSplit(id: string) {
    if (splitFor === id) { setSplitFor(null); return }
    try {
      const r = await fetchWords(id)
      setWords(r.words); setSplitFor(id)
    } catch (e) { setBusyMsg(e instanceof Error ? e.message : 'не вдалося завантажити слова') }
  }

  async function doSplit(id: string, wordIndex: number) {
    setBusyMsg(null)
    try { await splitSegment(id, wordIndex); setSplitFor(null); setDrafts({}); refresh() }
    catch (e) { setBusyMsg(e instanceof Error ? e.message : 'split не вдалося') }
  }

  const editedCount = segs.filter((s) => drafts[s.segment_id] != null && drafts[s.segment_id] !== s.en_text).length
  const sel = segs.find((s) => s.segment_id === selected)

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-auto">
        <div className="grid grid-cols-1 gap-6 p-6 lg:grid-cols-[1fr_22rem]">
          {/* ── segment list ── */}
          <section>
            <div className="mb-3 flex items-center gap-3">
              <h1 className="text-lg font-semibold">Перевірка транскрипції</h1>
              <span className="text-sm text-gray-500">{segs.length} сегментів</span>
              {!editable && <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-500">тільки читання (етап ще не на перевірці)</span>}
            </div>
            {busyMsg && <div className="mb-3 rounded-md bg-red-50 p-2 text-sm text-red-700">{busyMsg}</div>}
            {isLoading ? <div className="text-sm text-gray-400">Завантаження…</div> : (
              <ol className="space-y-2">
                {segs.map((seg, i) => {
                  const draft = drafts[seg.segment_id] ?? seg.en_text
                  const dirty = drafts[seg.segment_id] != null && drafts[seg.segment_id] !== seg.en_text
                  const move = String(seg.movement_keywords || '').trim()
                  const isSel = seg.segment_id === selected
                  return (
                    <li key={seg.segment_id}
                      onClick={() => setSelected(seg.segment_id)}
                      className={`rounded-lg border p-3 ${isSel ? 'border-gray-900 bg-white' : 'border-gray-200 bg-white hover:border-gray-300'}`}>
                      <div className="mb-1.5 flex items-center gap-2 text-xs text-gray-500">
                        <span className="font-mono">{shortId(seg.segment_id)}</span>
                        <span>{fmt(n(seg.en_start_sec))}→{fmt(n(seg.en_end_sec))}с ({fmt(n(seg.en_duration_sec))}с)</span>
                        {move && <span className="rounded bg-purple-100 px-1.5 py-0.5 text-purple-700" title="рух — суворе вирівнювання">🏃 {move}</span>}
                        {dirty && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">змінено</span>}
                      </div>
                      <textarea
                        value={draft}
                        disabled={!editable}
                        onChange={(e) => setDrafts((d) => ({ ...d, [seg.segment_id]: e.target.value }))}
                        onBlur={() => commitEdit(seg)}
                        rows={2}
                        className="w-full resize-none rounded border border-gray-200 px-2 py-1 text-sm disabled:bg-gray-50 disabled:text-gray-500"
                      />
                      {editable && (
                        <div className="mt-1.5 flex gap-2 text-xs">
                          <button onClick={(e) => { e.stopPropagation(); openSplit(seg.segment_id) }}
                            className="rounded border border-gray-300 px-2 py-0.5 hover:bg-gray-50">🔪 розділити</button>
                          {i < segs.length - 1 && (
                            <button onClick={(e) => { e.stopPropagation(); doMerge(seg.segment_id) }}
                              className="rounded border border-gray-300 px-2 py-0.5 hover:bg-gray-50">⤵ злити з наступним</button>
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

          {/* ── EN audio for the selected segment ── */}
          <aside className="lg:sticky lg:top-4 self-start">
            <h2 className="mb-2 text-sm font-semibold text-gray-700">Оригінал (EN)</h2>
            {sel ? (
              <>
                <div className="mb-2 text-xs text-gray-500">{shortId(sel.segment_id)} · {fmt(n(sel.en_duration_sec))}с</div>
                <WaveformPlayer
                  key={sel.segment_id}
                  audioUrl={`/api/audio/en/seg/${sel.segment_id}`}
                  peaksUrl={`/api/peaks/en/seg/${sel.segment_id}`}
                  mainLabel="оригінал (EN)"
                />
                <p className="mt-3 text-xs text-gray-400">
                  Виправляй текст (друкарські/почуті слова), розбивай/зливай сегменти. Тайминги перерахуються автоматично.
                </p>
              </>
            ) : <div className="text-sm text-gray-400">Обери сегмент</div>}
          </aside>
        </div>
      </div>

      <GateBar
        gate="transcript"
        title="Етап 1/3 · Транскрипт"
        summary={`${segs.length} сегментів${editedCount ? ` · ${editedCount} змінено` : ''}`}
        primaryLabel="Затвердити та продовжити →"
      />
    </div>
  )
}

function SplitPicker({ words, onPick }: { words: Word[]; onPick: (k: number) => void }) {
  return (
    <div className="mt-2 rounded-md border border-blue-200 bg-blue-50 p-2">
      <div className="mb-1 text-xs text-blue-800">Клікни між словами, щоб розділити сегмент:</div>
      <div className="flex flex-wrap items-center gap-0.5 text-sm">
        {words.map((w, i) => (
          <span key={i} className="flex items-center">
            <span className="rounded px-1 py-0.5">{w.punctuated_word}</span>
            {i < words.length - 1 && (
              <button onClick={() => onPick(i)} title={`розділити після «${w.punctuated_word}»`}
                className="mx-0.5 rounded px-1 text-blue-400 hover:bg-blue-200 hover:text-blue-800">|</button>
            )}
          </span>
        ))}
      </div>
    </div>
  )
}

function fmt(v: number | null) { return v == null ? '—' : v.toFixed(1) }
