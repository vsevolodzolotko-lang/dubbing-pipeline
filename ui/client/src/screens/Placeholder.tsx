export function Placeholder({ title, phase }: { title: string; phase: string }) {
  return (
    <div className="mx-auto max-w-5xl p-8">
      <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">{title}</h1>
      <p className="mt-2 max-w-prose text-sm text-gray-500 dark:text-gray-400">
        This screen is planned for phase <span className="font-medium text-gray-700 dark:text-gray-300">{phase}</span>.
        The foundation is live: run state, the review matrix, and the audio layer are in progress.
      </p>
    </div>
  )
}
