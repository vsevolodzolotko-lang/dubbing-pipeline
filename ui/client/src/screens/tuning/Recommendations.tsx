import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Check, Copy, Sparkles, Undo2, ExternalLink } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useRunState } from '../../api/useRunState'
import { canWrite, writeBlockReason } from '../../ui'
import { getPromptDetail } from '../../api/prompts'
import { runAdvise } from '../../api/tuning'
import { CATALOG } from '../../configCatalog'
import type {
  RecommendationSet, ConfigRecommendation, VoiceRecommendation, PromptRecommendation, Evidence,
} from '../../api/types'
import { recConfChip } from './tuningCatalog'
import { HelpNote } from './Help'

const MODELS = [
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8 · deepest' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 · faster' },
]

export function Recommendations({ advice, onGenerated }: {
  advice: RecommendationSet | null
  onGenerated: (set: RecommendationSet) => void
}) {
  const { state } = useRunState()
  const writable = canWrite(state)
  const reason = writeBlockReason(state)
  const isLive = state?.mode === 'live'
  const [model, setModel] = useState(MODELS[0].id)
  const [running, setRunning] = useState(false)
  const [phase, setPhase] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [showDismissed, setShowDismissed] = useState(false)

  async function generate() {
    setRunning(true); setError(null); setPhase(null); setDismissed(new Set())
    try {
      const set = await runAdvise({ model, onProgress: (p) => setPhase(p.phase) })
      onGenerated(set)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setRunning(false); setPhase(null) }
  }

  const dismiss = (id: string) => setDismissed((s) => new Set(s).add(id))
  const restore = (id: string) => setDismissed((s) => { const n = new Set(s); n.delete(id); return n })

  const cfg = advice?.configRecommendations ?? []
  const voice = advice?.voiceRecommendations ?? []
  const prompts = advice?.promptRecommendations ?? []
  const total = cfg.length + voice.length + prompts.length
  const dismissedCount = useMemo(() => dismissed.size, [dismissed])

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">AI recommendations</h2>
        <select value={model} onChange={(e) => setModel(e.target.value)} disabled={running}
          className="rounded-md border border-gray-300 px-2 py-1 text-xs dark:border-[#3a3a3d] dark:bg-[#161617]">
          {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
        <button onClick={generate} disabled={running}
          className="inline-flex items-center gap-1.5 rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white">
          <Sparkles className="h-4 w-4" strokeWidth={1.75} />
          {running ? (phase === 'advise' ? 'Thinking…' : 'Reading metrics…') : advice ? 'Regenerate' : 'Generate recommendations'}
        </button>
        {advice?.generatedAt && !running && (
          <span className="text-xs text-gray-400">last: {new Date(advice.generatedAt).toLocaleString('uk-UA')}{advice.model ? ` · ${advice.model}` : ''}</span>
        )}
        {dismissedCount > 0 && (
          <button onClick={() => setShowDismissed((v) => !v)} className="text-xs text-gray-400 underline">
            {showDismissed ? 'hide' : 'show'} dismissed ({dismissedCount})
          </button>
        )}
      </div>

      <HelpNote>
        The advisor reads this run’s metrics and proposes settings changes, each with a one-line rationale,
        the <b>evidence</b> it’s based on, and a <b>confidence</b> badge (<span className="font-mono">high</span> = trust it;
        <span className="font-mono"> low</span> = small sample, treat as a hint). <b>Config</b> tweaks pipeline numbers,
        <b> Voices</b> adjusts an ElevenLabs voice, <b>Prompts</b> edits an LLM instruction. <b>Apply</b> writes the change
        (takes effect next run); <b>Dismiss</b> hides it.
      </HelpNote>
      {isLive && (
        <p className="mb-2 text-xs text-gray-400">Live mode calls Claude with the run metrics + current config/prompts. Prompt edits are applied in the Prompts tab (live save is a later stage).</p>
      )}
      {error && <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">{error}</div>}

      {!advice && !running && !error && (
        <div className="rounded-lg border border-dashed border-gray-300 p-4 text-sm text-gray-400 dark:border-[#3a3a3d]">
          No recommendations yet. Generate to get evidence-backed config, voice, and prompt changes from this run’s metrics.
        </div>
      )}

      {advice && (
        <div className="space-y-4">
          {advice.summary && <p className="text-sm text-gray-600 dark:text-gray-300">{advice.summary}</p>}
          {total === 0 && <div className="text-sm text-gray-400">No actionable changes — metrics look on target.</div>}

          {cfg.length > 0 && (
            <RecGroup title="Configuration">
              {cfg.map((r) => {
                const id = `cfg:${r.key}`
                return (dismissed.has(id) === showDismissed) && (
                  <ConfigRecCard key={id} rec={r} writable={writable} reason={reason}
                    dismissed={dismissed.has(id)} onDismiss={() => dismiss(id)} onRestore={() => restore(id)} />
                )
              })}
            </RecGroup>
          )}
          {voice.length > 0 && (
            <RecGroup title="Voices">
              {voice.map((r) => {
                const id = `voice:${r.lang}:${r.field}`
                return (dismissed.has(id) === showDismissed) && (
                  <VoiceRecCard key={id} rec={r} writable={writable} reason={reason}
                    dismissed={dismissed.has(id)} onDismiss={() => dismiss(id)} onRestore={() => restore(id)} />
                )
              })}
            </RecGroup>
          )}
          {prompts.length > 0 && (
            <RecGroup title="Prompts">
              {prompts.map((r) => {
                const id = `prompt:${r.promptKey}`
                return (dismissed.has(id) === showDismissed) && (
                  <PromptRecCard key={id} rec={r} writable={writable} reason={reason} isLive={isLive}
                    dismissed={dismissed.has(id)} onDismiss={() => dismiss(id)} onRestore={() => restore(id)} />
                )
              })}
            </RecGroup>
          )}
        </div>
      )}
    </section>
  )
}

function RecGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">{title}</div>
      <div className="grid items-start gap-2 lg:grid-cols-2">{children}</div>
    </div>
  )
}

