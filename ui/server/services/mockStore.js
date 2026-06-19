import { DEFAULT_LANGS, PIPELINE_STAGES, STAGE_STATUS } from '../constants.js'

/**
 * Stateful MOCK simulator for the STAGED flow (Etap M). Replaces the old pure
 * `mockData` fixtures: it holds mutable in-memory state, advances the staged
 * pipeline on a wall-clock timer (`tick`), and accepts operator writes
 * (transcript/translation edits, merge/split, verdicts) + gate approvals. The
 * snapshot reads `tabs()`/`drive()` exactly like the live Sheets/Drive path, so
 * the same parser + state machine run in mock and live.
 *
 * The live n8n pipeline is NOT touched — this only exercises the UI.
 */

const LESSON = 'sleep_002'

// Canonical EN source (as if W1/Deepgram produced it).
const SEED = [
  { en: 'Welcome back. Find a comfortable position and let your body settle.', start: 0.0, end: 6.4, type: 'narrative', move: '' },
  { en: 'Take a slow breath in through your nose.', start: 6.8, end: 11.2, type: 'movement', move: 'inhale' },
  { en: 'And gently release it, letting your shoulders soften.', start: 11.6, end: 17.5, type: 'movement', move: 'exhale' },
  { en: 'Notice the quiet space that opens up with each breath.', start: 18.0, end: 24.2, type: 'narrative', move: '' },
  { en: 'There is nothing you need to do right now, nowhere to be.', start: 24.6, end: 31.0, type: 'narrative', move: '' },
  { en: 'Let this calm carry you gently into rest.', start: 31.4, end: 37.1, type: 'narrative', move: '' },
]
const AUDIO_DURATION = 37.1

// Realistic-looking voice config per lang (so pre-flight readiness is green by
// default; clearing a voice_id in /voices makes that lang flag as not-ready).
const VOICE_SEED = {
  de: { voice_id: 'pNInz6obpgDQGcFmaJgB', voice_name: 'Hanna', model: 'eleven_multilingual_v2', stability: 0.5, similarity_boost: 0.75, style: 0, speed: 1.0, notes: '' },
  es: { voice_id: 'EXAVITQu4vr4xnSDxMaL', voice_name: 'Lucía', model: 'eleven_multilingual_v2', stability: 0.5, similarity_boost: 0.75, style: 0, speed: 1.0, notes: '' },
  fr: { voice_id: 'XB0fDUnXU5powFXDhCwa', voice_name: 'Charlotte', model: 'eleven_multilingual_v2', stability: 0.55, similarity_boost: 0.75, style: 0, speed: 0.86, notes: 'повільніший голос' },
  it: { voice_id: 'XrExE9yKIg1WjnnlVkGX', voice_name: 'Matilda', model: 'eleven_multilingual_v2', stability: 0.5, similarity_boost: 0.75, style: 0, speed: 1.0, notes: '' },
  pl: { voice_id: 'AZnzlk1XvdvUeBnXmlld', voice_name: 'Zofia', model: 'eleven_multilingual_v2', stability: 0.5, similarity_boost: 0.75, style: 0, speed: 1.0, notes: '' },
  pt: { voice_id: 'TxGEqnHWrfWFTfGW9XjX', voice_name: 'Beatriz', model: 'eleven_multilingual_v2', stability: 0.5, similarity_boost: 0.75, style: 0, speed: 1.0, notes: '' },
  tr: { voice_id: 'jsCqWAovK2LkecY7zXl4', voice_name: 'Elif', model: 'eleven_multilingual_v2', stability: 0.5, similarity_boost: 0.75, style: 0, speed: 1.0, notes: '' },
}

