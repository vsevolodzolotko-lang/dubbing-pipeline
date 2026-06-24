import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, RotateCcw } from 'lucide-react'
import { useRunState } from '../api/useRunState'
import { getTranslationPrompt, saveTranslationPrompt } from '../api/staged'
import { listPrompts, getPromptDetail, savePrompt, type PromptRow } from '../api/prompts'
import { PROMPT_META, GROUP_BLURB } from '../promptCatalog'

// The translation-check prompt (LLM review on the AI-analysis tab) lives in its own
// group, first. Pipeline templates follow, grouped by stage.
const QUALITY = 'Quality (AI analysis)'
const GROUP_ORDER = [QUALITY, 'Reference', 'Translation (W2)', 'Synthesis timing (W3)', 'Deprecated']

export function Prompts() {
  const { state } = useRunState()
  const writable = Boolean(state?.enableWrites)
  const { data, isLoading } = useQuery({ queryKey: ['prompts'], queryFn: listPrompts })
  const rows = data?.rows ?? []

  const groups = useMemo(() => {
    const g: Record<string, PromptRow[]> = {}
    for (const r of rows) (g[r.group || 'Other'] ??= []).push(r)
    return g
  }, [rows])
  const orderedGroups = [
    ...GROUP_ORDER.filter((g) => g !== QUALITY && groups[g]),
    ...Object.keys(groups).filter((g) => !GROUP_ORDER.includes(g)),
  ]

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">Prompts</h1>
        {!writable && <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">read-only — writes disabled</span>}
      </div>
      <p className="mt-1 max-w-prose text-sm text-gray-500 dark:text-gray-400">
        Every prompt that drives an LLM step, in pipeline order. Click a card to read or edit it.
        <code className="mx-1 rounded bg-gray-100 px-1 dark:bg-[#202023]">{'{{markers}}'}</code> are filled in by the pipeline; changes apply to <b>upcoming</b> lessons.
      </p>

      <div className="mt-6 space-y-7">
        {/* AI translation-check prompt (moved here from the AI-analysis tab) */}
        <Section title={QUALITY}>
          <TranslationCheckCard writable={writable} />
        </Section>

        {isLoading ? (
          <div className="text-sm text-gray-400">Loading prompts…</div>
        ) : (
          orderedGroups.map((g) => (
            <Section key={g} title={g}>
              <div className="space-y-2">
                {groups[g].map((r) => <PromptCard key={r.key} row={r} writable={writable} />)}
              </div>
            </Section>
          ))
        )}
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">{title}</h2>
      {GROUP_BLURB[title] && <p className="mb-2 mt-0.5 text-xs text-gray-400">{GROUP_BLURB[title]}</p>}
      <div className={GROUP_BLURB[title] ? '' : 'mt-2'}>{children}</div>
    </section>
  )
}

// ── one card header (shared shape): title + stage chip + plain blurb + key·size ──
function CardHeader({ icon, title, stage, blurb, sub, edited, open }: {
  icon: React.ReactNode; title: string; stage?: string; blurb: string; sub: string; edited?: boolean; open: boolean
}) {
  return (
    <div className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left">
      <span className="mt-0.5 shrink-0 text-gray-400">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-gray-800 dark:text-gray-200">{title}</span>
          {stage && <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-[#202023] dark:text-gray-400">{stage}</span>}
          {edited && <span className="shrink-0 rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">edited</span>}
          <span className="ml-auto shrink-0 text-xs text-gray-400">{open ? 'collapse' : 'expand'}</span>
        </div>
        <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{blurb}</div>
        <div className="mt-0.5 font-mono text-[10px] text-gray-400">{sub}</div>
      </div>
    </div>
  )
}

// ── pipeline template card (lazy-loads its value on expand) ───────────────────
function PromptCard({ row, writable }: { row: PromptRow; writable: boolean }) {
  const [open, setOpen] = useState(false)
  const meta = PROMPT_META[row.key]
  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-[#29292c] dark:bg-[#161617]">
      <button onClick={() => setOpen((o) => !o)} className="w-full hover:bg-gray-50 dark:hover:bg-[#202023]">
        <CardHeader
          icon={open ? <ChevronDown className="h-4 w-4" strokeWidth={1.75} /> : <ChevronRight className="h-4 w-4" strokeWidth={1.75} />}
          title={meta?.title ?? row.key} stage={meta?.stage} blurb={meta?.blurb ?? row.description}
          sub={`${row.key} · ${row.length} chars`} edited={row.edited} open={open}
        />
      </button>
      {open && <PromptCardBody k={row.key} writable={writable} />}
    </div>
  )
}

function PromptCardBody({ k, writable }: { k: string; writable: boolean }) {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['prompt', k], queryFn: () => getPromptDetail(k) })
  if (isLoading || !data) return <div className="border-t border-gray-100 px-3 py-3 text-xs text-gray-400 dark:border-[#29292c]">Loading…</div>
  return (
    <div className="border-t border-gray-100 p-3 dark:border-[#29292c]">
      {data.description && <p className="mb-2 text-[11px] leading-relaxed text-gray-400">From the sheet: {data.description}</p>}
      <PromptEditor
        initial={data.value} defaultValue={data.default} editable={writable}
        onSave={async (v) => {
          const r = await savePrompt(k, v)
          if (!r.ok) throw new Error(r.error || 'save failed')
          qc.invalidateQueries({ queryKey: ['prompt', k] })
          qc.invalidateQueries({ queryKey: ['prompts'] })
        }}
      />
    </div>
  )
}