// ── shared card chrome ────────────────────────────────────────────────────────
function CardShell({ title, sub, confidence, dismissed, onDismiss, onRestore, children, footer }: {
  title: React.ReactNode; sub?: string; confidence: string
  dismissed: boolean; onDismiss: () => void; onRestore: () => void
  children: React.ReactNode; footer: React.ReactNode
}) {
  return (
    <div className={`rounded-lg border bg-white p-3 text-xs dark:bg-[#161617] ${dismissed ? 'border-gray-200 opacity-60 dark:border-[#29292c]' : 'border-gray-200 dark:border-[#29292c]'}`}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-gray-800 dark:text-gray-200">{title}</span>
            <span className={`rounded px-1.5 py-px text-[10px] font-medium ${recConfChip(confidence as never)}`}>{confidence}</span>
          </div>
          {sub && <div className="mt-0.5 font-mono text-[10px] text-gray-400">{sub}</div>}
        </div>
        {dismissed
          ? <button onClick={onRestore} title="restore" className="rounded border border-gray-300 px-1.5 py-px text-gray-500 hover:bg-gray-100 dark:border-[#3a3a3d] dark:hover:bg-[#202023]"><Undo2 className="h-3.5 w-3.5" strokeWidth={1.75} /></button>
          : <button onClick={onDismiss} title="dismiss" className="shrink-0 text-[11px] text-gray-400 hover:text-gray-600">dismiss</button>}
      </div>
      {children}
      <div className="mt-2 flex flex-wrap items-center gap-2">{footer}</div>
    </div>
  )
}