// Canonical translations (index-aligned to SEED). A couple carry deliberate
// defects so the AI/deterministic scoring at the translation gate has something
// to flag: de[0] uses formal "Sie", fr[4] is overlong for its slot.
const TRANSLATIONS = {
  de: ['Willkommen zurück. Finden Sie eine bequeme Position und lassen Sie Ihren Körper zur Ruhe kommen.', 'Atme langsam durch die Nase ein.', 'Und lass ihn sanft los, während deine Schultern weich werden.', 'Bemerke den stillen Raum, der sich mit jedem Atemzug öffnet.', 'Es gibt nichts zu tun, nirgendwo zu sein.', 'Lass diese Ruhe dich sanft in den Schlaf tragen.'],
  es: ['Bienvenida de nuevo. Encuentra una posición cómoda y deja que tu cuerpo se asiente.', 'Inhala lentamente por la nariz.', 'Y suéltalo con suavidad, dejando que tus hombros se relajen.', 'Nota el espacio tranquilo que se abre con cada respiración.', 'No hay nada que hacer ahora, ningún lugar donde estar.', 'Deja que esta calma te lleve suavemente al descanso.'],
  fr: ['Bienvenue. Trouve une position confortable et laisse ton corps se poser.', 'Inspire lentement par le nez.', 'Et relâche doucement, en laissant tes épaules se détendre.', 'Remarque l’espace calme qui s’ouvre à chaque souffle.', 'Il n’y a absolument rien que tu aies besoin de faire en cet instant précis, et il n’existe nul autre endroit où il te faudrait être maintenant.', 'Laisse ce calme te porter doucement vers le repos.'],
  it: ['Bentornata. Trova una posizione comoda e lascia che il corpo si assesti.', 'Inspira lentamente dal naso.', 'E rilascialo dolcemente, lasciando ammorbidire le spalle.', 'Nota lo spazio silenzioso che si apre a ogni respiro.', 'Non c’è nulla da fare ora, nessun posto dove essere.', 'Lascia che questa calma ti porti dolcemente al riposo.'],
  pl: ['Witaj ponownie. Znajdź wygodną pozycję i pozwól ciału się ułożyć.', 'Wdychaj powoli przez nos.', 'I delikatnie wypuść, pozwalając ramionom zmięknąć.', 'Zauważ cichą przestrzeń, która otwiera się z każdym oddechem.', 'Nie musisz teraz nic robić, nie ma dokąd iść.', 'Pozwól, by ten spokój łagodnie poniósł cię do snu.'],
  pt: ['Bem-vinda de volta. Encontra uma posição confortável e deixa o teu corpo assentar.', 'Inspira lentamente pelo nariz.', 'E solta-o suavemente, deixando os ombros relaxarem.', 'Repara no espaço calmo que se abre a cada respiração.', 'Não há nada a fazer agora, nenhum lugar onde estar.', 'Deixa esta calma levar-te suavemente ao descanso.'],
  tr: ['Tekrar hoş geldin. Rahat bir pozisyon bul ve bedeninin yerleşmesine izin ver.', 'Burnundan yavaşça nefes al.', 'Ve omuzlarını yumuşatarak nazikçe bırak.', 'Her nefeste açılan sessiz alanı fark et.', 'Şu anda yapman gereken hiçbir şey yok, gidecek hiçbir yer yok.', 'Bu huzurun seni nazikçe dinlenmeye taşımasına izin ver.'],
}

// Per-cell localization diagnostics (keyed by ORIGINAL seg index : lang) for the
// audio-review gate. Re-keyed by segment_id at synth time.
const LOC_OVERRIDES = {
  '1:tr': { needs_attention: 'TRUE', shorten_retries_in_synthesize: 3, final_speed: 1.15, real_duration_sec: 4.5 },
  '2:fr': { needs_attention: 'TRUE', borrowed_sec: 0 },
  '4:es': { needs_attention: 'REVIEW', last_regen_at: '2026-06-14 14:32:10', regen_comment: 'переписала фразу коротше' },
}

const STT_MS = 4000
const TRANSLATE_MS = 5000
const SYNTH_STEP_MS = 2500 // reveal one more language every ~step
const RENDER_MS = 4000 // stitching per-segment audio → full per-lang file

const { STT, TRANSLATE, SYNTH, RENDER, DONE } = PIPELINE_STAGES
const { RUNNING, REVIEW, APPROVED } = STAGE_STATUS

function pad(n) { return String(n + 1).padStart(3, '0') }

