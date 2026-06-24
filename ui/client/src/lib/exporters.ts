// Client-side export generators. These build deliverables (subtitles, sheets,
// manifests) directly from the lesson model already in the snapshot, so they work
// identically in mock and live — no server round-trip. Audio/video artifacts that
// need ffmpeg or Drive are handled separately (existing /api/audio endpoints, or
// Фаза P server render).
import type { Lesson, SegmentRow } from '../api/types'

export interface Cue { start: number; end: number; text: string }

const EN = 'en'

// Text + timing for one language on one segment. Non-EN uses the per-language slot
// when retimed, falling back to the shared EN slot; EN uses the source timing.
function cueFor(seg: SegmentRow, lang: string): Cue | null {
  const enStart = seg.enStart ?? 0
  const enEnd = seg.enEnd ?? enStart
  if (lang === EN) {
    const text = (seg.enText || '').trim()
    return text ? { start: enStart, end: enEnd, text } : null
  }
  const cell = seg.cells[lang]
  const text = (cell?.textTranslated || '').trim()
  if (!text) return null
  return { start: cell?.slotStart ?? enStart, end: cell?.slotEnd ?? enEnd, text }
}

export function cuesFor(lesson: Lesson, lang: string): Cue[] {
  return lesson.segments.map((s) => cueFor(s, lang)).filter((c): c is Cue => c !== null)
}

// ── timecodes ────────────────────────────────────────────────────────────────
const pad = (n: number, w = 2) => String(Math.floor(n)).padStart(w, '0')
function clock(t: number, msSep: '.' | ',') {
  const s = Math.max(0, t || 0)
  const ms = Math.round((s - Math.floor(s)) * 1000)
  return `${pad(s / 3600)}:${pad((s % 3600) / 60)}:${pad(s % 60)}${msSep}${pad(ms, 3)}`
}

// ── subtitle formats ───────────────────────────────────────────────────────
export function toVTT(cues: Cue[]): string {
  const body = cues
    .map((c, i) => `${i + 1}\n${clock(c.start, '.')} --> ${clock(c.end, '.')}\n${c.text}`)
    .join('\n\n')
  return `WEBVTT\n\n${body}\n`
}

export function toSRT(cues: Cue[]): string {
  return cues
    .map((c, i) => `${i + 1}\n${clock(c.start, ',')} --> ${clock(c.end, ',')}\n${c.text}`)
    .join('\n\n') + '\n'
}

// ── translation sheet (CSV) ──────────────────────────────────────────────────
function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toTranslationCSV(lesson: Lesson): string {
  const targets = lesson.langs.filter((l) => l !== EN)
  const header = ['segment_id', 'type', 'en_start_sec', 'en_end_sec', 'en_duration_sec', 'en_text', ...targets]
  const rows = lesson.segments.map((s) => [
    s.segmentId, s.segmentType, s.enStart ?? '', s.enEnd ?? '', s.enDuration ?? '', s.enText,
    ...targets.map((l) => s.cells[l]?.textTranslated ?? ''),
  ])
  const lines = [header, ...rows].map((r) => r.map(csvCell).join(','))
  return '﻿' + lines.join('\r\n') + '\r\n' // BOM so Excel/Sheets read UTF-8
}

// ── timing manifest (JSON) ─────────────────────────────────────────────────
export function toManifest(lesson: Lesson) {
  return {
    lessonId: lesson.lessonId,
    langs: lesson.langs,
    generatedAt: new Date().toISOString(),
    segments: lesson.segments.map((s) => ({
      segmentId: s.segmentId,
      type: s.segmentType,
      en: { start: s.enStart, end: s.enEnd, duration: s.enDuration, text: s.enText },
      langs: Object.fromEntries(
        lesson.langs.filter((l) => l !== EN).map((l) => {
          const c = s.cells[l]
          return [l, {
            text: c?.textTranslated ?? null,
            slotStart: c?.slotStart ?? null,
            slotEnd: c?.slotEnd ?? null,
            realDuration: c?.realDuration ?? null,
            finalDuration: c?.finalDuration ?? null,
          }]
        }),
      ),
    })),
  }
}

// ── download helpers ─────────────────────────────────────────────────────────
function clickDownload(href: string, filename: string, revoke?: () => void) {
  const a = document.createElement('a')
  a.href = href
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  if (revoke) setTimeout(revoke, 1000)
}

/** Download in-memory text content (subtitles, CSV, JSON) as a file. */
export function downloadText(filename: string, content: string, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  clickDownload(url, filename, () => URL.revokeObjectURL(url))
}

/** Download a same-origin URL (e.g. an /api/audio endpoint) as a file. */
export function downloadUrl(filename: string, url: string) {
  clickDownload(url, filename)
}

/** Fire a series of same-origin downloads with a small gap (per-segment audio).
 *  Returns the count actually queued. */
export async function downloadSequence(items: { filename: string; url: string }[], gapMs = 400): Promise<number> {
  for (const it of items) {
    downloadUrl(it.filename, it.url)
    await new Promise((r) => setTimeout(r, gapMs))
  }
  return items.length
}
