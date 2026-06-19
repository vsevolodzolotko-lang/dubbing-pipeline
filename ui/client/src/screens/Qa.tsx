import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Check, ChevronDown, ChevronRight, Copy, ShoppingBasket } from 'lucide-react'
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
type Severity = 'high' | 'medium' | 'low'
const SEV_ORDER: Severity[] = ['high', 'medium', 'low']
const SEV_LABEL: Record<Severity, string> = { high: 'висока', medium: 'середня', low: 'низька' }
const SEV_DOT: Record<Severity, string> = { high: 'bg-red-500', medium: 'bg-amber-500', low: 'bg-gray-400' }
const SEV_BORDER: Record<string, string> = {
  high: 'border-red-400 dark:border-red-600', medium: 'border-amber-400 dark:border-amber-600', low: 'border-gray-300 dark:border-[#3a3a3d]',
}
const SEV_CHIP: Record<string, string> = {
  high: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  medium: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  low: 'bg-gray-100 text-gray-600 dark:bg-[#202023] dark:text-gray-300',
}

export function Qa() {
  const { state } = useRunState()
  const [report, setReport] = useState<Report | null>(null)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [model, setModel] = useState(MODELS[0].id)
  const [langFilter, setLangFilter] = useState<string | null>(null)
  const [sevFilter, setSevFilter] = useState<Severity | null>(null)

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

  const all = useMemo(() => report?.findings ?? [], [report])
  const byLangAll = useMemo(() => groupByLang(all), [all])
  const langs = Object.keys(byLangAll)
  const sevCounts = useMemo(() => ({
    high: all.filter((f) => f.severity === 'high').length,
    medium: all.filter((f) => f.severity === 'medium').length,
    low: all.filter((f) => f.severity === 'low').length,
  }), [all])
  const visible = useMemo(() => all.filter((f) =>
    (!langFilter || f.lang === langFilter) && (!sevFilter || f.severity === sevFilter)), [all, langFilter, sevFilter])
  const byLangVisible = useMemo(() => groupByLang(visible), [visible])
  const shownLangs = Object.keys(byLangVisible)

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">AI-аналіз якості</h1>
        <select value={model} onChange={(e) => setModel(e.target.value)} disabled={running}
          className="rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-[#3a3a3d] dark:bg-[#161617]">
          {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
        <button onClick={run} disabled={running}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white">
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
        <div className="mt-4 rounded-lg bg-gray-50 px-3 py-2 text-sm dark:bg-[#202023]">
          Опрацьовано мов: <b>{progress.done}/{progress.total}</b> · остання: <b>{progress.lang}</b> (знайдено {progress.found})
          <div className="mt-1 h-1.5 w-full rounded bg-gray-200 dark:bg-[#3a3a3d]">
            <div className="h-1.5 rounded bg-blue-500" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
          </div>
        </div>
      )}

      {error && <div className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">{error}</div>}

      {report && !running && (
        report.total === 0 ? (
          <div className="mt-5 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800 dark:border-green-900 dark:bg-green-950/50 dark:text-green-300">
            Проблем не знайдено{report.lessonId ? ` для ${report.lessonId}` : ''}.
          </div>
        ) : (
          <div className="mt-5">
            {/* filters: importance (severity) + language */}
            <div className="mb-3 space-y-1.5 text-xs">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="w-20 shrink-0 text-gray-400">Важливість</span>
                <Chip active={sevFilter === null} onClick={() => setSevFilter(null)}>усі {report.total}</Chip>
                {SEV_ORDER.map((s) => (
                  <Chip key={s} active={sevFilter === s} onClick={() => setSevFilter(sevFilter === s ? null : s)}>
                    <span className={`mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle ${SEV_DOT[s]}`} />{SEV_LABEL[s]} {sevCounts[s]}
                  </Chip>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="w-20 shrink-0 text-gray-400">Мова</span>
                <Chip active={langFilter === null} onClick={() => setLangFilter(null)}>усі</Chip>
                {langs.map((l) => (
                  <Chip key={l} active={langFilter === l} onClick={() => setLangFilter(langFilter === l ? null : l)}>{l} {byLangAll[l].length}</Chip>
                ))}
              </div>
            </div>
            {visible.length === 0 ? (
              <div className="text-sm text-gray-400">Немає зауваг за обраним фільтром.</div>
            ) : (
              <div className="space-y-4">
                {shownLangs.map((lang) => (
                  <div key={lang}>
                    <div className="mb-1.5 font-mono text-sm font-semibold text-gray-700 dark:text-gray-300">{lang} · {byLangVisible[lang].length}</div>
                    <div className="grid gap-1.5 md:grid-cols-2 xl:grid-cols-3">
                      {byLangVisible[lang].map((f, i) => <FindingCard key={i} f={f} />)}
                    </div>
                  </div>
                ))}
              </div>
            )}
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
        : 'border-gray-300 text-gray-600 hover:bg-gray-50 dark:border-[#3a3a3d] dark:text-gray-300 dark:hover:bg-[#202023]'}`}>
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
    <div className={`appear rounded-md border-l-2 border border-gray-200 ${SEV_BORDER[f.severity]} bg-white p-1.5 text-xs dark:border-[#29292c] dark:bg-[#161617]`}>
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-gray-400">{shortId(f.segmentId)}</span>
        <span className="text-gray-600 dark:text-gray-300">{TYPE_LABEL[f.type] ?? f.type}</span>
        <span className={`rounded px-1 py-px text-[10px] font-medium ${SEV_CHIP[f.severity]}`}>{f.severity}</span>
        {f.suggestion && (
          <div className="ml-auto flex gap-1">
            <button onClick={toCart} disabled={!writable} title={writable ? 'у кошик' : 'увімкни запис'}
              className="flex items-center rounded border border-gray-300 px-1.5 py-px hover:bg-gray-100 disabled:opacity-40 dark:border-[#3a3a3d] dark:hover:bg-[#202023]"><ShoppingBasket className="h-4 w-4" strokeWidth={1.75} />{inCart && <Check className="h-4 w-4" strokeWidth={1.75} />}</button>
            <button onClick={copy} className="rounded border border-gray-300 px-1.5 py-px hover:bg-gray-100 dark:border-[#3a3a3d] dark:hover:bg-[#202023]">{copied ? <Check className="h-4 w-4" strokeWidth={1.75} /> : <Copy className="h-4 w-4" strokeWidth={1.75} />}</button>
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
            <Row label={<ArrowRight className="inline-block h-3.5 w-3.5 align-[-0.2em]" strokeWidth={1.75} />} v={f.suggestion} cls="text-green-700 dark:text-green-400" />
          </div>
        </details>
      )}
    </div>
  )
}

function Row({ label, v, cls }: { label: React.ReactNode; v: string; cls: string }) {
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
    try { await saveTranslationPrompt(value); setStatus('Збережено') }
    catch (e) { setStatus(e instanceof Error ? e.message : 'помилка') }
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white dark:border-[#29292c] dark:bg-[#161617]">
      <button onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-[#202023]">
        <span>{open ? <ChevronDown className="h-4 w-4" strokeWidth={1.75} /> : <ChevronRight className="h-4 w-4" strokeWidth={1.75} />}</span>
        <span className="font-medium">Промпт, яким AI перевіряє переклади</span>
        <span className="ml-auto text-xs text-gray-400">{open ? '' : 'розгорнути'}</span>
      </button>
      {open && (
        <div className="border-t border-gray-100 p-3 dark:border-[#29292c]">
          {!loaded ? <div className="text-xs text-gray-400">Завантаження…</div> : (
            <>
              <textarea
                value={value} disabled={!editable} rows={10}
                onChange={(e) => { setValue(e.target.value); setStatus(null) }}
                className="w-full resize-y rounded border border-gray-200 px-2 py-1.5 font-mono text-xs disabled:bg-gray-50 dark:border-[#3a3a3d] dark:bg-[#161617] dark:disabled:bg-[#202023]"
              />
              <div className="mt-2 flex items-center gap-2">
                <button onClick={save} disabled={!editable}
                  className="rounded bg-gray-900 px-3 py-1.5 text-sm text-white hover:bg-gray-700 disabled:bg-gray-300 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white">
                  Зберегти промпт
                </button>
                <button onClick={() => { setValue(def); setStatus(null) }} disabled={!editable}
                  className="rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50 dark:border-[#3a3a3d] dark:hover:bg-[#202023]">
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