// Even word-level timing from text + slot — enough for a defensible split point.
function makeWords(text, start, end) {
  const toks = String(text).split(/\s+/).filter(Boolean)
  if (!toks.length) return []
  const per = Math.max(0.001, (end - start) / toks.length)
  return toks.map((w, i) => ({
    word: w.replace(/[.,!?;:¡¿]/g, '').toLowerCase(),
    punctuated_word: w,
    start: +(start + i * per).toFixed(3),
    end: +(start + (i + 1) * per).toFixed(3),
  }))
}

function freshSegments() {
  const lid = S.lessonId || LESSON
  return SEED.map((s, i) => ({
    segment_id: `${lid}_seg_${pad(i)}`,
    en_text: s.en,
    en_start_sec: s.start,
    en_end_sec: s.end,
    segment_type: s.type,
    movement_keywords: s.move,
    words: makeWords(s.en, s.start, s.end),
    tr: Object.fromEntries(DEFAULT_LANGS.map((l) => [l, TRANSLATIONS[l][i]])),
    origIndex: i, // for LOC_OVERRIDES lookup; lost on merge/split (→ clean cells)
  }))
}

function idle() {
  return {
    runToken: '',
    pipeline_stage: '',
    stage_status: '',
    stageRunToken: '',
    lessonId: null,
    runningSince: 0,
    segments: [],
    activeLangs: [...DEFAULT_LANGS], // languages this run localizes (from pre-flight)
    revealedTranslations: false,
    revealedLangs: 0, // count of (active) langs whose per-segment synth output is revealed
    revealedFull: false, // full per-lang files exist only after the RENDER step
    renderDest: '', // where the assembled full file is saved (chosen at the render gate)
    locEdits: {}, // rowKey → { col: value } operator edits at audio review
    busy: false,
  }
}

let S = idle()

// Live config/voice overrides applied via "start from archive" (persist across
// runs, like editing the real config/voices tables). Stage/run keys are excluded.
let configOverrides = {}
let voiceOverrides = {} // lang → { field: value }
const APPLY_DENY = new Set(['pipeline_stage', 'stage_status', 'stage_run_token', 'localization_run_token', 'localization_abort_token', 'active_langs'])

function renumber() {
  const lid = S.lessonId || LESSON
  S.segments.forEach((seg, i) => { seg.segment_id = `${lid}_seg_${pad(i)}` })
}

// ── public: lifecycle / transitions ────────────────────────────────────────

/** Start a staged run from the UI drop-in. Refused if a run is already active. */
export function startStagedRun(now, lessonId, langs) {
  if (S.busy) return { ok: false, error: 'Зайнято — staged-ран уже активний. Заверши поточний урок.' }
  const token = new Date(now).toISOString()
  const picked = Array.isArray(langs) && langs.length
    ? DEFAULT_LANGS.filter((l) => langs.includes(l)) // keep canonical order, drop unknowns
    : [...DEFAULT_LANGS]
  S = idle()
  S.busy = true
  S.runToken = token
  S.stageRunToken = token
  S.lessonId = lessonId || LESSON
  S.activeLangs = picked.length ? picked : [...DEFAULT_LANGS]
  S.pipeline_stage = STT
  S.stage_status = RUNNING
  S.runningSince = now
  S.segments = freshSegments() // STT "streams" segments immediately; gate is stage_status
  return { ok: true, lessonId: S.lessonId, langs: S.activeLangs, runToken: token }
}

/** Advance RUNNING phases on the wall clock. Called every poll with `now`. */
export function tick(now) {
  if (!S.busy || S.stage_status !== RUNNING) return
  const elapsed = now - S.runningSince
  if (S.pipeline_stage === STT && elapsed >= STT_MS) {
    S.stage_status = REVIEW
  } else if (S.pipeline_stage === TRANSLATE && elapsed >= TRANSLATE_MS) {
    S.revealedTranslations = true
    S.stage_status = REVIEW
  } else if (S.pipeline_stage === SYNTH) {
    S.revealedLangs = Math.min(S.activeLangs.length, Math.floor(elapsed / SYNTH_STEP_MS))
    if (S.revealedLangs >= S.activeLangs.length) S.stage_status = REVIEW
  } else if (S.pipeline_stage === RENDER && elapsed >= RENDER_MS) {
    // full per-lang files are stitched from the (reviewed) segments → lesson done
    S.revealedFull = true
    S.pipeline_stage = DONE
    S.stage_status = REVIEW
    S.busy = false
  }
}

