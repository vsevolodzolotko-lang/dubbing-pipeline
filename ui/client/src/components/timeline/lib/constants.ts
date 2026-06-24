// Tuning constants for the segment timeline editor. Time is always in seconds;
// pixels are derived from `pxPerSecond` (zoom) for rendering only.

export const MIN_DURATION = 0.2 // s — min segment length; matches the server clamp
export const MIN_GAP = 0 // s — gap enforced between neighbouring segments

export const SNAP_PX = 7 // snap threshold in px → seconds via SNAP_PX / pxPerSecond
export const NUDGE_MS = 10 // arrow-key edge nudge
export const NUDGE_SHIFT_MS = 100 // shift+arrow edge nudge
export const NUDGE_SETTLE_MS = 400 // coalesce a burst of nudges into one history entry

export const MIN_PX_PER_SEC = 4 // fully zoomed out (long clips fit)
export const MAX_PX_PER_SEC = 400 // fully zoomed in (full-width canvas — short-clip scope)
export const DEFAULT_PX_PER_SEC = 50 // ~matches the peaks detail density (~50 samples/s)
export const ZOOM_FACTOR = 1.25 // multiply / divide pxPerSecond per zoom step

export const HANDLE_HIT_PX = 12 // invisible grab target width on each edge
export const HANDLE_VISUAL_PX = 2.5 // visible handle width

export const RULER_H = 26 // px — ruler height
export const LANE_H = 64 // px — segment lane height (transcript timeline)
export const TRACK_H = 50 // px — one audio track lane (audio timeline multitrack)
export const RAIL_W = 132 // px — left track-header rail width (name + volume + M/S)
