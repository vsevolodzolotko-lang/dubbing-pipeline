// Tracks a UI-initiated W_Regen in flight: which row_keys were flagged, when,
// and whether they've cleared (needs_retts → FALSE = done) or hung past a
// watchdog (W_Regen has NO error workflow, so a silent failure leaves
// needs_retts=TRUE forever — we surface that instead of spinning silently).

const WATCHDOG_BASE_MS = 90_000
const WATCHDOG_PER_ROW_MS = 30_000
const WATCHDOG_MAX_MS = 12 * 60_000

let current = null // { rowKeys: string[], firedAt: ms, phase: 'running'|'stale' }

const isTrue = (v) => String(v ?? '').trim().toUpperCase() === 'TRUE'

function watchdogMs(count) {
  return Math.min(WATCHDOG_MAX_MS, WATCHDOG_BASE_MS + WATCHDOG_PER_ROW_MS * count)
}

function statusOf(cur, remaining, now) {
  return {
    active: true,
    stale: cur.phase === 'stale',
    total: cur.rowKeys.length,
    remaining: remaining.length,
    rowKeys: cur.rowKeys,
    elapsedSec: Math.round((now - cur.firedAt) / 1000),
  }
}

export const regenTracker = {
  start(rowKeys, now = Date.now()) {
    current = { rowKeys: [...new Set(rowKeys)], firedAt: now, phase: 'running' }
    return current
  },

  /** Poll-time: returns {status, event}. event ∈ null | 'done' | 'stale' (on transition). */
  evaluate(localizations, now = Date.now()) {
    if (!current) return { status: { active: false }, event: null }
    const byKey = new Map(localizations.map((r) => [r.row_key, r]))
    const remaining = current.rowKeys.filter((rk) => {
      const r = byKey.get(rk)
      return r && isTrue(r.needs_retts)
    })

    if (remaining.length === 0) {
      const done = { active: false, justFinished: true, total: current.rowKeys.length, rowKeys: current.rowKeys }
      current = null
      return { status: done, event: 'done' }
    }
    if ((now - current.firedAt) > watchdogMs(current.rowKeys.length) && current.phase !== 'stale') {
      current.phase = 'stale'
      return { status: statusOf(current, remaining, now), event: 'stale' }
    }
    return { status: statusOf(current, remaining, now), event: null }
  },

  /** Read-only snapshot for an HTTP endpoint / initial load. */
  get(localizations, now = Date.now()) {
    if (!current) return { active: false }
    const byKey = new Map(localizations.map((r) => [r.row_key, r]))
    const remaining = current.rowKeys.filter((rk) => {
      const r = byKey.get(rk)
      return r && isTrue(r.needs_retts)
    })
    return statusOf(current, remaining, now)
  },

  clear() { current = null },
}
