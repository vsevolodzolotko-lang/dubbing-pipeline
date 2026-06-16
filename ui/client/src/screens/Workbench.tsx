import { useEffect, useMemo, useRef, useState } from 'react'
import { useLesson } from '../api/queries'
import { cellClass, canWrite, writeBlockReason } from '../ui'
import { useRunState } from '../api/useRunState'
import { useCart } from '../api/cart'
import { WaveformPlayer, type PlayerHandle } from '../components/WaveformPlayer'
import { getRegenOld } from '../api/regenHistory'
import type { Cause, Cell, SegmentRow } from '../api/types'

type Filter = 'all' | 'qa' | 'review'

export function Workbench() {
  const { data, isLoading, error } = useLesson()
  const { state, regen } = useRunState()
  const cart = useCart()
  const inFlight = new Set(regen.active ? (regen.rowKeys ?? []) : [])
  const [selected, setSelected] = useState<{ seg: number; lang: string } | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [editedText, setEditedText] = useState('')
  const [verdictMsg, setVerdictMsg] = useState<string | null>(null)
  const playerRef = useRef<PlayerHandle>(null)
  const writable = canWrite(state)

  const selCell = selected && data ? data.segments[selected.seg]?.cells[selected.lang] : null
  const selSegRow = selected && data ? data.segments[selected.seg] : null

  // reset edited text when the selected cell changes
  useEffect(() => {
    setEditedText(selCell?.textTranslated ?? '')
    setVerdictMsg(null)
  }, [selected, selCell?.textTranslated])

  async function verdict(value: 'TRUE' | 'FALSE') {
    if (!writable || !selCell?.rowKey) return
    setVerdictMsg('…')
    try {
      const res = await fetch('/api/attention', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: [{ rowKey: selCell.rowKey, value }] }),
      })
      setVerdictMsg(res.ok ? (value === 'FALSE' ? '🟢 Прийнято' : '🔴 Позначено') : `Помилка: ${(await res.json()).error}`)
    } catch (e) { setVerdictMsg(String(e)) }
  }

  function addToCart() {
    if (!selCell?.rowKey || !selSegRow) return
    cart.add({
      rowKey: selCell.rowKey, segmentId: selSegRow.segmentId, lang: selected!.lang,
      oldText: selCell.textTranslated ?? '', newText: editedText,
    })
    setVerdictMsg('🧺 У кошику')
  }

  // Keyboard: Space play, E original, F ok, T bad, R cart, Esc close.
  const kbd = useRef<(e: KeyboardEvent) => void>(() => {})
  kbd.current = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA') return
    if (e.key === ' ') { e.preventDefault(); playerRef.current?.toggle() }
    else if (e.key === 'e' || e.key === 'E' || e.key === 'у' || e.key === 'У') playerRef.current?.playEn()
    else if (e.key === 'f' || e.key === 'F' || e.key === 'а' || e.key === 'А') verdict('FALSE')
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

  if (isLoading) return <div className="p-8 text-sm text-gray-400">Завантаження уроку…</div>
  if (error) return <div className="p-8 text-sm text-red-600">Помилка: {String(error)}</div>
  if (!data || data.segments.length === 0) return <div className="p-8 text-sm text-gray-400">Немає даних уроку.</div>

  return (
    <div className="flex h-full min-h-0">
      <div className="min-w-0 flex-1 overflow-auto p-4">
        <div className="mb-3 flex items-center gap-2">
          <h1 className="text-lg font-semibold">Перевірка · {data.lessonId}</h1>
          <div className="ml-3 flex rounded-md border border-gray-300 text-sm">
            <FilterBtn active={filter === 'all'} onClick={() => setFilter('all')}>Усі</FilterBtn>
            <FilterBtn active={filter === 'qa'} onClick={() => setFilter('qa')}>Проблемні</FilterBtn>
            <FilterBtn active={filter === 'review'} onClick={() => setFilter('review')}>Після регену</FilterBtn>
          </div>
          <Legend />
        </div>

        <table className="border-separate border-spacing-1 text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-[#f6f7f9] px-2 py-1 text-left text-xs font-medium text-gray-500">Сегмент</th>
              {data.langs.map((l) => (
                <th key={l} className="px-2 py-1 text-xs font-mono font-medium text-gray-500">{l}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {segments.map(({ s, i }) => (
              <tr key={s.segmentId}>
                <td className="sticky left-0 z-10 max-w-[18rem] truncate bg-[#f6f7f9] px-2 py-1 text-xs text-gray-600" title={s.enText}>
                  <span className="font-mono text-gray-400">{shortId(s.segmentId)}</span>{' '}
                  {s.movementLocked && <span title="сегмент із рухом">🏃</span>} {s.enText}
                </td>
                {data.langs.map((l) => {
                  const c = s.cells[l]
                  const isSel = selected?.seg === i && selected?.lang === l
                  const regening = Boolean(c.rowKey && inFlight.has(c.rowKey))
                  return (
                    <td key={l} className="p-0">
                      <button
                        onClick={() => setSelected({ seg: i, lang: l })}
                        className={`h-7 w-9 rounded border text-[11px] ${cellClass(c.status, c.needsRetts)} ${isSel ? 'ring-2 ring-gray-900' : ''} ${regening ? 'animate-pulse ring-1 ring-blue-400' : ''}`}
                        title={regening ? 'перегенерується…' : c.diagnosis?.primary}
                      >
                        {regening ? '↻' : cellGlyph(c)}
                      </button>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selCell && selSegRow && (
        <DetailPanel
          key={selCell.rowKey}
          cell={selCell}
          seg={selSegRow}
          lang={selected!.lang}
          playerRef={playerRef}
          editedText={editedText}
          setEditedText={setEditedText}
          writable={writable}
          blockReason={writeBlockReason(state)}
          inFlight={selCell.rowKey ? inFlight.has(selCell.rowKey) : false}
          inCart={selCell.rowKey ? cart.has(selCell.rowKey) : false}
          verdictMsg={verdictMsg}
          onVerdict={verdict}
          onAddCart={addToCart}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}

function DetailPanel({ cell, seg, lang, playerRef, editedText, setEditedText, writable, blockReason, inFlight, inCart, verdictMsg, onVerdict, onAddCart, onClose }: {
  cell: Cell; seg: SegmentRow; lang: string; playerRef: React.Ref<PlayerHandle>
  editedText: string; setEditedText: (v: string) => void
  writable: boolean; blockReason: string; inFlight: boolean; inCart: boolean; verdictMsg: string | null
  onVerdict: (v: 'TRUE' | 'FALSE') => void; onAddCart: () => void; onClose: () => void
}) {
  const d = cell.diagnosis
  const edited = editedText !== (cell.textTranslated ?? '')
  const regenOld = cell.status === 'REVIEW' && cell.rowKey ? getRegenOld(cell.rowKey) : null
  return (
    <aside className="flex w-96 shrink-0 flex-col overflow-auto border-l border-gray-200 bg-white p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="font-mono text-xs text-gray-400">{shortId(seg.segmentId)} · {lang}</div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-700">✕</button>
      </div>

      <div className="mb-3 rounded-md bg-gray-50 p-3 text-sm">
        <div className="text-xs font-medium text-gray-400">EN-оригінал</div>
        <div className="text-gray-700">{seg.enText}</div>
        <div className="mt-2 flex items-center justify-between">
          <span className="text-xs font-medium text-gray-400">Переклад ({lang})</span>
          {edited && <span className="text-[10px] text-amber-600">змінено — додай у кошик</span>}
        </div>
        <textarea
          value={editedText}
          onChange={(e) => setEditedText(e.target.value)}
          disabled={!writable}
          rows={3}
          className="mt-1 w-full resize-y rounded border border-gray-300 px-2 py-1 text-sm text-gray-900 disabled:bg-gray-100"
        />
      </div>

      {inFlight && (
        <div className="mb-3 animate-pulse rounded-md bg-blue-50 px-2 py-1.5 text-sm text-blue-800">↻ Перегенерується… зачекай завершення.</div>
      )}

      {regenOld && (
        <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs">
          <div className="font-medium text-amber-800">Після перегенерації — порівняй:</div>
          <div className="mt-1 text-gray-500 line-through">{regenOld.old}</div>
          <div className="text-green-800">{regenOld.neu}</div>
        </div>
      )}

      {/* actions */}
      <div className="mb-3">
        <div className="flex flex-wrap gap-2">
          <button onClick={() => onVerdict('FALSE')} disabled={!writable}
            title={writable ? 'клавіша F' : blockReason}
            className="rounded-md border border-green-300 bg-green-50 px-3 py-1.5 text-sm text-green-800 hover:bg-green-100 disabled:opacity-40">🟢 Ок</button>
          <button onClick={() => onVerdict('TRUE')} disabled={!writable}
            title={writable ? 'клавіша T' : blockReason}
            className="rounded-md border border-red-300 bg-red-50 px-3 py-1.5 text-sm text-red-800 hover:bg-red-100 disabled:opacity-40">🔴 Погано</button>
          <button onClick={onAddCart} disabled={!writable}
            title={writable ? 'клавіша R' : blockReason}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-100 disabled:opacity-40">🧺 {inCart ? 'Оновити в кошику' : 'У кошик'}</button>
        </div>
        {!writable && <div className="mt-1 text-[11px] text-amber-600">{blockReason}</div>}
        {verdictMsg && <div className="mt-1 text-xs text-gray-500">{verdictMsg}</div>}
      </div>

      {d && (
        <div className="mb-3">
          <SeverityChip severity={d.severity} />
          <div className="mt-2 text-sm font-medium text-gray-900">{d.primary}</div>
          {d.causes.length > 0 && (
            <div className="mt-3">
              <div className="mb-1 text-xs font-medium text-gray-500">Можливі причини</div>
              <ul className="space-y-1.5">
                {d.causes.map((c, i) => <CauseRow key={i} cause={c} />)}
              </ul>
            </div>
          )}
          {d.advice && (
            <div className="mt-3 rounded-md bg-blue-50 px-2 py-1.5 text-sm text-blue-900">💡 {d.advice}</div>
          )}
          {d.fill && (
            <div className="mt-3">
              <div className="text-xs text-gray-500">Дубляж {d.fill.real?.toFixed(1)}с / слот {d.fill.slot?.toFixed(1)}с</div>
              <div className="mt-1 h-1.5 w-full rounded bg-gray-100">
                <div className="h-1.5 rounded bg-gray-500" style={{ width: `${Math.min(100, (d.fill.real / d.fill.slot) * 100)}%` }} />
              </div>
            </div>
          )}
          {d.facts.length > 0 && (
            <div className="mt-3">
              <div className="mb-1 text-xs font-medium text-gray-500">Що зробила автоматика</div>
              <ul className="space-y-1 text-xs text-gray-500">
                {d.facts.map((t, i) => <li key={i}>• {t}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {cell.rowKey && (
        <WaveformPlayer
          key={cell.rowKey}
          ref={playerRef}
          audioUrl={`/api/audio/segment/${cell.rowKey}`}
          peaksUrl={`/api/peaks/segment/${cell.rowKey}`}
          enUrl={`/api/audio/en/segment/${cell.rowKey}`}
        />
      )}
      <div className="mt-1 text-[11px] text-gray-400">Space — грати · E — оригінал · F — ок · T — погано · R — у кошик</div>

      <details className="mt-3 text-xs text-gray-500">
        <summary className="cursor-pointer">Технічні деталі</summary>
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
      <dd className="truncate text-gray-700" title={String(v ?? '')}>{v === '' || v == null ? '—' : String(v)}</dd>
    </>
  )
}

const CAUSE_ICON: Record<string, string> = {
  length: '✂️', speed: '⏩', density: '🧱', movement: '🏃',
  regen: '🔁', phase2: '↔️', tech: '⚠️', tight: '❓',
}

function CauseRow({ cause }: { cause: Cause }) {
  const certain = cause.confidence === 'certain'
  return (
    <li className="flex items-start gap-2 text-sm">
      <span className="mt-0.5 shrink-0">{CAUSE_ICON[cause.kind] ?? '•'}</span>
      <span className="flex-1 text-gray-700">{cause.text}</span>
      <span
        className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
          certain ? 'bg-gray-200 text-gray-600' : 'bg-amber-100 text-amber-700'}`}
        title={certain ? 'факт із даних пайплайна' : 'припущення на основі сигналів'}
      >
        {certain ? 'точно' : 'ймовірно'}
      </span>
    </li>
  )
}

function SeverityChip({ severity }: { severity: string }) {
  const map: Record<string, string> = {
    ok: 'bg-green-100 text-green-800', bad: 'bg-red-100 text-red-800',
    review: 'bg-amber-100 text-amber-800', queued: 'bg-blue-100 text-blue-800', warn: 'bg-amber-100 text-amber-800',
  }
  const label: Record<string, string> = { ok: '🟢 Без зауважень', bad: '🔴 Потребує уваги', review: '🟡 На перегляд', queued: '🔵 У кошику', warn: '🟡 Увага' }
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${map[severity] ?? map.warn}`}>{label[severity] ?? severity}</span>
}

function FilterBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`px-3 py-1 first:rounded-l-md last:rounded-r-md ${active ? 'bg-gray-900 text-white' : 'bg-white text-gray-600'}`}>
      {children}
    </button>
  )
}

function Legend() {
  return (
    <div className="ml-auto flex gap-3 text-[11px] text-gray-500">
      <Lg cls="bg-green-50 border-green-200" t="ок" />
      <Lg cls="bg-red-100 border-red-200" t="увага" />
      <Lg cls="bg-amber-100 border-amber-200" t="перегляд" />
      <Lg cls="bg-blue-100 border-blue-200" t="у кошику" />
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
function cellGlyph(c: Cell) {
  if (c.needsRetts) return '⟳'
  if (c.status === 'TRUE') return '!'
  if (c.status === 'REVIEW') return '?'
  if (c.status === 'MISSING') return '·'
  return '✓'
}
function shortId(segmentId: string) {
  const m = segmentId.match(/_seg_(\d+)$/)
  return m ? `seg_${m[1]}` : segmentId
}