// ── AI translation-check prompt card (separate endpoint) ──────────────────────
function TranslationCheckCard({ writable }: { writable: boolean }) {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<{ value: string; default: string; editable: boolean } | null>(null)
  useEffect(() => { getTranslationPrompt().then(setData).catch(() => {}) }, [])
  const meta = PROMPT_META.translation_check
  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-[#29292c] dark:bg-[#161617]">
      <button onClick={() => setOpen((o) => !o)} className="w-full hover:bg-gray-50 dark:hover:bg-[#202023]">
        <CardHeader
          icon={open ? <ChevronDown className="h-4 w-4" strokeWidth={1.75} /> : <ChevronRight className="h-4 w-4" strokeWidth={1.75} />}
          title={meta.title} stage={meta.stage} blurb={meta.blurb}
          sub={`translation_check · ${data ? `${data.value.length} chars` : '…'}`} open={open}
        />
      </button>
      {open && (
        <div className="border-t border-gray-100 p-3 dark:border-[#29292c]">
          {!data ? <div className="text-xs text-gray-400">Loading…</div> : (
            <>
              <PromptEditor initial={data.value} defaultValue={data.default} editable={writable && data.editable}
                onSave={async (v) => { await saveTranslationPrompt(v) }} />
              <p className="mt-2 text-xs text-gray-400">
                Used by the "Run analysis" button on the AI analysis tab (needs a live model key — in mock the LLM is not called).
                {!data.editable && ' Saving in live comes in Stage P (prompts tab).'}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── shared editor: textarea + variable chips + save/reset ─────────────────────
function PromptEditor({ initial, defaultValue, editable, onSave }: {
  initial: string; defaultValue?: string; editable: boolean; onSave: (v: string) => Promise<void>
}) {
  const [val, setVal] = useState(initial)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { setVal(initial) }, [initial])
  const dirty = val !== initial
  const vars = useMemo(() => [...new Set(val.match(/\{\{[^}]+\}\}/g) ?? [])], [val])

  async function save() {
    setBusy(true); setStatus('Saving…')
    try { await onSave(val); setStatus('Saved') }
    catch (e) { setStatus(e instanceof Error ? e.message : 'error') }
    finally { setBusy(false) }
  }

  return (
    <>
      {vars.length > 0 && (
        <div className="mb-1.5 flex flex-wrap items-center gap-1 text-[11px]">
          <span className="text-gray-400">Variables:</span>
          {vars.map((v) => <code key={v} className="rounded bg-gray-100 px-1 text-gray-600 dark:bg-[#202023] dark:text-gray-300">{v}</code>)}
        </div>
      )}
      <textarea value={val} disabled={!editable} rows={12}
        onChange={(e) => { setVal(e.target.value); setStatus(null) }}
        className="w-full resize-y rounded border border-gray-200 px-2 py-1.5 font-mono text-xs leading-relaxed disabled:bg-gray-50 dark:border-[#3a3a3d] dark:bg-[#161617] dark:disabled:bg-[#202023]" />
      <div className="mt-2 flex items-center gap-2">
        <button onClick={save} disabled={!editable || !dirty || busy}
          className="rounded bg-gray-900 px-3 py-1.5 text-sm text-white hover:bg-gray-700 disabled:bg-gray-300 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white dark:disabled:bg-[#3a3a3d] dark:disabled:text-gray-400">
          Save
        </button>
        {defaultValue != null && (
          <button onClick={() => { setVal(defaultValue); setStatus(null) }} disabled={!editable || val === defaultValue}
            className="flex items-center gap-1 rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-40 dark:border-[#3a3a3d] dark:hover:bg-[#202023]">
            <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.75} /> Reset to default
          </button>
        )}
        {status && <span className="text-xs text-gray-500">{status}</span>}
      </div>
    </>
  )
}
