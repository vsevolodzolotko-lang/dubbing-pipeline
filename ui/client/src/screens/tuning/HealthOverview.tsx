import type { RunQualityReport, LangQuality } from '../../api/types'
import { scoreTone, SCORE_TEXT, cpsConfLabel } from './tuningCatalog'
import { HelpNote } from './Help'

const pct = (r: number) => `${Math.round(r * 100)}%`

export function HealthOverview({ report }: { report: RunQualityReport }) {
  const langs = report.langs.filter((l) => report.perLang[l])
  if (!langs.length) return <div className="text-sm text-gray-400">No synthesized cells in this run yet.</div>

  // Run-level headline: mean score + worst lang.
  const scores = langs.map((l) => report.perLang[l].score)
  const mean = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
  const worst = langs.slice().sort((a, b) => report.perLang[a].score - report.perLang[b].score)[0]

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Health by language</h2>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          run mean <b className={SCORE_TEXT[scoreTone(mean)]}>{mean}</b>
          {' · '}weakest <b className="font-mono">{worst}</b> ({report.perLang[worst].score})
          {' · '}{report.totals.segments} segments × {report.totals.langs} langs · {report.totals.cells} cells
        </span>
      </div>
      <HelpNote>
        One card per language. <b>Score</b> is a 0–100 health summary (higher is better) combining the risks below.
        <b> Needs attn</b> = share of cells the operator flagged as bad; <b>regen</b> = share regenerated;
        <b> CPS drift</b> = measured minus configured chars/sec (large = mis-calibrated, see Diagnostics);
        <b> speed-up</b> = share of cells TTS had to accelerate because the text was too long. Amber = worth attention.
      </HelpNote>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {langs.map((l) => <LangCard key={l} L={report.perLang[l]} />)}
      </div>
    </section>
  )
}

function LangCard({ L }: { L: LangQuality }) {
  const tone = scoreTone(L.score)
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-[#29292c] dark:bg-[#161617]">
      <div className="flex items-center justify-between">
        <span className="font-mono text-sm font-semibold text-gray-700 dark:text-gray-300">{L.lang}</span>
        <span className={`text-2xl font-semibold tabular-nums ${SCORE_TEXT[tone]}`}>{L.score}</span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        <Tile label="needs attn" value={pct(L.attention.trueRate)} bad={L.attention.trueRate > 0} />
        <Tile label="regen" value={pct(L.regen.rate)} bad={L.regen.rate > 0} />
        <Tile
          label="CPS drift"
          value={L.cps.delta == null ? '—' : `${L.cps.delta > 0 ? '+' : ''}${L.cps.delta}`}
          hint={L.cps.observed == null ? 'no sample' : cpsConfLabel[L.cps.confidence]}
          bad={L.cps.delta != null && Math.abs(L.cps.delta) > 1 && L.cps.confidence !== 'LOW'}
        />
        <Tile label="speed-up" value={pct(L.speed.speedUpRate)} bad={L.speed.speedUpRate > 0.25} />
      </div>
    </div>
  )
}

function Tile({ label, value, hint, bad }: { label: string; value: string; hint?: string; bad?: boolean }) {
  return (
    <div className="rounded bg-gray-50 px-2 py-1 dark:bg-[#202023]">
      <div className="text-[10px] uppercase tracking-wide text-gray-400">{label}</div>
      <div className={`font-mono text-sm ${bad ? 'text-amber-700 dark:text-amber-400' : 'text-gray-700 dark:text-gray-300'}`}>
        {value}{hint ? <span className="ml-1 text-[10px] text-gray-400">{hint}</span> : null}
      </div>
    </div>
  )
}
