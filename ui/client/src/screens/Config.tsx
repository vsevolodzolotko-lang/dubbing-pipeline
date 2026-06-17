import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchJson } from '../api/client'
import { useRunState } from '../api/useRunState'
import { canWrite, writeBlockReason } from '../ui'
import { CATALOG, DEAD_KEYS, GROUP_ORDER, type ConfigField } from '../configCatalog'

interface Row { key: string; value: string; masked: boolean }

export function Config() {
  const { state } = useRunState()
  const qc = useQueryClient()
  const writable = canWrite(state)
  const reason = writeBlockReason(state)
  const [showDead, setShowDead] = useState(false)

  const { data, isLoading } = useQuery({ queryKey: ['config'], queryFn: () => fetchJson<{ rows: Row[] }>('/api/config') })

  if (isLoading) return <div className="p-8 text-sm text-gray-400">Завантаження конфігурації…</div>
  const rows = data?.rows ?? []

  // bucket rows into groups
  const groups: Record<string, { row: Row; meta: ConfigField }[]> = {}
  for (const row of rows) {
    let meta = CATALOG[row.key]
    if (DEAD_KEYS.has(row.key)) meta = { group: 'Мертві ключі', label: row.key, type: 'readonly', tooltip: 'Застарілий ключ — код його не читає; можна видалити рядок вручну.' }
    if (!meta) meta = { group: 'Інше', label: row.key, type: row.masked ? 'secret' : 'readonly' }
    ;(groups[meta.group] ??= []).push({ row, meta })
  }
  const orderedGroups = [...GROUP_ORDER.filter((g) => groups[g]), ...Object.keys(groups).filter((g) => !GROUP_ORDER.includes(g))]

  return (
    <div className="p-6">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">Конфігурація</h1>
        {!writable && <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-700">лише перегляд — {reason}</span>}
      </div>
      <p className="mt-1 max-w-prose text-sm text-gray-500">
        Налаштування пайплайна без походу в таблицю. Секрети замасковані. Зміни впливають на <b>наступні</b> уроки.
      </p>

      <div className="mt-5 max-w-3xl space-y-6">
        {orderedGroups.map((g) => {
          if (g === 'Мертві ключі' && !showDead) {
            return (
              <button key={g} onClick={() => setShowDead(true)} className="text-xs text-gray-400 underline">
                показати мертві ключі ({groups[g].length})
              </button>
            )
          }
          return (
            <section key={g}>
              <h2 className={`mb-2 text-sm font-semibold ${g.startsWith('Секрети') || g.startsWith('Системне') || g === 'Мертві ключі' ? 'text-gray-500' : 'text-gray-800 dark:text-gray-200'}`}>{g}</h2>
              <div className="space-y-2">
                {groups[g].sort((a, b) => a.meta.label.localeCompare(b.meta.label)).map(({ row, meta }) => (
                  <Field key={row.key} k={row.key} meta={meta} value={row.value} masked={row.masked} writable={writable} reason={reason} onSaved={() => qc.invalidateQueries({ queryKey: ['config'] })} />
                ))}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}

function Field({ k, meta, value, masked, writable, reason, onSaved }: {
  k: string; meta: ConfigField; value: string; masked: boolean; writable: boolean; reason: string; onSaved: () => void
}) {
  const [val, setVal] = useState(value)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [check, setCheck] = useState<string | null>(null)
  const editable = Boolean(meta.editable) && meta.type !== 'secret' && meta.type !== 'readonly'
  const changed = val !== value

  async function save() {
    setBusy(true); setMsg(null)
    try {
      const res = await fetch(`/api/config/${encodeURIComponent(k)}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expected: value, value: val }),
      })
      const d = await res.json().catch(() => ({}))
      if (res.ok && d.ok) { setMsg({ kind: 'ok', text: '✓ збережено' }); onSaved() }
      else setMsg({ kind: 'err', text: d.error || `помилка ${res.status}` })
    } catch (e) { setMsg({ kind: 'err', text: String(e) }) } finally { setBusy(false) }
  }

  async function runCheck() {
    setCheck('…')
    try {
      const res = await fetch(`/api/config/check/${encodeURIComponent(k)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const d = await res.json().catch(() => ({}))
      setCheck(d.ok ? '✓ ключ робочий' : `✗ ${d.reason || d.status || 'не валідний'}`)
    } catch (e) { setCheck(`✗ ${e}`) }
  }

  return (
    <div className="rounded-lg border border-gray-200 dark:border-[#332b22] bg-white dark:bg-[#1c1814] px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{meta.label}</span>
            <span className="font-mono text-[11px] text-gray-400">{k}</span>
          </div>
          {meta.tooltip && <div className="mt-0.5 text-xs text-gray-500">{meta.tooltip}</div>}
        </div>

        {/* value / editor */}
        {editable ? (
          <div className="flex items-center gap-2">
            {meta.type === 'number' || meta.type === 'ratio' ? (
              <input type="number" value={val} min={meta.min} max={meta.max} step={meta.step}
                onChange={(e) => setVal(e.target.value)} disabled={!writable}
                className="w-28 rounded border border-gray-300 dark:border-[#473d31] px-2 py-1 text-sm disabled:bg-gray-100 dark:disabled:bg-[#262019]" />
            ) : (
              <input type="text" value={val} onChange={(e) => setVal(e.target.value)} disabled={!writable}
                className="w-56 rounded border border-gray-300 dark:border-[#473d31] px-2 py-1 text-sm disabled:bg-gray-100 dark:disabled:bg-[#262019]" />
            )}
            {changed && writable && (
              <button onClick={save} disabled={busy} className="rounded bg-gray-900 px-2 py-1 text-xs text-white hover:bg-gray-700 disabled:opacity-50">
                {busy ? '…' : 'Зберегти'}
              </button>
            )}
          </div>
        ) : meta.type === 'secret' ? (
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-gray-400">{masked ? '••••••••' : value || '—'}</span>
            {meta.testable && <button onClick={runCheck} className="rounded border border-gray-300 dark:border-[#473d31] px-2 py-1 text-xs hover:bg-gray-100">Перевірити</button>}
          </div>
        ) : (
          <span className="max-w-[16rem] truncate font-mono text-sm text-gray-500" title={value}>{value || '—'}</span>
        )}
      </div>

      {!writable && editable && val !== value && <div className="mt-1 text-[11px] text-amber-600">{reason}</div>}
      {msg && <div className={`mt-1 text-xs ${msg.kind === 'ok' ? 'text-green-700' : 'text-red-700'}`}>{msg.text}</div>}
      {check && <div className={`mt-1 text-xs ${check.startsWith('✓') ? 'text-green-700' : 'text-gray-500'}`}>{check}</div>}
    </div>
  )
}
