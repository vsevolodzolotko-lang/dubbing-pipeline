import {
  RUN_STATES, READONLY_STATES, RUNNING_STATES, CONFIG_KEYS,
  PIPELINE_STAGES, STAGE_STATUS, STALL_THRESHOLD_MS,
} from '../constants.js'

const SETTLE_MS = 20_000 // "no deltas for ~3 polls" → a stop is considered settled

/**
 * Run state for two coexisting flows:
 *  - STAGED flow (UI drop-in): authoritative explicit stage fields in `config`
 *    (pipeline_stage / stage_status), trusted only when stage_run_token matches
 *    the live run_token. Gives the review gates that pure derivation can't.
 *  - AUTO flow (Drive 01_input drop): no stage fields → pure inference from what
 *    data/files exist + staleMs, exactly as before. Untouched behavior.
 */
export function computeRunState(ctx) {
  const {
    configMap, segments, localizations, driveFull, activeLangs, staleMs = 0,
  } = ctx

  const runToken = (configMap.get(CONFIG_KEYS.runToken) || '').toString().trim()
  const abortToken = (configMap.get(CONFIG_KEYS.abortToken) || '').toString().trim()
  const pipelineStage = (configMap.get(CONFIG_KEYS.pipelineStage) || '').toString().trim()
  const stageStatus = (configMap.get(CONFIG_KEYS.stageStatus) || '').toString().trim()
  const stageRunToken = (configMap.get(CONFIG_KEYS.stageRunToken) || '').toString().trim()

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

  const complete = segCount > 0 && langs.length > 0 &&
    fullDoneLangs.length === langs.length && locCount >= expected

  // A staged run is one whose explicit stage fields are present AND scoped to the
  // current run_token (same trust rule the abort token uses).
  const staged = Boolean(runToken) && Boolean(pipelineStage) && stageRunToken === runToken

  let state = RUN_STATES.UNKNOWN
  let currentLang = null
  let reason

  if (staged) {
    const r = stageToState({ pipelineStage, stageStatus, langs, fullDoneLangs, synthByLang })
    state = r.state
    currentLang = r.currentLang
    reason = r.reason
    // Overlays (same precedence as the auto flow).
    if (abortMatch && state !== RUN_STATES.COMPLETE) {
      state = staleMs > SETTLE_MS ? RUN_STATES.STOPPED : RUN_STATES.STOPPING
    } else if ((anyRetts || ctx.regenInFlight) &&
      (state === RUN_STATES.AUDIO_REVIEW || state === RUN_STATES.COMPLETE)) {
      state = RUN_STATES.REGENERATING
    }
  } else if (!runToken && segCount === 0) {
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
  // Review states are intentionally idle — only flag STALLED while truly running.
  const stalled = RUNNING_STATES.has(state) && staleMs > STALL_THRESHOLD_MS

  return {
    state,
    lessonId,
    readOnly,
    stalled,
    reason,
    runTokenPresent: Boolean(runToken),
    staged,
    pipelineStage: staged ? pipelineStage : null,
    stageStatus: staged ? stageStatus : null,
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

/** Map explicit (pipeline_stage, stage_status) → run state. APPROVED is a brief
 *  interim before the next workflow flips to RUNNING, so it reads as "next stage
 *  starting". Derived signals refine only the within-synthesis current lang. */
function stageToState({ pipelineStage, stageStatus, langs, fullDoneLangs, synthByLang }) {
  const R = STAGE_STATUS.REVIEW, A = STAGE_STATUS.APPROVED
  switch (pipelineStage) {
    case PIPELINE_STAGES.STT:
      if (stageStatus === R) return { state: RUN_STATES.TRANSCRIPT_REVIEW }
      if (stageStatus === A) return { state: RUN_STATES.TRANSLATING }
      return { state: RUN_STATES.STT }
    case PIPELINE_STAGES.TRANSLATE:
      if (stageStatus === R) return { state: RUN_STATES.TRANSLATION_REVIEW }
      if (stageStatus === A) return { state: RUN_STATES.SYNTHESIZING }
      return { state: RUN_STATES.TRANSLATING }
    case PIPELINE_STAGES.SYNTH: {
      if (stageStatus === R) return { state: RUN_STATES.AUDIO_REVIEW }
      const currentLang = langs.find((l) => !fullDoneLangs.includes(l) && synthByLang[l] > 0)
        || langs.find((l) => !fullDoneLangs.includes(l)) || null
      return { state: RUN_STATES.SYNTHESIZING, currentLang }
    }
    case PIPELINE_STAGES.DONE:
      return { state: RUN_STATES.COMPLETE }
    default:
      return { state: RUN_STATES.UNKNOWN, reason: `unknown pipeline_stage "${pipelineStage}"` }
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
