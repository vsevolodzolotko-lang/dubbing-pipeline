// Dependency-free, dark-mode-aware chart primitives for the Tuning tab. The repo
// ships no chart library; these use plain CSS bars + inline SVG, sized with
// viewBox so they scale. Colors come from Tailwind text-* via currentColor.

export function BarRow({ label, value, max, suffix, tone = 'text-blue-500', sub }: {
  label: React.ReactNode; value: number; max: number; suffix?: string; tone?: string; sub?: string
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-16 shrink-0 text-right text-gray-500 dark:text-gray-400">{label}</span>
      <div className="relative h-3 flex-1 overflow-hidden rounded bg-gray-100 dark:bg-[#202023]">
        <div className={`h-full rounded ${tone.replace('text-', 'bg-')}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-20 shrink-0 font-mono text-gray-600 dark:text-gray-300">
        {value}{suffix}{sub ? <span className="text-gray-400"> {sub}</span> : null}
      </span>
    </div>
  )
}

// A horizontal stacked bar from labeled segments (e.g. phase2 outcomes, speed buckets).
export function StackBar({ segments }: { segments: { label: string; count: number; cls: string }[] }) {
  const total = segments.reduce((a, s) => a + s.count, 0) || 1
  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded bg-gray-100 dark:bg-[#202023]">
        {segments.filter((s) => s.count > 0).map((s, i) => (
          <div key={i} className={s.cls} style={{ width: `${(s.count / total) * 100}%` }} title={`${s.label}: ${s.count}`} />
        ))}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-gray-500 dark:text-gray-400">
        {segments.filter((s) => s.count > 0).map((s, i) => (
          <span key={i} className="inline-flex items-center gap-1">
            <span className={`inline-block h-2 w-2 rounded-sm ${s.cls}`} />{s.label} {s.count}
          </span>
        ))}
      </div>
    </div>
  )
}

// Inline SVG line for run-over-run trends. points = [{x:number, y:number|null}].
export function TrendLine({ values, height = 44, tone = 'text-blue-500' }: {
  values: (number | null)[]; height?: number; tone?: string
}) {
  const W = 240, H = height, pad = 4
  const nums = values.filter((v): v is number => v != null)
  if (nums.length === 0) return <div className="text-xs text-gray-400">no data</div>
  const min = Math.min(...nums), max = Math.max(...nums)
  const span = max - min || 1
  const n = values.length
  const x = (i: number) => pad + (n <= 1 ? (W - 2 * pad) / 2 : (i / (n - 1)) * (W - 2 * pad))
  const y = (v: number) => H - pad - ((v - min) / span) * (H - 2 * pad)
  const pts = values.map((v, i) => (v == null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`)).filter(Boolean).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={`w-full ${tone}`} preserveAspectRatio="none" style={{ maxWidth: W }}>
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      {values.map((v, i) => (v == null ? null : (
        <circle key={i} cx={x(i)} cy={y(v)} r="2" fill="currentColor" />
      )))}
    </svg>
  )
}

// Tiny inline sparkline (for scorecard headers).
export function Sparkline({ values, tone = 'text-gray-400' }: { values: number[]; tone?: string }) {
  if (!values.length) return null
  const W = 56, H = 16
  const min = Math.min(...values), max = Math.max(...values)
  const span = max - min || 1
  const pts = values.map((v, i) => `${(values.length <= 1 ? W / 2 : (i / (values.length - 1)) * W).toFixed(1)},${(H - ((v - min) / span) * H).toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={`${tone}`} width={W} height={H} preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
    </svg>
  )
}