/** Approve a review gate → start the next stage (or finish). Idempotent: a
 *  second click while not in REVIEW is a no-op conflict. */
export function approve(stage, now) {
  if (S.stage_status !== REVIEW || S.pipeline_stage !== stage) {
    return { ok: false, conflict: true, error: `етап не на перевірці (${S.pipeline_stage}/${S.stage_status})` }
  }
  if (stage === STT) {
    S.pipeline_stage = TRANSLATE; S.stage_status = RUNNING; S.runningSince = now
  } else if (stage === TRANSLATE) {
    S.pipeline_stage = SYNTH; S.stage_status = RUNNING; S.runningSince = now; S.revealedLangs = 0
  } else if (stage === SYNTH) {
    // approving the segment review opens the separate "assemble full file" gate
    // (operator picks the save destination there, then builds)
    S.pipeline_stage = RENDER; S.stage_status = REVIEW
  } else {
    return { ok: false, error: `невідомий етап ${stage}` }
  }
  return { ok: true, fired: false, stage: S.pipeline_stage, status: S.stage_status }
}

// Destination presets for the assemble-file step (where the full file is saved).
function renderDestPresets(lid) {
  return [`Drive · 04_output/${lid}`, `Drive · 04_output (спільна тека готових)`, `Drive · staged_output/${lid}`]
}

/** Plan for the assemble-file step: files to build, save destination, presets. */
export function renderPlan() {
  const lid = S.lessonId || LESSON
  const langs = S.activeLangs || []
  const files = langs.flatMap((l) => [`${lid}_full_${l}.wav`, `${lid}_full_${l}.vtt`])
  const presets = renderDestPresets(lid)
  return { lessonId: lid, langs, files, destination: S.renderDest || presets[0], presets, built: !!S.revealedFull }
}

/** Start the separate "assemble full file" step after the render gate: record the
 *  chosen destination, then the per-lang full files stitch on the wall clock (tick). */
export function startRender(now, destination) {
  if (S.pipeline_stage !== RENDER || S.stage_status !== REVIEW) {
    return { ok: false, conflict: true, error: `склейка не на воротах (${S.pipeline_stage}/${S.stage_status})` }
  }
  const dest = String(destination || '').trim() || renderDestPresets(S.lessonId || LESSON)[0]
  S.renderDest = dest
  S.stage_status = RUNNING
  S.runningSince = now
  return { ok: true, destination: dest }
}

/** Run-lock demo: report whether a new drop would be refused right now. */
export function secondDropProbe() {
  if (S.busy) return { ok: false, error: 'Зайнято — staged-ран активний, новий файл відхилено (run-lock).', busy: true }
  return { ok: true, busy: false }
}

/** Apply a past run's settings snapshot to the live config/voices/prompt
 *  ("start from archive"). Stage/run keys are never applied. Returns the
 *  snapshot's activeLangs so the pre-flight can pre-select them. */
export function applySettings(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return { ok: false, error: 'порожній знімок' }
  for (const [k, v] of Object.entries(snapshot.config || {})) {
    if (APPLY_DENY.has(k)) continue
    configOverrides[k] = String(v)
  }
  for (const v of snapshot.voices || []) {
    if (!v || !v.lang) continue
    const { lang, ...fields } = v
    voiceOverrides[lang] = { ...(voiceOverrides[lang] || {}), ...fields }
  }
  if (typeof snapshot.aiPrompt === 'string' && snapshot.aiPrompt.trim()) setAiPrompt(snapshot.aiPrompt)
  return { ok: true, activeLangs: Array.isArray(snapshot.activeLangs) ? snapshot.activeLangs : [] }
}

// ── public: operator writes ─────────────────────────────────────────────────

