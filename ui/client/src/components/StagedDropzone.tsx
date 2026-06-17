import { useRef, useState } from 'react'
import { useRunState } from '../api/useRunState'

/**
 * Entry point for the STAGED flow: drop an EN file → hands the filename up to the
 * Lesson tab, which opens the Pre-flight setup (it does NOT start the run — that
 * happens after the operator confirms settings in Pre-flight).
 */
export function StagedDropzone({ onFile }: { onFile: (fileName: string) => void }) {
  const { state } = useRunState()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const writesOff = !state?.enableWrites

  function onDrop(e: React.DragEvent) {
    e.preventDefault(); setDragOver(false)
    const f = e.dataTransfer.files?.[0]
    if (f) onFile(f.name)
  }

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={`cursor-pointer rounded-lg border-2 border-dashed p-6 text-center text-sm transition ${
          dragOver ? 'border-blue-400 bg-blue-50 text-blue-700 dark:border-blue-700 dark:bg-blue-950/40 dark:text-blue-300'
          : 'border-gray-300 text-gray-500 hover:border-gray-400 dark:border-[#473d31] dark:text-gray-400 dark:hover:border-gray-500'}`}
      >
        ⬇ Перетягни EN-аудіо сюди, щоб підготувати поетапний урок
      </div>
      <input ref={inputRef} type="file" accept="audio/*" className="hidden"
        onChange={(e) => { const n = e.target.files?.[0]?.name; if (n) onFile(n) }} />
      <p className="mt-3 text-xs text-gray-400">
        Спершу буде підготовка (назва, мови, перевірка голосів/CPS), і лише потім старт транскрипту.
        {writesOff && ' Записи вимкнені — старт буде недоступний.'}
      </p>
    </div>
  )
}
