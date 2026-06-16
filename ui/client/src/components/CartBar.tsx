import { useState } from 'react'
import { useCart } from '../api/cart'
import { useRunState } from '../api/useRunState'
import { recordRegen } from '../api/regenHistory'
import { canWrite, writeBlockReason } from '../ui'

export function CartBar() {
  const { items, remove, clear } = useCart()
  const { state } = useRunState()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string; canRetrigger?: boolean } | null>(null)

  if (items.length === 0 && !msg) return null

  const writable = canWrite(state)
  const reason = writeBlockReason(state)

  async function fire(retrigger = false) {
    setBusy(true); setMsg(null)
    try {
      if (retrigger) {
        const res = await fetch('/api/regen/retrigger', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
        const data = await res.json().catch(() => ({}))
        if (res.ok) { setMsg({ kind: 'ok', text: '🔄 Запуск повторено' }); setOpen(false) }
        else setMsg({ kind: 'err', text: data.error || 'не вдалося', canRetrigger: true })
        return
      }
      const rows = items.map((i) => ({
        rowKey: i.rowKey,
        textTranslated: i.newText !== i.oldText ? i.newText : undefined,
        regenComment: i.comment,
      }))
      const res = await fetch('/api/regen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows }) })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.ok) {
        recordRegen(items.map((i) => ({ rowKey: i.rowKey, oldText: i.oldText, newText: i.newText })))
        setMsg({ kind: 'ok', text: `🔄 Перегенерацію запущено (${data.count}). Рядки стануть REVIEW — послухай у Перевірці.` })
        clear(); setOpen(false)
      } else if (data.flagsWritten) {
        setMsg({ kind: 'err', text: data.error || 'Прапорці виставлені, але вебхук не спрацював.', canRetrigger: true })
        clear(); setOpen(false)
      } else {
        setMsg({ kind: 'err', text: data.error || `Помилка ${res.status}` })
      }
    } catch (e) {
      setMsg({ kind: 'err', text: String(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="flex items-center gap-3 border-t border-gray-200 bg-white px-5 py-2 shadow-[0_-1px_3px_rgba(0,0,0,0.04)]">
        {items.length > 0 ? (
          <>
            <span className="text-sm">🧺 Кошик перегенерації: <b>{items.length}</b></span>
            <button
              onClick={() => setOpen(true)}
              disabled={!writable}
              title={writable ? '' : reason}
              className="rounded-md bg-gray-900 px-3 py-1.5 text-sm text-white hover:bg-gray-700 disabled:opacity-40"
            >
              Перегенерувати
            </button>
            <button onClick={clear} className="text-sm text-gray-500 hover:text-gray-800">Очистити</button>
            {!writable && <span className="text-xs text-amber-600">{reason}</span>}
          </>
        ) : null}
        {msg && (
          <span className={`ml-auto flex items-center gap-2 text-sm ${msg.kind === 'ok' ? 'text-green-700' : 'text-red-700'}`}>
            {msg.text}
            {msg.canRetrigger && (
              <button onClick={() => fire(true)} disabled={busy} className="rounded border border-red-300 px-2 py-0.5 text-xs">Повторити запуск</button>
            )}
            <button onClick={() => setMsg(null)} className="text-gray-400">✕</button>
          </span>
        )}
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => !busy && setOpen(false)}>
          <div className="max-h-[80vh] w-[40rem] overflow-auto rounded-xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold">Перегенерувати {items.length} сегментів?</h2>
            <p className="mt-1 text-sm text-gray-500">
              Будуть виставлені <code>needs_retts=TRUE</code> і записані правки тексту, потім запуститься W_Regen.
              Рядки стануть <b>REVIEW</b> для прослуху.
            </p>
            <ul className="mt-3 space-y-2">
              {items.map((i) => (
                <li key={i.rowKey} className="rounded-md border border-gray-200 p-2 text-sm">
                  <div className="font-mono text-xs text-gray-400">{shortId(i.segmentId)} · {i.lang}{i.comment ? ` · ${i.comment}` : ''}</div>
                  {i.newText !== i.oldText ? (
                    <>
                      <div className="text-red-700 line-through">{i.oldText}</div>
                      <div className="text-green-800">{i.newText}</div>
                    </>
                  ) : (
                    <div className="text-gray-600">{i.newText} <span className="text-xs text-gray-400">(без змін тексту — лише пересинтез)</span></div>
                  )}
                  <button onClick={() => remove(i.rowKey)} className="mt-1 text-xs text-gray-400 hover:text-red-600">прибрати</button>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex gap-2">
              <button onClick={() => fire(false)} disabled={busy} className="rounded-md bg-gray-900 px-4 py-2 text-sm text-white hover:bg-gray-700 disabled:opacity-50">
                {busy ? 'Запускаю…' : 'Так, перегенерувати'}
              </button>
              <button onClick={() => setOpen(false)} disabled={busy} className="rounded-md border border-gray-300 px-4 py-2 text-sm">Скасувати</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function shortId(segmentId: string) {
  const m = segmentId.match(/_seg_(\d+)$/)
  return m ? `seg_${m[1]}` : segmentId
}