// Voice tab edits (single card save + "apply voice set/template"). Mirrors the
// override that `applySettings` uses, so `tabs()` surfaces the change.
export function writeVoiceCells(lang, updates) {
  if (!lang) throw new Error('не вказано мову')
  const fields = {}
  for (const [k, v] of Object.entries(updates || {})) if (v != null) fields[k] = String(v)
  if (!Object.keys(fields).length) throw new Error('немає валідних полів для запису')
  voiceOverrides[lang] = { ...(voiceOverrides[lang] || {}), ...fields }
  return { lang, written: Object.keys(fields).length }
}

// Config tab edits (cps_estimate_*, etc.). expected/conflict is a live-only guard.
export function writeConfigCell(key, value) {
  if (!key) throw new Error('не вказано ключ')
  configOverrides[key] = String(value)
  return { key, value: String(value) }
}

// Retime one segment's EN slot (drag the timeline edges under the video). Clamps
// to neighbours so segments stay monotonic & non-overlapping; en_duration_sec is
// derived from start/end in tabs(), so we only store start/end. Transcript stage
// only (timing feeds length budgets + the synth slot).
export function retimeSegment(segmentId, enStart, enEnd) {
  const i = S.segments.findIndex((s) => s.segment_id === segmentId)
  if (i < 0) throw new Error(`сегмент ${segmentId} не знайдено`)
  const prevEnd = i > 0 ? Number(S.segments[i - 1].en_end_sec) : 0
  const nextStart = i < S.segments.length - 1 ? Number(S.segments[i + 1].en_start_sec) : AUDIO_DURATION
  const s = Math.max(prevEnd, Number(enStart))
  const e = Math.min(nextStart, Number(enEnd))
  if (!(e - s >= 0.2)) {
    return { ok: false, conflict: true, error: 'край перекриває сусіда або сегмент закороткий (мін. 0.2с)' }
  }
  const seg = S.segments[i]
  seg.en_start_sec = +s.toFixed(3)
  seg.en_end_sec = +e.toFixed(3)
  return { ok: true, segmentId, enStart: seg.en_start_sec, enEnd: seg.en_end_sec, durationSec: +(e - s).toFixed(3) }
}

// Loudness-normalize the given dub segments to `targetLufs`. Mock: just records
// the target on each row (a badge); real R128 gain happens server-side on live.
export function normalizeSegments(rowKeys, targetLufs) {
  const lufs = Number(targetLufs)
  const t = Number.isFinite(lufs) ? lufs : -23
  let n = 0
  for (const rk of rowKeys || []) {
    if (!rk) continue
    if (!S.locEdits[rk]) S.locEdits[rk] = {}
    S.locEdits[rk].normalized_lufs = t
    n++
  }
  return { ok: true, normalized: n, targetLufs: t }
}

export function writeSegmentCells(targets) {
  let written = 0
  const missing = []
  for (const t of targets) {
    const seg = S.segments.find((s) => s.segment_id === t.segmentId)
    if (!seg) { missing.push(`row:${t.segmentId}`); continue }
    if (t.col === 'en_text') { seg.en_text = t.value; written++ }
    else if (/^[a-z]{2}_text$/.test(t.col)) { seg.tr[t.col.slice(0, 2)] = t.value; written++ }
    else missing.push(`col:${t.col}`)
  }
  if (!written) throw new Error(`жоден рядок не зматчився (${missing.join(', ')})`)
  return { written, missing }
}

export function mergeSegments(segmentId) {
  const idx = S.segments.findIndex((s) => s.segment_id === segmentId)
  if (idx < 0) throw new Error(`сегмент ${segmentId} не знайдено`)
  if (idx >= S.segments.length - 1) throw new Error('останній сегмент не можна злити з наступним')
  const a = S.segments[idx]
  const b = S.segments[idx + 1]
  a.en_text = `${a.en_text} ${b.en_text}`.trim()
  a.en_end_sec = b.en_end_sec
  a.words = [...a.words, ...b.words]
  a.segment_type = a.segment_type || b.segment_type
  a.movement_keywords = [a.movement_keywords, b.movement_keywords].filter(Boolean).join(', ')
  // concat translations too (mock stand-in for W2 re-translating the merged span)
  for (const l of DEFAULT_LANGS) a.tr[l] = [a.tr[l], b.tr[l]].map((s) => String(s || '').trim()).filter(Boolean).join(' ')
  a.origIndex = undefined
  S.segments.splice(idx + 1, 1)
  renumber()
  return { ok: true, segments: S.segments.length }
}

