import { useRef, useState } from 'react'
import { Download } from 'lucide-react'
import { useRunState } from '../api/useRunState'

export interface DroppedMedia { audioName: string | null; videoFile: File | null }

/**
 * Entry point for the STAGED flow: drop an EN audio file (required) and/or a
 * reference video (optional). Audio drives the lesson; video is reference-only
 * (timeline under transcript + audio review). Hands both up to the Lesson tab,
 * which opens Pre-flight (it does NOT start the run — that's after confirm).
 */
export function StagedDropzone({ onMedia, large }: { onMedia: (m: DroppedMedia) => void; large?: boolean }) {
  const { state } = useRunState()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const writesOff = !state?.enableWrites

  function classify(files: FileList | null) {
    if (!files || !files.length) return
    let audioName: string | null = null
    let videoFile: File | null = null
    for (const f of Array.from(files)) {
      const isVideo = f.type.startsWith('video/') || /\.(mp4|mov|webm|m4v|mkv)$/i.test(f.name)
      if (isVideo) videoFile ??= f
      else audioName ??= f.name // audio/* or unknown → lesson source
    }
    if (audioName || videoFile) onMedia({ audioName, videoFile })
  }

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); classify(e.dataTransfer.files) }}
        onClick={() => inputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed text-center transition ${
          large ? 'gap-2 px-5 py-14 text-sm' : 'p-6 text-sm'} ${
          dragOver ? 'border-blue-400 bg-blue-50 text-blue-700 dark:border-blue-700 dark:bg-blue-950/40 dark:text-blue-300'
          : 'border-gray-300 text-gray-500 hover:border-gray-400 dark:border-[#3a3a3d] dark:text-gray-400 dark:hover:border-gray-500'}`}
      >
        <Download className={large ? 'h-7 w-7' : 'inline-block h-3.5 w-3.5 align-[-0.2em]'} strokeWidth={1.5} />
        <span>{large ? 'Drop EN audio here' : 'Drop EN audio (and, optionally, a reference video) here to prepare a staged lesson'}</span>
        {large && <span className="text-xs text-gray-400">and, optionally, a reference video — click to browse</span>}
      </div>
      <input ref={inputRef} type="file" accept="audio/*,video/*" multiple className="hidden"
        onChange={(e) => classify(e.target.files)} />
      <p className="mt-3 text-xs text-gray-400">
        Audio is the lesson source; video is reference only (timeline under the transcript and in audio review), the pipeline does not touch it.
        First the setup (name, languages, voices/CPS), then start.
        {writesOff && ' Writes are disabled — start will be unavailable.'}
      </p>
    </div>
  )
}
