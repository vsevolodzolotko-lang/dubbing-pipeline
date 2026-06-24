import { Info, Sparkles, MousePointerClick, TrendingUp } from 'lucide-react'

// One-line muted explanation placed under a section heading. Keeps the tab
// self-documenting without a separate manual.
export function HelpNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-start gap-1.5 text-xs text-gray-500 dark:text-gray-400">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" strokeWidth={1.75} />
      <span className="max-w-prose">{children}</span>
    </div>
  )
}

// Top-of-tab primer: what the tab is for + the 3-step loop. Collapsible so it
// stays out of the way once the operator knows the flow (open by default).
export function HowToUse() {
  return (
    <details open className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm dark:border-[#29292c] dark:bg-[#161617]">
      <summary className="cursor-pointer font-medium text-gray-800 dark:text-gray-200">How to use this tab</summary>
      <div className="mt-2 space-y-2 text-gray-600 dark:text-gray-300">
        <p className="max-w-prose">
          Tuning turns the metrics every run produces (how well the dub fit each slot, where the operator
          had to intervene) into concrete settings advice. The goal: each lesson should need fewer manual fixes than the last.
        </p>
        <ol className="space-y-1.5">
          <Step n={1} icon={<Sparkles className="h-4 w-4" strokeWidth={1.75} />}>
            <b>Generate recommendations</b> — the advisor reads this run’s metrics and proposes changes to
            config, voices, and prompts, each with evidence and a confidence level.
          </Step>
          <Step n={2} icon={<MousePointerClick className="h-4 w-4" strokeWidth={1.75} />}>
            <b>Review &amp; apply</b> — read the rationale, then <b>Apply</b> to write the setting (it takes effect on the
            next run) or <b>Dismiss</b>. Trust <span className="font-mono">high</span> confidence; treat <span className="font-mono">low</span> as a hint until more runs accumulate.
          </Step>
          <Step n={3} icon={<TrendingUp className="h-4 w-4" strokeWidth={1.75} />}>
            <b>Track trends</b> — after a few runs, the Trends panel shows whether your changes actually moved
            quality in the right direction.
          </Step>
        </ol>
        <p className="max-w-prose text-xs text-gray-400">
          Use the run selector (top-right) to inspect an earlier run. Diagnostics below show the raw numbers
          behind every score and recommendation.
        </p>
      </div>
    </details>
  )
}

function Step({ n, icon, children }: { n: number; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-200 text-[11px] font-semibold text-gray-600 dark:bg-[#2a2a2d] dark:text-gray-300">{n}</span>
      <span className="mt-0.5 shrink-0 text-gray-400">{icon}</span>
      <span className="max-w-prose">{children}</span>
    </li>
  )
}