function Transition({ from, to }: { from: string; to: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-mono">
      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-500 line-through dark:bg-[#202023]">{from || '—'}</span>
      <ArrowRight className="h-3.5 w-3.5 text-gray-400" strokeWidth={1.75} />
      <span className="rounded bg-green-100 px-1.5 py-0.5 font-semibold text-green-800 dark:bg-green-900/40 dark:text-green-300">{to}</span>
    </span>
  )
}

function EvidenceLine({ evidence }: { evidence: Evidence[] }) {
  if (!evidence?.length) return null
  return (
    <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
      {evidence.map((e, i) => (
        <span key={i}>{i > 0 ? ' · ' : ''}{e.metric} {String(e.value)}{e.sampleSize != null ? ` (n=${e.sampleSize})` : ''}</span>
      ))}
    </div>
  )
}

// ── config recommendation ─────────────────────────────────────────────────────
function ConfigRecCard({ rec, writable, reason, dismissed, onDismiss, onRestore }: {
  rec: ConfigRecommendation; writable: boolean; reason: string
  dismissed: boolean; onDismiss: () => void; onRestore: () => void
}) {
  const qc = useQueryClient()
  const meta = CATALOG[rec.key]
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'err' | 'warn'; text: string } | null>(null)
  const [expected, setExpected] = useState(rec.current)

  async function apply() {
    setBusy(true); setMsg(null)
    try {
      const res = await fetch(`/api/config/${encodeURIComponent(rec.key)}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expected, value: rec.proposed }),
      })
      const d = await res.json().catch(() => ({}))
      if (res.ok && d.ok) {
        setDone(true)
        qc.invalidateQueries({ queryKey: ['config'] }); qc.invalidateQueries({ queryKey: ['tuning'] })
      } else if (res.status === 409) {
        // sheet drifted underneath — fetch the live value so the operator can re-check.
        const live = await fetch('/api/config').then((r) => r.json()).catch(() => null)
        const row = live?.rows?.find((x: { key: string; value: string }) => x.key === rec.key)
        if (row) setExpected(row.value)
        setMsg({ kind: 'warn', text: `Value changed to ${row?.value ?? '?'} — review and apply again` })
      } else setMsg({ kind: 'err', text: d.error || `error ${res.status}` })
    } catch (e) { setMsg({ kind: 'err', text: String(e) }) }
    finally { setBusy(false) }
  }

  return (
    <CardShell title={meta?.label ?? rec.key} sub={`${rec.key}${rec.lang ? ` · ${rec.lang}` : ''}`}
      confidence={rec.confidence} dismissed={dismissed} onDismiss={onDismiss} onRestore={onRestore}
      footer={
        done ? <span className="inline-flex items-center gap-1 text-green-700 dark:text-green-400"><Check className="h-3.5 w-3.5" strokeWidth={1.75} /> applied</span>
        : (
          <>
            <button onClick={apply} disabled={!writable || busy}
              className="rounded bg-gray-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-40 dark:bg-gray-100 dark:text-gray-900">
              {busy ? '…' : 'Apply'}
            </button>
            {!writable && <span className="text-[11px] text-amber-600">{reason}</span>}
            {msg && <span className={`text-[11px] ${msg.kind === 'err' ? 'text-red-700' : 'text-amber-600'}`}>{msg.text}</span>}
          </>
        )
      }>
      <div className="mt-1.5"><Transition from={expected} to={rec.proposed} /></div>
      <div className="mt-1 text-gray-700 dark:text-gray-300">{rec.rationale}</div>
      {rec.expectedEffect && <div className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">→ {rec.expectedEffect}</div>}
      <EvidenceLine evidence={rec.evidence} />
    </CardShell>
  )
}

// ── voice recommendation ──────────────────────────────────────────────────────
function VoiceRecCard({ rec, writable, reason, dismissed, onDismiss, onRestore }: {
  rec: VoiceRecommendation; writable: boolean; reason: string
  dismissed: boolean; onDismiss: () => void; onRestore: () => void
}) {
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  async function apply() {
    setBusy(true); setMsg(null)
    try {
      const res = await fetch(`/api/voices/${encodeURIComponent(rec.lang)}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { [rec.field]: rec.proposed } }),
      })
      const d = await res.json().catch(() => ({}))
      if (res.ok && d.ok) { setDone(true); qc.invalidateQueries({ queryKey: ['voices'] }); qc.invalidateQueries({ queryKey: ['tuning'] }) }
      else setMsg(d.error || `error ${res.status}`)
    } catch (e) { setMsg(String(e)) }
    finally { setBusy(false) }
  }

  return (
    <CardShell title={`Voice ${rec.lang} · ${rec.field}`} sub={`voices · ${rec.lang}`}
      confidence={rec.confidence} dismissed={dismissed} onDismiss={onDismiss} onRestore={onRestore}
      footer={
        done ? <span className="inline-flex items-center gap-1 text-green-700 dark:text-green-400"><Check className="h-3.5 w-3.5" strokeWidth={1.75} /> applied</span>
        : (
          <>
            <button onClick={apply} disabled={!writable || busy}
              className="rounded bg-gray-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-40 dark:bg-gray-100 dark:text-gray-900">
              {busy ? '…' : 'Apply'}
            </button>
            {!writable && <span className="text-[11px] text-amber-600">{reason}</span>}
            {msg && <span className="text-[11px] text-red-700">{msg}</span>}
          </>
        )
      }>
      <div className="mt-1.5"><Transition from={rec.current} to={rec.proposed} /></div>
      <div className="mt-1 text-gray-700 dark:text-gray-300">{rec.rationale}</div>
      <EvidenceLine evidence={rec.evidence} />
    </CardShell>
  )
}

