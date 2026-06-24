import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'

interface RunMediaCtx {
  videoUrl: string | null
  videoName: string | null
  /** Attach (or clear) the reference video dropped at lesson start. The object
   *  URL lives client-side for the whole run — no server upload in mock. */
  setVideo: (file: File | null) => void
}

const Ctx = createContext<RunMediaCtx>({ videoUrl: null, videoName: null, setVideo: () => {} })

/**
 * Holds the reference VIDEO for the current staged run as a client-side object
 * URL, so it survives navigation (Dashboard → /transcript → /review). Video is a
 * reference only — never uploaded or processed in mock (Etap M). Lives above the
 * router so the timeline + audio player can read it anywhere.
 */
export function RunMediaProvider({ children }: { children: ReactNode }) {
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [videoName, setVideoName] = useState<string | null>(null)
  const urlRef = useRef<string | null>(null)

  const setVideo = useCallback((file: File | null) => {
    if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = null }
    if (file) {
      const url = URL.createObjectURL(file)
      urlRef.current = url
      setVideoUrl(url); setVideoName(file.name)
    } else {
      setVideoUrl(null); setVideoName(null)
    }
  }, [])

  return <Ctx.Provider value={{ videoUrl, videoName, setVideo }}>{children}</Ctx.Provider>
}

export const useRunMedia = () => useContext(Ctx)
