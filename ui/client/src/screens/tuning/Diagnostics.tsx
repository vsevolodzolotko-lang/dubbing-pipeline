import type { RunQualityReport, LangQuality } from '../../api/types'
import { BarRow, StackBar } from './charts'
import { cpsConfChip, phase2Cls, QA_TYPE_LABEL } from './tuningCatalog'
import { HelpNote } from './Help'

const pct = (r: number) => `${Math.round(r * 100)}%`

export function Diagnostics({ report }: { report: RunQualityReport }) {
  const langs = report.langs.filter((l) => report.perLang[l])
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-gray-800 dark:text-gray-200">Diagnostics</h2>
      <HelpNote>
        The raw numbers behind the scores and recommendations — open a panel to see per-language detail. Each
        panel’s subtitle says what it measures and what high values usually mean. Use these to sanity-check a
        recommendation before applying, or to spot a problem the advisor didn’t flag.
      </HelpNote>
      <div className="space-y-2">
        <Panel title="CPS calibration" defaultOpen subtitle="observed vs configured chars/sec per language (base-speed cells only)">
          <CpsPanel report={report} />
        </Panel>
        <Panel title="Speed distribution" subtitle="final TTS speed per cell — speed-ups mean the text was too long for the slot">
          <SpeedPanel report={report} />
        </Panel>
        <Panel title="Adaptation pressure" subtitle="W2 shortening attempts per segment (saturation = hit the cap)">
          <AdaptationPanel report={report} />
        </Panel>
        <Panel title="Breath borrow" subtitle="seconds borrowed into the next pause to fit">
          <BorrowPanel report={report} />
        </Panel>
        <Panel title="Phase 2 outcomes" subtitle="expansion results — concept_dropped/overshoot/error are regressions">
          <Phase2Panel report={report} />
        </Panel>
        {langs.some((l) => report.perLang[l].qa.count > 0) && (
          <Panel title="QA findings" subtitle="from the AI analysis report (formality / gender / false friend / naturalness)">
            <QaPanel report={report} />
          </Panel>
        )}
        {report.segmentTypes.length > 0 && (
          <Panel title="By segment type" subtitle="content-type drift — instructions often speak slower than narrative">
            <TypePanel report={report} />
          </Panel>
        )}
      </div>
    </section>
  )
}

function Panel({ title, subtitle, defaultOpen, children }: {
  title: string; subtitle?: string; defaultOpen?: boolean; children: React.ReactNode
}) {
  return (
    <details open={defaultOpen} className="rounded-lg border border-gray-200 bg-white dark:border-[#29292c] dark:bg-[#161617]">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-gray-800 dark:text-gray-200">
        {title}
        {subtitle && <span className="ml-2 text-xs font-normal text-gray-400">{subtitle}</span>}
      </summary>
      <div className="border-t border-gray-100 p-3 dark:border-[#29292c]">{children}</div>
    </details>
  )
}