export function splitSegment(segmentId, wordIndex) {
  const idx = S.segments.findIndex((s) => s.segment_id === segmentId)
  if (idx < 0) throw new Error(`сегмент ${segmentId} не знайдено`)
  const seg = S.segments[idx]
  const w = seg.words
  const k = Number(wordIndex)
  if (!Number.isInteger(k) || k < 0 || k >= w.length - 1) {
    throw new Error('некоректна точка розділу (потрібна межа між словами всередині сегмента)')
  }
  const left = w.slice(0, k + 1)
  const right = w.slice(k + 1)
  // split each language's translation proportionally to the EN word ratio, so
  // both halves stay "translated" (mock stand-in for W2 re-translating).
  const ratio = (k + 1) / w.length
  const splitTr = (s) => {
    const tw = String(s || '').split(/\s+/).filter(Boolean)
    if (tw.length < 2) return [String(s || ''), '']
    const cut = Math.max(1, Math.min(tw.length - 1, Math.round(ratio * tw.length)))
    return [tw.slice(0, cut).join(' '), tw.slice(cut).join(' ')]
  }
  const leftTr = {}, rightTr = {}
  for (const l of DEFAULT_LANGS) { const [a, b] = splitTr(seg.tr[l]); leftTr[l] = a; rightTr[l] = b }
  const mk = (wds, type, move, tr) => ({
    segment_id: 'tmp', en_text: wds.map((x) => x.punctuated_word).join(' '),
    en_start_sec: wds[0].start, en_end_sec: wds[wds.length - 1].end,
    segment_type: type, movement_keywords: move, words: wds, tr, origIndex: undefined,
  })
  const leftSeg = mk(left, seg.segment_type, seg.movement_keywords, leftTr)
  const rightSeg = mk(right, seg.segment_type, '', rightTr)
  S.segments.splice(idx, 1, leftSeg, rightSeg)
  renumber()
  return { ok: true, segments: S.segments.length }
}

export function writeLocalizationCells(targets) {
  let written = 0
  for (const t of targets) {
    if (!S.locEdits[t.rowKey]) S.locEdits[t.rowKey] = {}
    S.locEdits[t.rowKey][t.col] = t.value
    written++
  }
  return { written, missing: [] }
}

// ── public: snapshot projections (shaped like Sheets batchGet / Drive list) ──

