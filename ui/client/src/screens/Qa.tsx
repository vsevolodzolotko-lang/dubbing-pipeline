import { useEffect, useMemo, useState } from 'react'
import { useRunState } from '../api/useRunState'
import { useCart } from '../api/cart'
import { canWrite } from '../ui'
import { getTranslationPrompt, saveTranslationPrompt } from '../api/staged'

interface Finding {
  lang: string
  segmentId: string
  rowKey: string
  type: 'formality' | 'gender' | 'false_friend' | 'naturalness'
  severity: 'high' | 'medium' | 'low'
  issue: string
  suggestion: string
  enText: string
  current: string
}
interface Report {
  generatedAt: string | null
  lessonId?: string | null
  model?: string
  langs?: string[]
  findings: Finding[]
  total: number
}
interface Progress { lang: string; done: number; total: number; found: number }

const MODELS = [
  { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash · швидко' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 · точніше' },
  { id: 'gpt-5', label: 'GPT-5' },
]
const TYPE_LABEL: Record<string, string> = {
  formality: 'ти/ви', gender: 'гендер', false_friend: 'хибний друг', naturalness: 'природність',
}
const SEV_BORDER: Record<string, string> = {
  high: 'border-rust-600 dark:border-rust-600', medium: 'border-ochre-700 dark:border-ochre-700', low: 'border-sage-600 dark:border-sage-600',
}
const SEV_CHIP: Record<string, string> = {
  high: 'bg-rust-100 text-rust-700 dark:bg-rust-900/40 dark:text-rust-200',
  medium: 'bg-ochre-100 text-ochre-700 dark:bg-ochre-900/40 dark:text-ochre-200',
  low: 'bg-sage-100 text-sage-700 dark:bg-sage-900/40 dark:text-sage-200',
}