function CpsPanel({ report }: { report: RunQualityReport }) {
  const langs = report.langs.filter((l) => report.perLang[l])
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[34rem] text-xs">
        <thead>
          <tr className="text-left text-gray-400">
            <th className="py-1 pr-3 font-medium">lang</th>
            <th className="py-1 pr-3 font-medium">base spd</th>
            <th className="py-1 pr-3 font-medium">N</th>
            <th className="py-1 pr-3 font-medium">observed</th>
            <th className="py-1 pr-3 font-medium">configured</th>
            <th className="py-1 pr-3 font-medium">recommend</th>
            <th className="py-1 pr-3 font-medium">delta</th>
            <th className="py-1 pr-3 font-medium">conf.</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {langs.map((l) => {
            const c = report.perLang[l].cps
            const strong = c.delta != null && Math.abs(c.delta) > 1 && c.confidence !== 'LOW'
            return (
              <tr key={l} className="border-t border-gray-100 dark:border-[#29292c]">
                <td className="py-1 pr-3 font-semibold text-gray-700 dark:text-gray-300">{l}</td>
                <td className="py-1 pr-3 text-gray-500">{c.baseSpeed ?? '—'}{c.baseSpeedSource ? <span className="text-gray-400"> {c.baseSpeedSource === 'voices' ? 'v' : 'm'}</span> : null}</td>
                <td className="py-1 pr-3 text-gray-500">{c.sampleSize}</td>
                <td className="py-1 pr-3 text-gray-700 dark:text-gray-300">{c.observed ?? <span className="text-gray-400">no sample</span>}</td>
                <td className="py-1 pr-3 text-gray-500">{c.configured ?? '—'}</td>
                <td className="py-1 pr-3 text-gray-700 dark:text-gray-300">{c.recommend ?? '—'}</td>
                <td className={`py-1 pr-3 ${strong ? 'font-semibold text-amber-700 dark:text-amber-400' : 'text-gray-500'}`}>{c.delta == null ? '—' : `${c.delta > 0 ? '+' : ''}${c.delta}`}</td>
                <td className="py-1 pr-3"><span className={`rounded px-1.5 py-px text-[10px] ${cpsConfChip(c.confidence)}`}>{c.confidence}</span></td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="mt-2 max-w-prose text-[11px] text-gray-400">
        <b>How to read:</b> observed is the chars/sec this voice actually spoke; configured is what the pipeline assumes.
        If observed is well above configured (positive delta), the pipeline lets translations run too long → raise the estimate
        toward <i>recommend</i>; if below, lower it. The AI recommendation does exactly this for deltas &gt; 1 at MED/HIGH confidence.
        Only base-speed cells count (v = speed from voices, m = inferred mode); LOW confidence (&lt;10 samples) accumulates across runs.
        Mirrors <code className="rounded bg-gray-100 px-1 dark:bg-[#202023]">scripts/analyze_cps.js</code>.
      </p>
    </div>
  )
}

function LangRows({ report, render }: { report: RunQualityReport; render: (L: LangQuality) => React.ReactNode }) {
  const langs = report.langs.filter((l) => report.perLang[l])
  return (
    <div className="space-y-2.5">
      {langs.map((l) => (
        <div key={l} className="flex items-start gap-3">
          <span className="w-8 shrink-0 pt-px font-mono text-xs font-semibold text-gray-600 dark:text-gray-300">{l}</span>
          <div className="min-w-0 flex-1">{render(report.perLang[l])}</div>
        </div>
      ))}
    </div>
  )
}

function SpeedPanel({ report }: { report: RunQualityReport }) {
  return (
    <LangRows report={report} render={(L) => {
      const buckets = Object.entries(L.speed.hist).sort((a, b) => Number(a[0]) - Number(b[0]))
      const base = L.cps.baseSpeed
      const segs = buckets.map(([spd, count]) => {
        const n = Number(spd)
        const cls = base != null && n > base + 0.005 ? 'bg-amber-400 dark:bg-amber-600'
          : base != null && n < base - 0.005 ? 'bg-blue-400 dark:bg-blue-600'
          : 'bg-green-400 dark:bg-green-600'
        return { label: spd, count, cls }
      })
      return (
        <>
          <StackBar segments={segs} />
          <div className="mt-0.5 text-[11px] text-gray-400">speed-up {pct(L.speed.speedUpRate)} · slow-down {pct(L.speed.slowDownRate)} · mean {L.speed.meanFinalSpeed ?? '—'}</div>
        </>
      )
    }} />
  )
}

function AdaptationPanel({ report }: { report: RunQualityReport }) {
  return (
    <LangRows report={report} render={(L) => (
      <BarRow label="saturation" value={Math.round(L.adaptation.saturationRate * 100)} max={100} suffix="%"
        tone="text-amber-500" sub={`avg ${L.adaptation.avgAttempts} · max ${L.adaptation.maxAttempts}`} />
    )} />
  )
}

function BorrowPanel({ report }: { report: RunQualityReport }) {
  const maxBorrow = Number(report.config.max_borrow_per_segment_sec) || 2
  return (
    <LangRows report={report} render={(L) => (
      <BarRow label="mean borrow" value={L.borrow.meanSec} max={maxBorrow} suffix="s"
        tone="text-blue-500" sub={`max ${L.borrow.maxSec}s · cap-hit ${pct(L.borrow.capHitRate)}`} />
    )} />
  )
}

function Phase2Panel({ report }: { report: RunQualityReport }) {
  return (
    <LangRows report={report} render={(L) => {
      const segs = Object.entries(L.phase2).map(([k, count]) => ({ label: k, count, cls: phase2Cls(k) }))
      if (!segs.length) return <span className="text-[11px] text-gray-400">no cells</span>
      return <StackBar segments={segs} />
    }} />
  )
}

function QaPanel({ report }: { report: RunQualityReport }) {
  return (
    <LangRows report={report} render={(L) => {
      const types = Object.entries(L.qa.byType)
      if (!types.length) return <span className="text-[11px] text-gray-400">none</span>
      return (
        <div className="flex flex-wrap gap-1.5 text-[11px]">
          {types.map(([t, n]) => (
            <span key={t} className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-600 dark:bg-[#202023] dark:text-gray-300">{QA_TYPE_LABEL[t] ?? t} {n}</span>
          ))}
          <span className="text-gray-400">rate {pct(L.qa.rate)}</span>
        </div>
      )
    }} />
  )
}

function TypePanel({ report }: { report: RunQualityReport }) {
  const types = report.segmentTypes.filter((t) => report.perType[t])
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[24rem] text-xs">
        <thead>
          <tr className="text-left text-gray-400">
            <th className="py-1 pr-3 font-medium">type</th>
            <th className="py-1 pr-3 font-medium">cells</th>
            <th className="py-1 pr-3 font-medium">observed CPS</th>
            <th className="py-1 pr-3 font-medium">needs attn</th>
            <th className="py-1 pr-3 font-medium">speed-up</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {types.map((t) => {
            const T = report.perType[t]
            return (
              <tr key={t} className="border-t border-gray-100 dark:border-[#29292c]">
                <td className="py-1 pr-3 text-gray-700 dark:text-gray-300">{t}</td>
                <td className="py-1 pr-3 text-gray-500">{T.cells}</td>
                <td className="py-1 pr-3 text-gray-700 dark:text-gray-300">{T.observedCps ?? '—'}</td>
                <td className="py-1 pr-3 text-gray-500">{pct(T.attentionTrueRate)}</td>
                <td className="py-1 pr-3 text-gray-500">{pct(T.speedUpRate)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
