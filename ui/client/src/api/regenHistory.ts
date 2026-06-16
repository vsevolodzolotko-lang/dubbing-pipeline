// Local memory of what text we replaced when firing a regen, so the after-regen
// REVIEW panel can show «було → стало». Client-only (localStorage); survives
// reload. Not authoritative — purely a UI convenience.
const KEY = 'dubbing-studio-regen-history'

export interface RegenOld { old: string; neu: string; at: number }

function load(): Record<string, RegenOld> {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') } catch { return {} }
}

export function getRegenOld(rowKey: string): RegenOld | null {
  return load()[rowKey] ?? null
}

export function recordRegen(items: { rowKey: string; oldText: string; newText: string }[]) {
  const m = load()
  const at = Date.now()
  for (const it of items) m[it.rowKey] = { old: it.oldText, neu: it.newText, at }
  try { localStorage.setItem(KEY, JSON.stringify(m)) } catch { /* quota — ignore */ }
}