export function Qa() {
  const { state } = useRunState()
  const [report, setReport] = useState<Report | null>(null)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [model, setModel] = useState(MODELS[0].id)
  const [langFilter, setLangFilter] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/qa/report').then((r) => r.json()).then((d) => { if (d && d.generatedAt) setReport(d) }).catch(() => {})
  }, [])

  async function run() {
    setRunning(true); setError(null); setProgress(null)
    try {
      const res = await fetch('/api/qa/run', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model }),
      })
      if (res.status === 409) { setError('Аналіз уже виконується'); setRunning(false); return }
      const reader = res.body!.getReader()
      const dec = new TextDecoder()
      let buf = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        let i
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1)
          if (!line) continue
          const msg = JSON.parse(line)
          if (msg.type === 'progress') setProgress({ lang: msg.lang, done: msg.done, total: msg.total, found: msg.found })
          else if (msg.type === 'done') setReport(msg.report)
          else if (msg.type === 'error') setError(msg.message)
        }
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setRunning(false)
    }
  }

  const byLang = useMemo(() => groupByLang(report?.findings ?? []), [report])
  const langs = Object.keys(byLang)
  const shown = langFilter ? langs.filter((l) => l === langFilter) : langs

  return (
    <div className="p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">AI-аналіз якості</h1>
        <select value={model} onChange={(e) => setModel(e.target.value)} disabled={running}
          className="rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-[#473d31] dark:bg-[#1c1814]">
          {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
        <button onClick={run} disabled={running}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50">
          {running ? 'Аналізую…' : report ? 'Проаналізувати знову' : 'Запустити аналіз'}
        </button>
        {report?.generatedAt && !running && (
          <span className="text-xs text-gray-400">останній: {new Date(report.generatedAt).toLocaleString('uk-UA')}{report.model ? ` · ${report.model}` : ''}</span>
        )}
      </div>
      <p className="mt-1 max-w-prose text-sm text-gray-500 dark:text-gray-400">
        Глибока LLM-перевірка перекладів за промптом нижче: ти/ви, гендер, false friends / зміст, природність.
        Окрема від швидкого детермінованого gate на сторінці «Переклад».
      </p>

      <div className="mt-4 max-w-prose"><PromptPanel /></div>

      {running && progress && (
        <div className="mt-4 rounded-lg bg-gray-50 px-3 py-2 text-sm dark:bg-[#262019]">
          Опрацьовано мов: <b>{progress.done}/{progress.total}</b> · остання: <b>{progress.lang}</b> (знайдено {progress.found})
          <div className="mt-1 h-1.5 w-full rounded bg-gray-200 dark:bg-[#473d31]">
            <div className="h-1.5 rounded bg-blue-500" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
          </div>
        </div>
      )}

      {error && <div className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">{error}</div>}

      {report && !running && (
        report.total === 0 ? (
          <div className="mt-5 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800 dark:border-green-900 dark:bg-green-950/50 dark:text-green-300">
            🎉 Проблем не знайдено{report.lessonId ? ` для ${report.lessonId}` : ''}.
          </div>
        ) : (
          <div className="mt-5">
            {/* language filter chips */}
            <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-gray-400">{report.total} зауваг ·</span>
              <Chip active={langFilter === null} onClick={() => setLangFilter(null)}>усі</Chip>
              {langs.map((l) => (
                <Chip key={l} active={langFilter === l} onClick={() => setLangFilter(l)}>{l} {byLang[l].length}</Chip>
              ))}
            </div>
            <div className="space-y-4">
              {shown.map((lang) => (
                <div key={lang}>
                  <div className="mb-1.5 font-mono text-sm font-semibold text-gray-700 dark:text-gray-300">{lang} · {byLang[lang].length}</div>
                  <div className="grid gap-1.5 md:grid-cols-2 xl:grid-cols-3">
                    {byLang[lang].map((f, i) => <FindingCard key={i} f={f} />)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      )}

      {!report && !running && !error && (
        <div className="mt-6 text-sm text-gray-400">
          Ще не аналізовано. Натисни «Запустити аналіз»{state?.mode === 'mock' ? ' (у MOCK-режимі потрібен живий gemini_api_key).' : '.'}
        </div>
      )}
    </div>
  )
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`rounded-full border px-2 py-0.5 ${active
        ? 'border-gray-900 bg-gray-900 text-white dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900'
        : 'border-gray-300 text-gray-600 hover:bg-gray-50 dark:border-[#473d31] dark:text-gray-300 dark:hover:bg-[#262019]'}`}>
      {children}
    </button>
  )
}

function FindingCard({ f }: { f: Finding }) {
  const [copied, setCopied] = useState(false)
  const cart = useCart()
  const { state } = useRunState()
  const writable = canWrite(state)
  const inCart = cart.has(f.rowKey)
  function copy() {
    navigator.clipboard?.writeText(f.suggestion).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })
  }
  function toCart() {
    cart.add({ rowKey: f.rowKey, segmentId: f.segmentId, lang: f.lang, oldText: f.current, newText: f.suggestion || f.current, comment: `AI: ${TYPE_LABEL[f.type] ?? f.type}` })
  }
  return (
    <div className={`appear rounded-md border-l-2 border border-gray-200 ${SEV_BORDER[f.severity]} bg-paper-raised p-1.5 text-xs dark:border-[#332b22] dark:bg-[#1c1814]`}>
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-gray-400">{shortId(f.segmentId)}</span>
        <span className="text-gray-600 dark:text-gray-300">{TYPE_LABEL[f.type] ?? f.type}</span>
        <span className={`rounded px-1 py-px text-[10px] font-medium ${SEV_CHIP[f.severity]}`}>{f.severity}</span>
        {f.suggestion && (
          <div className="ml-auto flex gap-1">
            <button onClick={toCart} disabled={!writable} title={writable ? 'у кошик' : 'увімкни запис'}
              className="rounded border border-gray-300 px-1.5 py-px hover:bg-gray-100 disabled:opacity-40 dark:border-[#473d31] dark:hover:bg-[#262019]">🧺{inCart ? '✓' : ''}</button>
            <button onClick={copy} className="rounded border border-gray-300 px-1.5 py-px hover:bg-gray-100 dark:border-[#473d31] dark:hover:bg-[#262019]">{copied ? '✓' : '⧉'}</button>
          </div>
        )}
      </div>
      <div className="mt-1 text-gray-800 dark:text-gray-200">{f.issue}</div>
      {(f.current || f.suggestion) && (
        <details className="mt-1">
          <summary className="cursor-pointer text-[11px] text-gray-400">текст</summary>
          <div className="mt-1 space-y-0.5">
            <Row label="EN" v={f.enText} cls="text-gray-500 dark:text-gray-400" />
            <Row label="зараз" v={f.current} cls="text-gray-700 dark:text-gray-300" />
            <Row label="→" v={f.suggestion} cls="text-green-700 dark:text-green-400" />
          </div>
        </details>
      )}
    </div>
  )
}

function Row({ label, v, cls }: { label: string; v: string; cls: string }) {
  if (!v) return null
  return (
    <div className="flex gap-2">
      <span className="w-10 shrink-0 text-gray-400">{label}</span>
      <span className={cls}>{v}</span>
    </div>
  )
}

// Operator-editable prompt that drives this LLM check. `{{lang}}` is substituted
// per language. Saved to the mock store now; prompts tab at Etap P.
function PromptPanel() {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [def, setDef] = useState('')
  const [editable, setEditable] = useState(true)
  const [status, setStatus] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    getTranslationPrompt().then((r) => {
      setValue(r.value); setDef(r.default); setEditable(r.editable); setLoaded(true)
    }).catch(() => setLoaded(true))
  }, [])

  async function save() {
    setStatus('Зберігаю…')
    try { await saveTranslationPrompt(value); setStatus('✓ Збережено') }
    catch (e) { setStatus(e instanceof Error ? e.message : 'помилка') }
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white dark:border-[#332b22] dark:bg-[#1c1814]">
      <button onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-[#262019]">
        <span>{open ? '▾' : '▸'}</span>
        <span className="font-medium">⚙️ Промпт, яким AI перевіряє переклади</span>
        <span className="ml-auto text-xs text-gray-400">{open ? '' : 'розгорнути'}</span>
      </button>
      {open && (
        <div className="border-t border-gray-100 p-3 dark:border-[#332b22]">
          {!loaded ? <div className="text-xs text-gray-400">Завантаження…</div> : (
            <>
              <textarea
                value={value} disabled={!editable} rows={10}
                onChange={(e) => { setValue(e.target.value); setStatus(null) }}
                className="w-full resize-y rounded border border-gray-200 px-2 py-1.5 font-mono text-xs disabled:bg-gray-50 dark:border-[#473d31] dark:bg-[#1c1814] dark:disabled:bg-[#262019]"
              />
              <div className="mt-2 flex items-center gap-2">
                <button onClick={save} disabled={!editable}
                  className="rounded bg-gray-900 px-3 py-1.5 text-sm text-white hover:bg-gray-700 disabled:bg-gray-300 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white">
                  Зберегти промпт
                </button>
                <button onClick={() => { setValue(def); setStatus(null) }} disabled={!editable}
                  className="rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50 dark:border-[#473d31] dark:hover:bg-[#262019]">
                  Скинути до типового
                </button>
                {status && <span className="text-xs text-gray-500">{status}</span>}
              </div>
              <p className="mt-2 text-xs text-gray-400">
                Плейсхолдер <code>{'{{lang}}'}</code> підставляється для кожної мови. Цей промпт використовує
                кнопка «Запустити аналіз» вище (потрібен живий ключ моделі — у mock LLM не викликається).
                {!editable && ' Збереження в live — на Етапі P (prompts-таб).'}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function groupByLang(findings: Finding[]): Record<string, Finding[]> {
  const out: Record<string, Finding[]> = {}
  for (const f of findings) (out[f.lang] ??= []).push(f)
  return out
}
function shortId(segmentId: string) {
  const m = segmentId.match(/_seg_(\d+)$/)
  return m ? `seg_${m[1]}` : segmentId
}
