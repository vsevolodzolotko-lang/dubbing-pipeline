import { RUN_STATES, READONLY_STATES, CONFIG_KEYS, STALL_THRESHOLD_MS } from '../constants.js'

const SETTLE_MS = 20_000 // "no deltas for ~3 polls" → a stop is considered settled

/**
 * Pure inference of run state from snapshot signals. No timestamps from the
 * pipeline are authoritative for "is it running" (run_token is never cleared at
 * completion), so state is derived from what data/files actually exist plus how
 * long since anything changed (staleMs).
 */
export function computeRunState(ctx) {
  const {
    configMap, segments, localizations, driveFull, activeLangs, staleMs = 0,
  } = ctx

  const runToken = (configMap.get(CONFIG_KEYS.runToken) || '').toString().trim()
  const abortToken = (configMap.get(CONFIG_KEYS.abortToken) || '').toString().trim()
  const langs = activeLangs.length ? activeLangs : []
  const segCount = segments.length
  const expected = segCount * langs.length
  const locCount = localizations.length

  const fullDoneLangs = langs.filter((l) =>
    driveFull.some((f) => f.name && f.name.endsWith(`_full_${l}.wav`)))
  const langTextDoneLangs = langs.filter((l) =>
    segments.some((s) => String(s[`${l}_text`] ?? '').trim()))
  const synthByLang = Object.fromEntries(langs.map((l) => [
    l, localizations.filter((r) => r.lang === l).length,
  ]))
  const abortMatch = Boolean(abortToken) && abortToken === runToken
  const anyRetts = localizations.some((r) => isTrue(r.needs_retts))

  const lessonId = inferLessonId(segments, ctx.driveInput)
  const needsAttention = countAttention(localizations)
  const stalled = staleMs > STALL_THRESHOLD_MS

  let state = RUN_STATES.UNKNOWN
  let currentLang = null
  let reason

  const complete = segCount > 0 && langs.length > 0 &&
    fullDoneLangs.length === langs.length && locCount >= expected

  if (!runToken && segCount === 0) {
    state = RUN_STATES.IDLE
  } else if (segCount === 0 && runToken) {
    state = RUN_STATES.ARCHIVING // tabs wiped, fresh token → archive window
  } else if (abortMatch && !complete) {
    state = staleMs > SETTLE_MS ? RUN_STATES.STOPPED : RUN_STATES.STOPPING
  } else if (complete) {
    state = anyRetts || ctx.regenInFlight ? RUN_STATES.REGENERATING : RUN_STATES.COMPLETE
  } else if (anyRetts || ctx.regenInFlight) {
    state = RUN_STATES.REGENERATING
  } else if (segCount > 0 && langTextDoneLangs.length === 0 && locCount === 0) {
    state = RUN_STATES.STT
  } else if (langTextDoneLangs.length < langs.length && locCount === 0) {
    state = RUN_STATES.TRANSLATING
  } else if (locCount === 0 && langTextDoneLangs.length === langs.length) {
    state = RUN_STATES.TRANSLATING // translated, synth not yet started
  } else if (locCount > 0 && fullDoneLangs.length < langs.length) {
    state = RUN_STATES.SYNTHESIZING
    currentLang = langs.find((l) => !fullDoneLangs.includes(l) && synthByLang[l] > 0)
      || langs.find((l) => !fullDoneLangs.includes(l)) || null
  } else {
    state = RUN_STATES.UNKNOWN
    reason = 'indeterminate signals'
  }

  const readOnly = READONLY_STATES.has(state)

  return {
    state,
    lessonId,
    readOnly,
    stalled,
    reason,
    runTokenPresent: Boolean(runToken),
    progress: {
      segCount,
      langTotal: langs.length,
      langDone: fullDoneLangs.length,
      currentLang,
      langTextDone: langTextDoneLangs.length,
      synthByLang,
    },
    needsAttention,
  }
}

export function isTrue(v) {
  return String(v ?? '').trim().toUpperCase() === 'TRUE'
}

function countAttention(localizations) {
  let count = 0
  for (const r of localizations) if (isTrue(r.needs_attention)) count++
  const total = localizations.length
  return { count, total, pct: total ? Math.round((count / total) * 100) : 0 }
}

function inferLessonId(segments, driveInput) {
  const sid = segments[0]?.segment_id
  if (sid) {
    const m = String(sid).match(/^(.*)_seg_\d+$/)
    if (m) return m[1]
  }
  const f = driveInput?.[0]?.name
  if (f) return f.replace(/\.(wav|mp3)$/i, '')
  return null
}
