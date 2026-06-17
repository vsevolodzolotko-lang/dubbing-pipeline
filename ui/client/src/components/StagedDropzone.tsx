import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useRunState } from '../api/useRunState'
import { startStagedRun, probeSecondDrop } from '../api/staged'

const CAN_START = new Set(['IDLE', 'COMPLETE', 'STOPPED', 'UNKNOWN'])

/**
 * Entry point for the STAGED flow: drop an EN file into the UI (separate from
 * the Drive 01_input auto-flow). Etap M starts the mock simulator; Etap P will
 * upload to drive_staged_input_folder_id + fire the W1 webhook.
 */
export function StagedDropzone() {
  const { state } = useRunState()
  const nav = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [lockMsg, setLockMsg] = useState<string | null>(null)

  const canStart = Boolean(state?.enableWrites) && CAN_START.has(state?.state ?? '')
  const active = state?.staged && !canStart

  async function start(fileName?: string) {
    if (!canStart || busy) return
    setBusy(true); setErr(null)
    try {
      const lessonId = fileName ? fileName.replace(/\.(wav|mp3|m4a)$/i, '') : undefined
      const res = await startStagedRun(lessonId)
      if (!res.ok) { setErr(res.error || 'не вдалося стартувати'); return }
      nav('/transcript')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'помилка')
    } finally {
      setBusy(false)
    }
  }

  async function checkLock() {
    setLockMsg(null)
    try {
      const r = await probeSecondDrop()
      setLockMsg(r.busy ? (r.error || 'зайнято') : 'вільно — можна стартувати')
    } catch (e) {
      setLockMsg(e instanceof Error ? e.message : 'помилка')
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault(); setDragOver(false)
    const f = e.dataTransfer.files?.[0]
    start(f?.name)
  }

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => canStart && inputRef.current?.click()}
        className={`rounded-lg border-2 border-dashed p-6 text-center text-sm transition ${
          !canStart ? 'cursor-not-allowed border-gray-200 text-gray-400'
          : dragOver ? 'border-blue-400 bg-blue-50 text-blue-700 cursor-pointer'
          : 'border-gray-300 text-gray-500 hover:border-gray-400 cursor-pointer'}`}
      >
        {busy ? 'Стартую…'
          : active ? '▶ Staged-ран триває — заверши поточний урок, перш ніж починати новий'
          : !state?.enableWrites ? 'Завантаження увімкнеться, коли активуєш записи (ENABLE_WRITES)'
          : '⬇ Перетягни EN-аудіо сюди, щоб почати поетапний урок (з воротами рев’ю)'}
      </div>
      <input ref={inputRef} type="file" accept="audio/*" className="hidden"
        onChange={(e) => start(e.target.files?.[0]?.name)} />

      {err && <div className="mt-2 rounded-md bg-red-50 p-2 text-xs text-red-700">{err}</div>}

      <p className="mt-3 text-xs text-gray-400">
        Це окремий шлях від авто-потоку: файл у Drive <code>01_input</code> досі запускає повну автоматику без воріт.
      </p>

      <button onClick={checkLock} className="mt-2 text-xs text-gray-400 underline hover:text-gray-600">
        перевірити run-lock
      </button>
      {lockMsg && <span className="ml-2 text-xs text-gray-500">{lockMsg}</span>}
    </div>
  )
}
