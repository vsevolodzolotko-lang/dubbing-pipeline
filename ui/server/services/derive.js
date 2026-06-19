import { isTrue } from './runState.js'

const up = (v) => String(v ?? '').trim().toUpperCase()
const num = (v) => (v === '' || v == null || isNaN(Number(v)) ? null : Number(v))

/**
 * Joins segments × langs into the workbench matrix and attaches a human
 * Ukrainian diagnosis per cell (status language §3). Pure over the parsed model.
 */
export function buildLessonMatrix(model) {
  const { segments, localizations, voices, configMap, activeLangs } = model
  const langs = activeLangs
  const voiceSpeed = Object.fromEntries(voices.map((v) => [v.lang, num(v.speed) ?? 1]))
  const cfg = {
    maxSpeedUpDelta: num(configMap.get('max_speed_up_delta')) ?? 0.2,
  }

  const byRowKey = new Map(localizations.map((r) => [r.row_key, r]))
  const lessonId = segments[0]?.segment_id?.replace(/_seg_\d+$/, '') ?? null

  const rows = segments.map((seg) => {
    const cells = {}
    for (const lang of langs) {
      const rowKey = `${segIdShort(seg.segment_id)}_${lang}`
      const loc = byRowKey.get(rowKey) || localizations.find(
        (r) => r.segment_id === seg.segment_id && r.lang === lang)
      cells[lang] = loc
        ? buildCell(seg, loc, voiceSpeed[lang], cfg)
        : { present: false, status: 'MISSING' }
    }
    return {
      segmentId: seg.segment_id,
      enText: seg.en_text,
      enStart: num(seg.en_start_sec),
      enEnd: num(seg.en_end_sec),
      enDuration: num(seg.en_duration_sec),
      segmentType: seg.segment_type || 'narrative',
      movementKeywords: seg.movement_keywords || '',
      movementLocked: isMovementLocked(seg),
      cells,
    }
  })

  return { lessonId, langs, segments: rows }
}

function buildCell(seg, loc, vSpeed, cfg) {
  const diagnosis = diagnose(seg, loc, vSpeed ?? 1, cfg)
  return {
    present: true,
    rowKey: loc.row_key,
    lang: loc.lang,
    status: up(loc.needs_attention) || 'FALSE',
    needsRetts: isTrue(loc.needs_retts),
    textTranslated: loc.text_translated ?? '',
    realDuration: num(loc.real_duration_sec),
    finalDuration: num(loc.final_duration_sec),
    finalSpeed: num(loc.final_speed),
    borrowedSec: num(loc.borrowed_sec),
    expansionAttempts: num(loc.expansion_attempts) ?? 0,
    shortenRetries: num(loc.shorten_retries_in_synthesize) ?? 0,
    phase2Outcome: loc.phase2_outcome ?? '',
    lastRegenAt: loc.last_regen_at ?? '',
    regenComment: loc.regen_comment ?? '',
    audioFileId: loc.audio_drive_file_id ?? '',
    normalizedLufs: loc.normalized_lufs === '' || loc.normalized_lufs == null ? null : Number(loc.normalized_lufs),
    diagnosis,
  }
}

function isMovementLocked(seg) {
  return Boolean(String(seg.movement_keywords ?? '').trim()) ||
    String(seg.segment_type ?? '').toLowerCase() === 'movement'
}

/**
 * §3 diagnosis. Produces a symptom headline + a ranked list of CONTRIBUTING
 * CAUSES (each grounded in a real signal, tagged certain/likely) + one dominant
 * advice + neutral "what automation did" facts. Cause rules are verified against
 * the pipeline code (check_timing_and_pad.js / phase2_batch_llm_tts.js /
 * regen_synthesize.js / adapt_translations.js) — nothing is emitted without its
 * underlying signal present.
 */