// ── prompt recommendation ─────────────────────────────────────────────────────
function PromptRecCard({ rec, writable, reason, isLive, dismissed, onDismiss, onRestore }: {
  rec: PromptRecommendation; writable: boolean; reason: string; isLive: boolean
  dismissed: boolean; onDismiss: () => void; onRestore: () => void
}) {
  const qc = useQueryClient()
  const [current, setCurrent] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [copied, setCopied] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    getPromptDetail(rec.promptKey).then((d) => setCurrent(d.value)).catch(() => setCurrent(''))
  }, [rec.promptKey])

  // Resolve the proposed full text: rewrite uses it directly; patch applies find→replace.
  const proposed = useMemo(() => {
    const edit = rec.proposedEdit
    if (!edit) return null
    if (edit.mode === 'rewrite') return edit.rewrite ?? ''
    if (edit.mode === 'patch' && edit.patch && current != null) {
      return edit.patch.find ? current.replace(edit.patch.find, edit.patch.replace) : current + edit.patch.replace
    }
    return null
  }, [rec.proposedEdit, current])

  async function apply() {
    if (proposed == null) return
    setBusy(true); setMsg(null)
    try {
      const res = await fetch(`/api/prompts/${encodeURIComponent(rec.promptKey)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: proposed }),
      })
      const d = await res.json().catch(() => ({}))
      if (res.ok && d.ok) {
        setDone(true)
        qc.invalidateQueries({ queryKey: ['prompts'] }); qc.invalidateQueries({ queryKey: ['prompt', rec.promptKey] }); qc.invalidateQueries({ queryKey: ['tuning'] })
      } else if (res.status === 409) {
        setMsg('Live prompt save is a later stage — copy the text into the Prompts tab')
      } else setMsg(d.error || `error ${res.status}`)
    } catch (e) { setMsg(String(e)) }
    finally { setBusy(false) }
  }

  function copy() {
    if (proposed == null) return
    navigator.clipboard?.writeText(proposed).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })
  }

  return (
    <CardShell title={rec.promptKey} sub={rec.proposedEdit?.mode === 'patch' ? 'patch' : 'rewrite'}
      confidence={rec.confidence} dismissed={dismissed} onDismiss={onDismiss} onRestore={onRestore}
      footer={
        done ? <span className="inline-flex items-center gap-1 text-green-700 dark:text-green-400"><Check className="h-3.5 w-3.5" strokeWidth={1.75} /> applied</span>
        : (
          <>
            {!isLive && (
              <button onClick={apply} disabled={!writable || busy || proposed == null}
                className="rounded bg-gray-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-40 dark:bg-gray-100 dark:text-gray-900">
                {busy ? '…' : 'Apply'}
              </button>
            )}
            <button onClick={copy} disabled={proposed == null}
              className="inline-flex items-center gap-1 rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-100 disabled:opacity-40 dark:border-[#3a3a3d] dark:hover:bg-[#202023]">
              {copied ? <Check className="h-3.5 w-3.5" strokeWidth={1.75} /> : <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />} Copy
            </button>
            <Link to="/prompts" className="inline-flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-600">
              <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.75} /> Prompts tab
            </Link>
            {!writable && !isLive && <span className="text-[11px] text-amber-600">{reason}</span>}
            {msg && <span className="text-[11px] text-amber-600">{msg}</span>}
          </>
        )
      }>
      <div className="mt-1 text-gray-700 dark:text-gray-300">{rec.failurePattern}</div>
      <div className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">{rec.rationale}</div>
      <EvidenceLine evidence={rec.evidence} />
      {proposed != null && (
        <details className="mt-1.5" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
          <summary className="cursor-pointer text-[11px] text-gray-400">{open ? 'hide' : 'preview'} proposed text</summary>
          {current != null && current && (
            <div className="mt-1">
              <div className="text-[10px] uppercase tracking-wide text-gray-400">current</div>
              <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded bg-gray-50 p-2 font-mono text-[11px] text-gray-500 dark:bg-[#202023]">{current.slice(0, 600)}{current.length > 600 ? '…' : ''}</pre>
            </div>
          )}
          <div className="mt-1">
            <div className="text-[10px] uppercase tracking-wide text-green-600 dark:text-green-400">proposed</div>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-green-50 p-2 font-mono text-[11px] text-green-900 dark:bg-green-950/30 dark:text-green-200">{proposed.slice(0, 1200)}{proposed.length > 1200 ? '…' : ''}</pre>
          </div>
        </details>
      )}
    </CardShell>
  )
}
