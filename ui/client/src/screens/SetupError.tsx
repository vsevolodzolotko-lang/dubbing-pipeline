import { ArrowRight, Check, Minus, X } from 'lucide-react'
import { useSetupStatus } from '../api/queries'

export function SetupErrorScreen() {
  const { data, isLoading } = useSetupStatus()
  if (isLoading) return <div className="p-8 text-sm text-gray-400">Перевірка налаштувань…</div>
  if (!data) return <div className="p-8 text-sm text-red-600">Не вдалося перевірити налаштування.</div>

  return (
    <div className="mx-auto max-w-2xl p-8">
      <h1 className="text-xl font-semibold">Налаштування доступу</h1>
      <p className="mt-1 text-sm text-gray-500">
        {data.mock
          ? 'Працюємо у MOCK-режимі на тестових даних. Підключи живу таблицю, коли будеш готовий.'
          : data.ok
          ? 'Усе підключено.'
          : 'Знайдено проблеми — виправ їх, щоб підключити живу таблицю.'}
      </p>
      {data.serviceAccountEmail && (
        <div className="mt-3 rounded bg-gray-100 p-2 dark:bg-[#202023] text-sm">
          Service account: <code className="select-all">{data.serviceAccountEmail}</code>
        </div>
      )}
      <ul className="mt-4 space-y-2">
        {data.checks.map((c) => (
          <li key={c.id} className="rounded-lg border border-gray-200 dark:border-[#29292c] bg-white dark:bg-[#161617] p-3">
            <div className="flex items-center gap-2">
              <span>
                {c.status === 'pass' ? (
                  <Check className="h-4 w-4 text-green-600" strokeWidth={1.75} />
                ) : c.status === 'fail' ? (
                  <X className="h-4 w-4 text-red-600" strokeWidth={1.75} />
                ) : (
                  <Minus className="h-4 w-4 text-gray-400" strokeWidth={1.75} />
                )}
              </span>
              <span className="font-medium">{c.label}</span>
              <span className="text-sm text-gray-500">— {c.detail}</span>
            </div>
            {c.remediation && (
              <div className="mt-1 pl-6 text-sm text-amber-700">
                <ArrowRight className="inline-block h-3.5 w-3.5 align-[-0.2em]" strokeWidth={1.75} /> {c.remediation}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