function diagnose(seg, loc, vSpeed, cfg) {
  const status = up(loc.needs_attention)
  const retts = isTrue(loc.needs_retts)
  const movementLocked = isMovementLocked(seg)
  const speedCeil = vSpeed + cfg.maxSpeedUpDelta
  const fs = num(loc.final_speed)
  const atCeil = (fs ?? 0) >= speedCeil - 1e-6
  const shorten = num(loc.shorten_retries_in_synthesize) ?? 0
  const phase2 = String(loc.phase2_outcome ?? '').trim()
  const realDur = num(loc.real_duration_sec)
  const slot = num(seg.en_duration_sec)
  const adapt = num(seg[`${loc.lang}_adaptation_attempts`]) ?? 0
  const regenAt = String(loc.last_regen_at ?? '').trim()

  let severity = 'ok'
  let primary = 'Без зауважень'
  let advice = null
  const causes = []
  const add = (kind, text, confidence) => causes.push({ kind, text, confidence })

  if (retts) {
    severity = 'queued'
    primary = 'У кошику перегенерації'
  } else if (status === 'REVIEW') {
    severity = 'review'
    primary = 'Перегенеровано — послухай і вирішуй'
    if (regenAt) add('regen', `Перегенеровано ${regenAt}`, 'certain')
    if (realDur != null && slot) add('tight', `Нова тривалість ${realDur.toFixed(1)}с проти слота ${slot.toFixed(1)}с`, 'certain')
    if (loc.regen_comment) add('regen', `Коментар: ${loc.regen_comment}`, 'certain')
    advice = 'Звучить добре — постав «Ок»; усе ще погано — постав «Погано» (далі кошик або ElevenLabs)'
  } else if (status === 'TRUE') {
    severity = 'bad'

    // ── gather grounded contributing causes ──
    if (realDur === 0) {
      add('tech', 'Синтез не повернув аудіо — технічний збій (ймовірно мережа/ліміт, не проблема тексту)', 'certain')
    }
    if (shorten >= 3) {
      add('length', 'Переклад надто довгий — скорочували максимально (3 спроби)', 'certain')
    } else if (shorten >= 1) {
      add('length', `Переклад скорочували у синтезі (${shorten} сп.)`, 'certain')
    }
    if (atCeil && fs != null) {
      add('speed', `Темп уже на стелі: ${fs.toFixed(2)} (база ${vSpeed.toFixed(2)} + макс). Прискорювати нема куди`, 'certain')
    }
    if (movementLocked) {
      add('movement', 'Сегмент із рухом — озвучку не можна розтягувати в паузу (синхрон з відео)', 'certain')
    }
    if (adapt >= 2) {
      add('density', `Ймовірно щільний переклад — скорочували ще на перекладі (${adapt} сп.); мова багатослівніша за англ.`, 'likely')
    }
    if (regenAt) {
      add('regen', `Перегенерація вже пробувала (${regenAt}) — той самий результат імовірний`, 'certain')
    }
    if (phase2 && phase2 !== 'accepted') {
      add('phase2', PHASE2_COPY[phase2] || `Особливість на кроці розширення (${phase2})`, 'certain')
    }
    // nothing concrete pinned it down → an honest "likely" fallback
    if (causes.length === 0) {
      add('tight', 'Ймовірно слот надто щільний для цієї мови — послухай і виправ текст', 'likely')
    }

    // ── symptom headline + dominant advice (by strongest cause) ──
    const kinds = new Set(causes.map((c) => c.kind))
    if (kinds.has('tech')) {
      primary = 'Синтез повернув порожнє аудіо'
      advice = 'Просто перегенеруй ще раз'
    } else if (kinds.has('regen')) {
      primary = 'Перегенерація не допомогла — модель не вкладається у слот'
      advice = 'Спробуй ElevenLabs UI вручну: інший темп, паузи „…“, простіша фраза'
    } else if (kinds.has('movement')) {
      primary = 'Сегмент із рухом: аудіо не вмістилось у жорсткий слот'
      advice = 'Сильно коротша фраза — або зніми позначку руху, якщо це помилка класифікації'
    } else if (kinds.has('length') || kinds.has('speed')) {
      primary = 'Переклад не вмістився у слот — аудіо обрізано в кінці'
      advice = 'Зроби переклад коротшим (прибери зайве) або додай паузу „…“, потім перегенеруй'
    } else {
      primary = 'Потребує уваги — послухай сегмент'
      advice = 'Послухай; за потреби виправ текст і перегенеруй'
    }
  } else if (status === 'FALSE') {
    severity = 'ok'
    primary = regenAt || loc.regen_comment ? 'Підтверджено вручну' : 'Без зауважень'
  }

  // ── neutral "what automation did" facts (any cell) ──
  const facts = []
  const borrowed = num(loc.borrowed_sec)
  if (borrowed && borrowed > 0) facts.push(`Позичив ${borrowed.toFixed(1)}с тиші після сегмента — нормально, повний трек вирівняний`)
  if (fs != null && Math.abs(fs - vSpeed) > 0.001 && !atCeil) {
    const deltaPct = Math.round(((fs - vSpeed) / vSpeed) * 100)
    facts.push(`Темп ${fs.toFixed(2)} (${deltaPct > 0 ? '+' : ''}${deltaPct}% від базового ${vSpeed.toFixed(2)} цієї мови)`)
  }
  const exp = num(loc.expansion_attempts)
  if (exp && exp > 0) facts.push(`Розширював текст (${exp} сп.), щоб заповнити паузу`)
  if (phase2 === 'accepted' && exp && exp > 0) facts.push('Текст розширено, щоб заповнити паузу — прийнято')

  return {
    severity,
    primary,
    causes,
    advice,
    facts,
    fill: realDur != null && slot ? { real: realDur, slot } : null,
  }
}

const PHASE2_COPY = {
  no_change: 'Розширення не знайшло, чим заповнити паузу — лишився коротший варіант',
  overshoot: 'Спроба заповнити паузу вийшла задовгою — лишили попередню версію',
  negative_tail: 'Спроба заповнити паузу вийшла задовгою — лишили попередню версію',
  tts_empty: 'Синтез повертав порожнє аудіо на кроці розширення',
  llm_dropped: 'Модель пропустила цей рядок на кроці розширення — перегенеруй',
  llm_refusal: 'Модель видала службовий текст замість перекладу — перегенеруй',
  error: 'Технічний збій на кроці розширення — перегенеруй; якщо повториться, поклич automation tech',
}

/** README QA recipe: TRUE ∪ REVIEW ∪ phase2≠accepted/∅ ∪ shorten_retries≥3 */
export function isProblemRow(loc) {
  const att = up(loc.needs_attention)
  if (att === 'TRUE' || att === 'REVIEW') return true
  const phase2 = String(loc.phase2_outcome ?? '').trim()
  if (phase2 && phase2 !== 'accepted') return true
  if ((num(loc.shorten_retries_in_synthesize) ?? 0) >= 3) return true
  return false
}

export function filterLocalizations(localizations, filter) {
  switch (filter) {
    case 'attention': return localizations.filter((r) => up(r.needs_attention) === 'TRUE')
    case 'review': return localizations.filter((r) => up(r.needs_attention) === 'REVIEW')
    case 'qa': return localizations.filter(isProblemRow)
    default: return localizations
  }
}

function segIdShort(segmentId) {
  const m = String(segmentId).match(/_seg_(\d+)$/)
  return m ? `seg_${m[1]}` : segmentId
}