export function tabs() {
  const baseConfig = {
    localization_run_token: S.runToken,
    localization_abort_token: '',
    pipeline_stage: S.pipeline_stage,
    stage_status: S.stage_status,
    stage_run_token: S.stageRunToken,
    active_langs: S.activeLangs.join(','),
    w_regen_workflow_url: 'https://n8n.example/webhook/w-regen',
    w2_translate_workflow_url: '',
    w3_dispatch_workflow_url: '',
    drive_staged_input_folder_id: '',
    drive_input_folder_id: 'mock_input_folder',
    drive_output_folder_id: 'mock_output_folder',
    drive_output_full_folder_id: 'mock_full_folder',
    drive_output_vtt_folder_id: 'mock_vtt_folder',
    drive_archive_folder_id: 'mock_archive_folder',
    slack_channel: '#dubbing',
    min_inter_segment_gap_sec: 0.4,
    max_borrow_per_segment_sec: 2.0,
    movement_borrow_max_sec: 2.0,
    expansion_threshold: 0.85,
    cps_estimate_de: 14, cps_estimate_es: 15, cps_estimate_fr: 13.5, cps_estimate_it: 14,
    cps_estimate_pl: 13, cps_estimate_pt: 14, cps_estimate_tr: 13,
    gemini_api_key: '', // empty in mock → LLM lane stays canned
    elevenlabs_api_key: 'sk_live_THIS_SHOULD_BE_MASKED',
    anthropic_api_key: 'sk-ant-THIS_SHOULD_BE_MASKED',
  }
  Object.assign(baseConfig, configOverrides) // "start from archive" tuning
  const config = [['key', 'value'], ...Object.entries(baseConfig)]

  const segHeader = [
    'segment_id', 'en_text', 'en_start_sec', 'en_end_sec', 'en_duration_sec', 'audio_duration_sec',
    'segment_type', 'movement_keywords',
    ...DEFAULT_LANGS.map((l) => `${l}_text`),
    ...DEFAULT_LANGS.map((l) => `${l}_adaptation_attempts`),
    'adaptation_attempts', 'status',
  ]
  const segRows = S.segments.map((seg) => [
    seg.segment_id, seg.en_text, seg.en_start_sec, seg.en_end_sec,
    +(seg.en_end_sec - seg.en_start_sec).toFixed(3), AUDIO_DURATION,
    seg.segment_type, seg.movement_keywords,
    ...DEFAULT_LANGS.map((l) => (S.revealedTranslations ? (seg.tr[l] || mockTranslate(seg.en_text, l)) : '')),
    ...DEFAULT_LANGS.map(() => 0),
    0, 'pending',
  ])

  const locHeader = [
    'row_key', 'segment_id', 'lang', 'text_translated', 'en_start_sec', 'en_duration_sec',
    'real_duration_sec', 'lead_silence_sec', 'slot_start_sec', 'slot_end_sec', 'tts_budget_sec',
    'tail_silence_sec', 'final_duration_sec', 'borrowed_sec', 'expansion_attempts',
    'shorten_retries_in_synthesize', 'final_speed', 'needs_attention', 'audio_drive_file_id',
    'phase2_outcome', 'needs_retts', 'last_regen_at', 'regen_comment', 'normalized_lufs',
  ]
  const revealed = S.activeLangs.slice(0, S.revealedLangs)
  const locRows = []
  S.segments.forEach((seg) => {
    const dur = +(seg.en_end_sec - seg.en_start_sec).toFixed(3)
    revealed.forEach((l) => {
      const rowKey = `${seg.segment_id}_${l}`
      const o = (seg.origIndex != null && LOC_OVERRIDES[`${seg.origIndex}:${l}`]) || {}
      const edit = S.locEdits[rowKey] || {}
      const base = {
        row_key: rowKey, segment_id: seg.segment_id, lang: l,
        text_translated: seg.tr[l] || mockTranslate(seg.en_text, l),
        en_start_sec: seg.en_start_sec, en_duration_sec: dur,
        real_duration_sec: o.real_duration_sec ?? +(dur - 0.2).toFixed(2),
        lead_silence_sec: 0.1, slot_start_sec: seg.en_start_sec, slot_end_sec: seg.en_end_sec,
        tts_budget_sec: +(dur - 0.1).toFixed(2), tail_silence_sec: 0.1, final_duration_sec: dur,
        borrowed_sec: o.borrowed_sec ?? 0, expansion_attempts: 0,
        shorten_retries_in_synthesize: o.shorten_retries_in_synthesize ?? 0,
        final_speed: o.final_speed ?? 1.0, needs_attention: o.needs_attention ?? 'FALSE',
        audio_drive_file_id: `mock_file_${seg.segment_id}_${l}`, phase2_outcome: 'accepted',
        needs_retts: 'FALSE', last_regen_at: o.last_regen_at ?? '', regen_comment: o.regen_comment ?? '',
        normalized_lufs: o.normalized_lufs ?? '',
      }
      Object.assign(base, edit) // operator verdicts/edits win
      locRows.push(locHeader.map((h) => base[h] ?? ''))
    })
  })

  const voiceHeader = ['lang', 'voice_id', 'voice_name', 'model', 'stability', 'similarity_boost', 'style', 'speed', 'notes']
  const voiceRows = DEFAULT_LANGS.map((l) => {
    const v = { ...VOICE_SEED[l], ...(voiceOverrides[l] || {}) }
    return voiceHeader.map((h) => (h === 'lang' ? l : v[h] ?? ''))
  })

  const promptHeader = ['key', 'description', 'value']
  const promptRows = [
    ['tone_of_voice', 'Global tone of voice doc', 'Warm, calm, intimate. Speak softly to one listener...'],
    ['translate_system', 'Translation system prompt', 'You translate wellness scripts. Preserve {{tone_of_voice}}...'],
  ]

  return {
    config,
    segments: [segHeader, ...segRows],
    localizations: [locHeader, ...locRows],
    voices: [voiceHeader, ...voiceRows],
    prompts: [promptHeader, ...promptRows],
  }
}

