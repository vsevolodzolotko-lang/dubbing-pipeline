import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useSegments } from '../api/queries'
import { useRunState } from '../api/useRunState'
import { canWriteTranslations } from '../ui'
import { GateBar } from '../components/GateBar'
import { saveTranslations, checkTranslations, type CheckResult } from '../api/staged'
import type { RawSegment } from '../api/types'
import { AlertTriangle, Check } from 'lucide-react'

const shortId = (id: string) => id.replace(/^.*_seg_/, 'seg ')
const langsOf = (seg?: RawSegment) =>
  seg ? Object.keys(seg).filter((k) => /^[a-z]{2}_text$/.test(k)).map((k) => k.slice(0, 2)) : []

// results[lang][segmentId] = verdict
type Results = Record<string, Record<string, CheckResult>>

export function TranslationReview() {
  const { state } = useRunState()
  const { data, isLoading } = useSegments()
  const qc = useQueryClient()
  const editable = canWriteTranslations(state)
  const segs = data?.rows ?? []
  // EN is shown as the constant left column in every card — not a selectable language.
  const langs = useMemo(() => langsOf(segs[0]).filter((l) => l !== 'en'), [segs])
  const hasText = segs.some((s) => langs.some((l) => String(s[`${l}_text`] ?? '').trim()))
  const translating = state?.state === 'TRANSLATING'

  const [lang, setLang] = useState<string>('')
  // sel === null means "all selected"; otherwise the explicit set of checked ids
  const [sel, setSel] = useState<Set<string> | null>(null)
  const [results, setResults] = useState<Results>({})
  const [checking, setChecking] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => { if (langs.length && !langs.includes(lang)) setLang(langs[0]) }, [langs, lang])

  const isChecked = (id: string) => sel === null || sel.has(id)
  const allChecked = sel === null || segs.every((s) => sel.has(s.segment_id))
  const selectedIds = segs.filter((s) => isChecked(s.segment_id)).map((s) => s.segment_id)

  function toggle(id: string) {
    const base = sel === null ? new Set(segs.map((s) => s.segment_id)) : new Set(sel)
    if (base.has(id)) base.delete(id); else base.add(id)
    setSel(base)
  }
  function toggleAll() { setSel(allChecked ? new Set() : null) }

  const langResults = results[lang] || {}

  async function check() {
    if (!selectedIds.length) { setMsg('No segments selected'); return }
    setChecking(true); setMsg(null)
    try {
      const r = await checkTranslations(lang, selectedIds)
      setResults((prev) => ({ ...prev, [lang]: Object.fromEntries(r.results.map((x) => [x.segment_id, x])) }))
    } catch (e) { setMsg(e instanceof Error ? e.message : 'check error') }
    finally { setChecking(false) }
  }

  async function commit(seg: RawSegment) {
    const key = `${seg.segment_id}:${lang}`
    const draft = drafts[key]
    if (draft == null || draft === String(seg[`${lang}_text`] ?? '')) return
    try { await saveTranslations([{ segmentId: seg.segment_id, lang, text: draft }]); qc.invalidateQueries({ queryKey: ['segments'] }) }
    catch (e) { setMsg(e instanceof Error ? e.message : 'save error') }
  }

  async function applyOne(segId: string, text: string) {
    try {
      await saveTranslations([{ segmentId: segId, lang, text }])
      qc.invalidateQueries({ queryKey: ['segments'] })
      setDrafts((d) => { const n = { ...d }; delete n[`${segId}:${lang}`]; return n })
      setResults((r) => { const lr = { ...(r[lang] || {}) }; delete lr[segId]; return { ...r, [lang]: lr } })
    } catch (e) { setMsg(e instanceof Error ? e.message : 'error') }
  }

  async function applyAllSuggested() {
    const rows = Object.values(langResults)
      .filter((x) => !x.ok && x.suggestion)
      .map((x) => ({ segmentId: x.segment_id, lang, text: x.suggestion as string }))
    if (!rows.length) return
    try {
      await saveTranslations(rows)
      qc.invalidateQueries({ queryKey: ['segments'] })
      setDrafts({})
      setResults((r) => ({ ...r, [lang]: {} }))
    } catch (e) { setMsg(e instanceof Error ? e.message : 'apply error') }
  }

  // soft-gate warnings: any checked-and-not-ok-and-still-suggested cell, all langs
  const warnings: string[] = []
  for (const [l, rs] of Object.entries(results)) {
    for (const x of Object.values(rs)) if (!x.ok && x.suggestion) warnings.push(`${l} ${shortId(x.segment_id)}: ${x.comment}`)
  }
  const suggestedCount = Object.values(langResults).filter((x) => !x.ok && x.suggestion).length

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-5xl p-6">
          <div className="mb-3 flex items-center gap-3">
            <h1 className="text-lg font-semibold">Translation Review</h1>
            <span className="text-sm text-gray-500">{segs.length} segments · {langs.length} languages</span>
            {!editable && <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-500">read-only</span>}
          </div>

          {translating || (!hasText && !isLoading) ? (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-6 text-center text-sm text-blue-800 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300">
              Translation (W2) in progress for {langs.length} languages… This page will refresh automatically when it is ready.
            </div>
          ) : isLoading ? (
            <div className="text-sm text-gray-400">Loading…</div>
          ) : (
            <>
              {/* language selector */}
              <div className="mb-3 flex flex-wrap gap-1.5">
                {langs.map((l) => {
                  const rs = results[l]
                  const issues = rs ? Object.values(rs).filter((x) => !x.ok).length : null
                  const active = l === lang
                  return (
                    <button key={l} onClick={() => setLang(l)}
                      className={`rounded-full border px-3 py-1 text-xs font-medium ${
                        active ? 'border-gray-900 bg-gray-900 text-white dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900' : 'border-gray-300 dark:border-[#3a3a3d] bg-white dark:bg-[#161617] text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#202023]'}`}>
                      {l.toUpperCase()}
                      {issues != null && (
                        <span className={`ml-1.5 inline-flex items-center gap-0.5 ${issues ? 'text-red-400' : 'text-green-500'}`}>
                          {issues ? (<><AlertTriangle className="inline-block h-3.5 w-3.5 align-[-0.2em]" strokeWidth={1.75} />{issues}</>) : <Check className="inline-block h-3.5 w-3.5 align-[-0.2em]" strokeWidth={1.75} />}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>

              {/* batch controls */}
              <div className="mb-3 flex items-center gap-3 rounded-md border border-gray-200 dark:border-[#29292c] bg-gray-50 px-3 py-2 dark:bg-[#202023]/60">
                <label className="flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-300">
                  <input type="checkbox" checked={allChecked} onChange={toggleAll} />
                  Select all
                </label>
                <span className="text-xs text-gray-400">{selectedIds.length} of {segs.length} selected</span>
                <button onClick={check} disabled={checking || !selectedIds.length}
                  className="ml-auto rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:bg-gray-300 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white dark:disabled:bg-[#3a3a3d] dark:disabled:text-gray-400"
                  title="Send the selected segments for this language to AI review as one batch">
                  {checking ? 'Checking…' : `Check with AI (${lang.toUpperCase()}, ${selectedIds.length})`}
                </button>
                {suggestedCount > 0 && editable && (
                  <button onClick={applyAllSuggested}
                    className="rounded-md bg-green-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-800">
                    Accept all AI edits ({suggestedCount})
                  </button>
                )}
              </div>

              {msg && <div className="mb-3 rounded-md bg-red-50 p-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">{msg}</div>}

              {/* segment list for the active language */}
              <ol className="space-y-2">
                {segs.map((seg) => {
                  const key = `${seg.segment_id}:${lang}`
                  const orig = String(seg[`${lang}_text`] ?? '')
                  const draft = drafts[key] ?? orig
                  const res = langResults[seg.segment_id]
                  const tone = !res ? 'border-gray-200 dark:border-[#29292c] bg-white dark:bg-[#161617]'
                    : res.ok ? 'border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/40' : 'border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40'
                  return (
                    <li key={seg.segment_id} className={`rounded-lg border p-3 ${tone}`}>
                      <div className="mb-1 flex items-center gap-2 text-xs text-gray-500">
                        <input type="checkbox" checked={isChecked(seg.segment_id)} onChange={() => toggle(seg.segment_id)} />
                        <span className="font-mono">{shortId(seg.segment_id)}</span>
                        {res && (
                          <span className={`ml-auto inline-flex items-center gap-1 ${res.ok ? 'text-green-700' : 'text-amber-700'}`}>
                            {res.ok ? (<><Check className="inline-block h-3.5 w-3.5 align-[-0.2em]" strokeWidth={1.75} />OK</>) : (<><AlertTriangle className="inline-block h-3.5 w-3.5 align-[-0.2em]" strokeWidth={1.75} />issues</>)}
                          </span>
                        )}
                      </div>
                      {/* Two columns: EN original (read-only constant) + the selected language */}
                      <div className="grid grid-cols-2 gap-3">
                        <div className="flex flex-col">
                          <div className="mb-1 font-mono text-[11px] uppercase tracking-wide text-gray-400">EN · original</div>
                          <div className="flex-1 rounded border border-gray-200 bg-gray-50 px-2 py-1 text-sm text-gray-600 dark:border-[#29292c] dark:bg-[#202023] dark:text-gray-400" title="EN is a constant and is not editable">
                            {seg.en_text}
                          </div>
                        </div>
                        <div className="flex flex-col">
                          <div className="mb-1 font-mono text-[11px] uppercase tracking-wide text-gray-400">{lang}</div>
                          <textarea
                            value={draft} disabled={!editable} rows={2}
                            onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
                            onBlur={() => commit(seg)}
                            className="w-full flex-1 resize-none rounded border border-gray-200 bg-white px-2 py-1 text-sm disabled:bg-gray-50 dark:border-[#29292c] dark:bg-[#161617] dark:disabled:bg-[#202023]"
                          />
                          {res && !res.ok && (
                            <div className="mt-1.5 rounded-md border border-amber-200 bg-white dark:border-amber-900 dark:bg-[#161617] p-2 text-xs">
                              <div className="text-amber-800 dark:text-amber-300"><b>AI comment:</b> {res.comment}</div>
                              {res.suggestion && (
                                <>
                                  <div className="mt-1 text-gray-700 dark:text-gray-300"><b>Suggestion:</b> {res.suggestion}</div>
                                  {editable && (
                                    <button onClick={() => applyOne(seg.segment_id, res.suggestion as string)}
                                      className="mt-1 rounded-md bg-green-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-green-800">Accept AI edit</button>
                                  )}
                                </>
                              )}
                            </div>
                          )}
                          {res && res.ok && (
                            <div className="mt-1 inline-flex items-center gap-1 text-xs text-green-700">
                              <Check className="inline-block h-3.5 w-3.5 align-[-0.2em]" strokeWidth={1.75} />
                              {res.comment}
                            </div>
                          )}
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ol>
            </>
          )}
        </div>
      </div>

      <GateBar
        gate="translations"
        title="Stage 2/3 · Translation"
        summary={Object.keys(results).length ? `AI reviewed · ${warnings.length} unresolved issues` : `${segs.length} segments · ${langs.length} languages`}
        warnings={warnings}
        primaryLabel="Approve and start synthesis"
      />
    </div>
  )
}
