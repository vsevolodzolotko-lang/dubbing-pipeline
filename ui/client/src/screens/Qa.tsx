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
  langs?: string[]
  findings: Finding[]
  total: number
}
interface Progress { lang: string; done: number; total: number; found: number }

const TYPE_LABEL: Record<string, string> = {
  formality: '🫵 Звертання (ти/ви)',
  gender: '⚥ Гендер',
  false_friend: '⚠️ False friend / зміст',
  naturalness: '🌊 Природність',
}
const SEV_CLASS: Record<string, string> = {
  high: 'bg-red-100 text-red-800',
  medium: 'bg-amber-100 text-amber-800',
  low: 'bg-gray-100 text-gray-600',
}

export function Qa() {
  const { state } = useRunState()
  const [report, setReport] = useState<Report | null>(null)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/qa/report').then((r) => r.json()).then((d) => { if (d && d.generatedAt) setReport(d) }).catch(() => {})
  }, [])

  async function run() {
    setRunning(true); setError(null); setProgress(null)
    try {
      const res = await fetch('/api/qa/run', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
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

  return (
    <div className="p-6">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">AI-аналіз якості</h1>
        <button
          onClick={run}
          disabled={running}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {running ? 'Аналізую…' : report ? 'Проаналізувати знову' : 'Запустити аналіз'}
        </button>
        {report?.generatedAt && !running && (
          <span className="text-xs text-gray-400">останній: {new Date(report.generatedAt).toLocaleString('uk-UA')}</span>
        )}
      </div>
      <p className="mt-1 max-w-prose text-sm text-gray-500">
        Глибока LLM-перевірка перекладів (Gemini) за промптом нижче: звертання на «ти», консистентність
        гендеру, false friends / зміст, природність проти оригіналу. Окрема від швидкого детермінованого
        gate на сторінці «Переклад» (довжина + формальність).
      </p>

      <div className="mt-4 max-w-prose"><PromptPanel /></div>

      {running && progress && (
        <div className="mt-4 rounded-lg bg-gray-50 px-3 py-2 text-sm">
          Опрацьовано мов: <b>{progress.done}/{progress.total}</b> · остання: <b>{progress.lang}</b>
          {' '}(знайдено {progress.found})
          <div className="mt-1 h-1.5 w-full rounded bg-gray-200">
            <div className="h-1.5 rounded bg-blue-500" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
          </div>
        </div>
      )}

      {error && <div className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {report && !running && (
        <div className="mt-5">
          {report.total === 0 ? (
            <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
              🎉 Проблем не знайдено{report.lessonId ? ` для ${report.lessonId}` : ''}.
            </div>
          ) : (
            <>
              <div className="mb-3 text-sm text-gray-600">Знайдено <b>{report.total}</b> зауважень у {langs.length} мовах</div>
              <div className="space-y-6">
                {langs.map((lang) => (
                  <div key={lang}>
                    <div className="mb-2 font-mono text-sm font-semibold text-gray-700">{lang} · {byLang[lang].length}</div>
                    <div className="space-y-2">
                      {byLang[lang].map((f, i) => <FindingCard key={i} f={f} />)}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {!report && !running && !error && (
        <div className="mt-6 text-sm text-gray-400">
          Ще не аналізовано. Натисни «Запустити аналіз»
          {state?.mode === 'mock' ? ' (у MOCK-режимі потрібен живий gemini_api_key).' : '.'}
        </div>
      )}
    </div>
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
    cart.add({
      rowKey: f.rowKey, segmentId: f.segmentId, lang: f.lang,
      oldText: f.current, newText: f.suggestion || f.current,
      comment: `AI: ${(TYPE_LABEL[f.type] ?? f.type).replace(/^\S+\s/, '')}`,
    })
  }
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="mb-1 flex items-center gap-2">
        <span className="font-mono text-xs text-gray-400">{shortId(f.segmentId)}</span>
        <span className="text-xs text-gray-600">{TYPE_LABEL[f.type] ?? f.type}</span>
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${SEV_CLASS[f.severity]}`}>{f.severity}</span>
      </div>
      <div className="text-sm text-gray-800">{f.issue}</div>
      <div className="mt-2 grid gap-1 text-xs">
        <Row label="EN" v={f.enText} cls="text-gray-500" />
        <Row label="Зараз" v={f.current} cls="text-gray-700" />
        <Row label="Пропозиція" v={f.suggestion} cls="text-green-800" />
      </div>
      {f.suggestion && (
        <div className="mt-2 flex gap-2">
          <button
            onClick={toCart}
            disabled={!writable}
            title={writable ? 'Додати правку в кошик перегенерації' : 'увімкни запис, щоб надсилати на реген'}
            className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-100 disabled:opacity-40"
          >🧺 {inCart ? 'У кошику' : 'У кошик'}</button>
          <button onClick={copy} className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-100">
            {copied ? '✓ Скопійовано' : 'Копіювати'}
          </button>
        </div>
      )}
    </div>
  )
}

function Row({ label, v, cls }: { label: string; v: string; cls: string }) {
  if (!v) return null
  return (
    <div className="flex gap-2">
      <span className="w-20 shrink-0 text-gray-400">{label}</span>
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
    <div className="rounded-lg border border-gray-200 bg-white">
      <button onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
        <span>{open ? '▾' : '▸'}</span>
        <span className="font-medium">⚙️ Промпт, яким AI перевіряє переклади</span>
        <span className="ml-auto text-xs text-gray-400">{open ? '' : 'розгорнути'}</span>
      </button>
      {open && (
        <div className="border-t border-gray-100 p-3">
          {!loaded ? <div className="text-xs text-gray-400">Завантаження…</div> : (
            <>
              <textarea
                value={value} disabled={!editable} rows={10}
                onChange={(e) => { setValue(e.target.value); setStatus(null) }}
                className="w-full resize-y rounded border border-gray-200 px-2 py-1.5 font-mono text-xs disabled:bg-gray-50"
              />
              <div className="mt-2 flex items-center gap-2">
                <button onClick={save} disabled={!editable}
                  className="rounded bg-gray-900 px-3 py-1.5 text-sm text-white hover:bg-gray-700 disabled:bg-gray-300">
                  Зберегти промпт
                </button>
                <button onClick={() => { setValue(def); setStatus(null) }} disabled={!editable}
                  className="rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50">
                  Скинути до типового
                </button>
                {status && <span className="text-xs text-gray-500">{status}</span>}
              </div>
              <p className="mt-2 text-xs text-gray-400">
                Плейсхолдер <code>{'{{lang}}'}</code> підставляється для кожної мови. Цей промпт використовує
                кнопка «Запустити аналіз» вище (потрібен живий <code>gemini_api_key</code> — у mock LLM не викликається).
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