export function drive() {
  // Full per-lang files appear only after the RENDER step (stitched from segments).
  const lid = S.lessonId || LESSON
  const fullLangs = S.revealedFull ? S.activeLangs : []
  const full = fullLangs.map((l) => ({
    id: `mock_full_${l}`, name: `${lid}_full_${l}.wav`, size: '58000044',
    md5Checksum: `mockmd5full${l}_${S.runToken}`, modifiedTime: S.runToken, mimeType: 'audio/wav',
  }))
  const vtt = fullLangs.map((l) => ({
    id: `mock_vtt_${l}`, name: `${lid}_full_${l}.vtt`, size: '2200',
    md5Checksum: `mockmd5vtt${l}_${S.runToken}`, modifiedTime: S.runToken, mimeType: 'text/vtt',
  }))
  const input = S.runToken
    ? [{ id: 'mock_input_src', name: `${S.lessonId}.wav`, size: '9800000', md5Checksum: 'mockmd5src', modifiedTime: S.runToken, mimeType: 'audio/wav' }]
    : []
  return { input, full, vtt }
}

/** Word-level timing fixture for the transcript split UI (Etap P: a Drive JSON). */
export function words(segmentId) {
  const seg = S.segments.find((s) => s.segment_id === segmentId)
  return seg ? seg.words : null
}

/** EN segment region (for the transcript-stage audio player resolver). */
export function segmentRegion(segmentId) {
  const seg = S.segments.find((s) => s.segment_id === segmentId)
  if (!seg) return null
  return { start: seg.en_start_sec, end: seg.en_end_sec }
}

export function currentStatus() {
  return { pipeline_stage: S.pipeline_stage, stage_status: S.stage_status, busy: S.busy, runToken: S.runToken }
}

// ── editable AI translation-check prompt ────────────────────────────────────
// Module-level (persists across runs, like a config/prompts setting). On Etap P
// this maps to a `prompts` tab key; the deterministic checks (length-fit,
// formality) ignore it — it drives only the LLM lane.
const DEFAULT_AI_PROMPT = `Ти — рецензент якості локалізації медитаційних/велнес-уроків. Мова перекладу: {{lang}}.
Тобі дають пари: en — англійський оригінал, t — переклад мовою {{lang}}.
Перевір УВЕСЬ урок за критеріями:
1. formality — звертання має бути на «ти» (informal) і послідовним; «ви» — помилка.
2. gender — рід звертання до слухача не має змішуватися в межах уроку.
3. false_friend — хибні друзі та смислові розбіжності з оригіналом.
4. naturalness — неприродні, калькові або кострубаті фрази.

Поверни ЛИШЕ JSON: {"findings":[{"segment_id":"<id>","type":"formality|gender|false_friend|naturalness","severity":"high|medium|low","issue":"<коротко українською>","suggestion":"<виправлений переклад>"}]}
Лише справжні проблеми, без стилістичних дрібниць. Якщо чисто — {"findings":[]}.`

let aiPrompt = DEFAULT_AI_PROMPT
export const getAiPrompt = () => aiPrompt
export const getDefaultAiPrompt = () => DEFAULT_AI_PROMPT
export function setAiPrompt(v) { aiPrompt = String(v ?? '').slice(0, 20000); return { ok: true } }

function mockTranslate(en, lang) {
  return `«${en}» (${lang})`
}
