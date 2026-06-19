/**
 * Left-rail header for one audio track: name, a volume slider, and Mute / Solo
 * toggles (DAW-style M/S). Dimmed when the track is currently inaudible.
 */
export function TrackHeader({ name, sub, muted, solo, audible, volume, height, onMute, onSolo, onVolume }: {
  name: string
  sub?: string
  muted: boolean
  solo: boolean
  audible: boolean
  volume: number
  height: number
  onMute: () => void
  onSolo: () => void
  onVolume: (v: number) => void
}) {
  const tag = (on: boolean, onClass: string) =>
    `h-5 w-5 shrink-0 rounded text-[11px] font-semibold leading-none ${
      on ? onClass : 'bg-gray-200 text-gray-500 hover:bg-gray-300 dark:bg-[#202023] dark:text-gray-400 dark:hover:bg-[#29292c]'
    }`
  return (
    <div
      style={{ height }}
      className={`flex flex-col justify-center gap-1 border-b border-gray-200 px-2 dark:border-[#29292c] ${audible ? '' : 'opacity-50'}`}
    >
      <div className="flex items-baseline gap-1">
        <span className="truncate font-mono text-xs font-medium text-gray-700 dark:text-gray-200">{name}</span>
        {sub && <span className="shrink-0 text-[10px] text-gray-400">{sub}</span>}
      </div>
      <div className="flex items-center gap-1">
        <input
          type="range" min={0} max={1} step={0.01} value={volume}
          onChange={(e) => onVolume(Number(e.target.value))}
          title={`гучність ${Math.round(volume * 100)}%`}
          className="h-1 w-16 flex-1 accent-gray-700 dark:accent-gray-300"
        />
        <button type="button" onClick={onMute} title="Mute" aria-pressed={muted} className={tag(muted, 'bg-red-500 text-white')}>M</button>
        <button type="button" onClick={onSolo} title="Solo" aria-pressed={solo} className={tag(solo, 'bg-amber-500 text-white')}>S</button>
      </div>
    </div>
  )
}
