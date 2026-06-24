import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { DEFAULT_LANGS, PIPELINE_STAGES, STAGE_STATUS } from '../constants.js'

/**
 * Stateful MOCK simulator for the STAGED flow (Etap M), now MULTI-PROJECT.
 *
 * Each project is its own dataset + run state, kept in a registry keyed by
 * projectId, with an `activeProjectId` pointer. Every exported function operates
 * on the ACTIVE project — the snapshot reads `tabs()`/`drive()` exactly like the
 * live Sheets/Drive path, so the same parser + state machine run in mock and live.
 * Switching the active project (via setActiveProject) is what makes the whole UI
 * show a different lesson; nothing destructive happens between projects.
 *
 * The live n8n pipeline is NOT touched — this only exercises the UI.
 */

const LESSON = 'sleep_002'

// Realistic-looking voice config per lang (so pre-flight readiness is green by
// default; clearing a voice_id in /voices makes that lang flag as not-ready).
// Shared across datasets — voices are per-language operator config, not per-lesson.
const VOICE_SEED = {
  de: { voice_id: 'pNInz6obpgDQGcFmaJgB', voice_name: 'Hanna', model: 'eleven_multilingual_v2', stability: 0.5, similarity_boost: 0.75, style: 0, speed: 1.0, notes: '' },
  es: { voice_id: 'EXAVITQu4vr4xnSDxMaL', voice_name: 'Lucía', model: 'eleven_multilingual_v2', stability: 0.5, similarity_boost: 0.75, style: 0, speed: 1.0, notes: '' },
  fr: { voice_id: 'XB0fDUnXU5powFXDhCwa', voice_name: 'Charlotte', model: 'eleven_multilingual_v2', stability: 0.55, similarity_boost: 0.75, style: 0, speed: 0.86, notes: 'повільніший голос' },
  it: { voice_id: 'XrExE9yKIg1WjnnlVkGX', voice_name: 'Matilda', model: 'eleven_multilingual_v2', stability: 0.5, similarity_boost: 0.75, style: 0, speed: 1.0, notes: '' },
  pl: { voice_id: 'AZnzlk1XvdvUeBnXmlld', voice_name: 'Zofia', model: 'eleven_multilingual_v2', stability: 0.5, similarity_boost: 0.75, style: 0, speed: 1.0, notes: '' },
  pt: { voice_id: 'TxGEqnHWrfWFTfGW9XjX', voice_name: 'Beatriz', model: 'eleven_multilingual_v2', stability: 0.5, similarity_boost: 0.75, style: 0, speed: 1.0, notes: '' },
  tr: { voice_id: 'jsCqWAovK2LkecY7zXl4', voice_name: 'Elif', model: 'eleven_multilingual_v2', stability: 0.5, similarity_boost: 0.75, style: 0, speed: 1.0, notes: '' },
}

// ── Datasets: one per demo lesson (the "sheet-per-project" content). Each carries
// its own EN source, index-aligned translations, voice config + per-cell defects.
// `sleep_002` is the original single-lesson fixture; the others give the project
// list real variety. New projects created from the UI clone DEFAULT_TEMPLATE.
const DATASETS = {
  sleep_002: {
    lesson: 'sleep_002',
    audioDuration: 37.1,
    voiceSeed: VOICE_SEED,
    // Canonical EN source (as if W1/Deepgram produced it).
    seed: [
      { en: 'Welcome back. Find a comfortable position and let your body settle.', start: 0.0, end: 6.4, type: 'narrative', move: '' },
      { en: 'Take a slow breath in through your nose.', start: 6.8, end: 11.2, type: 'movement', move: 'inhale' },
      { en: 'And gently release it, letting your shoulders soften.', start: 11.6, end: 17.5, type: 'movement', move: 'exhale' },
      { en: 'Notice the quiet space that opens up with each breath.', start: 18.0, end: 24.2, type: 'narrative', move: '' },
      { en: 'There is nothing you need to do right now, nowhere to be.', start: 24.6, end: 31.0, type: 'narrative', move: '' },
      { en: 'Let this calm carry you gently into rest.', start: 31.4, end: 37.1, type: 'narrative', move: '' },
    ],
    // Canonical translations (index-aligned to seed). A couple carry deliberate
    // defects so the gate scoring has something to flag: de[0] uses formal "Sie",
    // fr[4] is overlong for its slot.
    translations: {
      de: ['Willkommen zurück. Finden Sie eine bequeme Position und lassen Sie Ihren Körper zur Ruhe kommen.', 'Atme langsam durch die Nase ein.', 'Und lass ihn sanft los, während deine Schultern weich werden.', 'Bemerke den stillen Raum, der sich mit jedem Atemzug öffnet.', 'Es gibt nichts zu tun, nirgendwo zu sein.', 'Lass diese Ruhe dich sanft in den Schlaf tragen.'],
      es: ['Bienvenida de nuevo. Encuentra una posición cómoda y deja que tu cuerpo se asiente.', 'Inhala lentamente por la nariz.', 'Y suéltalo con suavidad, dejando que tus hombros se relajen.', 'Nota el espacio tranquilo que se abre con cada respiración.', 'No hay nada que hacer ahora, ningún lugar donde estar.', 'Deja que esta calma te lleve suavemente al descanso.'],
      fr: ['Bienvenue. Trouve une position confortable et laisse ton corps se poser.', 'Inspire lentement par le nez.', 'Et relâche doucement, en laissant tes épaules se détendre.', 'Remarque l’espace calme qui s’ouvre à chaque souffle.', 'Il n’y a absolument rien que tu aies besoin de faire en cet instant précis, et il n’existe nul autre endroit où il te faudrait être maintenant.', 'Laisse ce calme te porter doucement vers le repos.'],
      it: ['Bentornata. Trova una posizione comoda e lascia che il corpo si assesti.', 'Inspira lentamente dal naso.', 'E rilascialo dolcemente, lasciando ammorbidire le spalle.', 'Nota lo spazio silenzioso che si apre a ogni respiro.', 'Non c’è nulla da fare ora, nessun posto dove essere.', 'Lascia che questa calma ti porti dolcemente al riposo.'],
      pl: ['Witaj ponownie. Znajdź wygodną pozycję i pozwól ciału się ułożyć.', 'Wdychaj powoli przez nos.', 'I delikatnie wypuść, pozwalając ramionom zmięknąć.', 'Zauważ cichą przestrzeń, która otwiera się z każdym oddechem.', 'Nie musisz teraz nic robić, nie ma dokąd iść.', 'Pozwól, by ten spokój łagodnie poniósł cię do snu.'],
      pt: ['Bem-vinda de volta. Encontra uma posição confortável e deixa o teu corpo assentar.', 'Inspira lentamente pelo nariz.', 'E solta-o suavemente, deixando os ombros relaxarem.', 'Repara no espaço calmo que se abre a cada respiração.', 'Não há nada a fazer agora, nenhum lugar onde estar.', 'Deixa esta calma levar-te suavemente ao descanso.'],
      tr: ['Tekrar hoş geldin. Rahat bir pozisyon bul ve bedeninin yerleşmesine izin ver.', 'Burnundan yavaşça nefes al.', 'Ve omuzlarını yumuşatarak nazikçe bırak.', 'Her nefeste açılan sessiz alanı fark et.', 'Şu anda yapman gereken hiçbir şey yok, gidecek hiçbir yer yok.', 'Bu huzurun seni nazikçe dinlenmeye taşımasına izin ver.'],
    },
    // Per-cell localization diagnostics (keyed by ORIGINAL seg index : lang).
    locOverrides: {
      '1:tr': { needs_attention: 'TRUE', shorten_retries_in_synthesize: 3, final_speed: 1.15, real_duration_sec: 4.5 },
      '2:fr': { needs_attention: 'TRUE', borrowed_sec: 0 },
      '4:es': { needs_attention: 'REVIEW', last_regen_at: '2026-06-14 14:32:10', regen_comment: 'переписала фразу коротше' },
    },
  },

  morning_light: {
    lesson: 'morning_light',
    audioDuration: 21.2,
    voiceSeed: VOICE_SEED,
    seed: [
      { en: 'Good morning. Gently open your eyes and greet the new day.', start: 0.0, end: 5.4, type: 'narrative', move: '' },
      { en: 'Stretch your arms above your head and take a deep breath.', start: 5.8, end: 10.6, type: 'movement', move: 'stretch' },
      { en: 'Feel the morning light warming your skin.', start: 11.0, end: 15.4, type: 'narrative', move: '' },
      { en: 'Carry this calm energy with you into the day.', start: 15.8, end: 21.2, type: 'narrative', move: '' },
    ],
    translations: {
      de: ['Guten Morgen. Öffne sanft deine Augen und begrüße den neuen Tag.', 'Strecke die Arme über den Kopf und atme tief ein.', 'Spüre, wie das Morgenlicht deine Haut wärmt.', 'Nimm diese ruhige Energie mit in den Tag.'],
      es: ['Buenos días. Abre suavemente los ojos y saluda al nuevo día.', 'Estira los brazos por encima de la cabeza y respira hondo.', 'Siente cómo la luz de la mañana calienta tu piel.', 'Lleva esta energía tranquila contigo durante el día.'],
      fr: ['Bonjour. Ouvre doucement les yeux et accueille le nouveau jour.', 'Étire les bras au-dessus de la tête et respire profondément.', 'Sens la lumière du matin réchauffer ta peau.', 'Emporte cette énergie calme avec toi dans la journée.'],
      it: ['Buongiorno. Apri dolcemente gli occhi e accogli il nuovo giorno.', 'Allunga le braccia sopra la testa e fai un respiro profondo.', 'Senti la luce del mattino che scalda la tua pelle.', 'Porta con te questa energia calma per tutta la giornata.'],
      pl: ['Dzień dobry. Delikatnie otwórz oczy i przywitaj nowy dzień.', 'Wyciągnij ramiona nad głowę i weź głęboki oddech.', 'Poczuj, jak poranne światło ogrzewa twoją skórę.', 'Zabierz tę spokojną energię ze sobą na cały dzień.'],
      pt: ['Bom dia. Abre suavemente os olhos e dá as boas-vindas ao novo dia.', 'Estica os braços acima da cabeça e respira fundo.', 'Sente a luz da manhã a aquecer a tua pele.', 'Leva esta energia calma contigo ao longo do dia.'],
      tr: ['Günaydın. Gözlerini nazikçe aç ve yeni güne merhaba de.', 'Kollarını başının üzerine uzat ve derin bir nefes al.', 'Sabah ışığının tenini ısıttığını hisset.', 'Bu sakin enerjiyi gün boyunca yanında taşı.'],
    },
    locOverrides: {
      '1:fr': { needs_attention: 'TRUE', shorten_retries_in_synthesize: 2, final_speed: 1.06, real_duration_sec: 4.2 },
      '3:tr': { needs_attention: 'REVIEW', regen_comment: 'скоротила фразу для темпу' },
    },
  },

  body_scan: {
    lesson: 'body_scan',
    audioDuration: 21.0,
    voiceSeed: VOICE_SEED,
    seed: [
      { en: 'Lie down comfortably and close your eyes.', start: 0.0, end: 4.6, type: 'narrative', move: '' },
      { en: 'Bring your attention to your feet and let them relax.', start: 5.0, end: 10.4, type: 'movement', move: 'relax' },
      { en: 'Slowly move your awareness up through your body.', start: 10.8, end: 16.2, type: 'narrative', move: '' },
      { en: 'Rest here, soft and completely at ease.', start: 16.6, end: 21.0, type: 'narrative', move: '' },
    ],
    translations: {
      de: ['Leg dich bequem hin und schließe die Augen.', 'Lenke deine Aufmerksamkeit auf deine Füße und lass sie locker werden.', 'Bewege deine Aufmerksamkeit langsam durch deinen Körper nach oben.', 'Ruhe hier, sanft und völlig entspannt.'],
      es: ['Recuéstate cómodamente y cierra los ojos.', 'Lleva tu atención a los pies y deja que se relajen.', 'Mueve lentamente tu conciencia hacia arriba por el cuerpo.', 'Descansa aquí, suave y completamente a gusto.'],
      fr: ['Allonge-toi confortablement et ferme les yeux.', 'Porte ton attention sur tes pieds et laisse-les se détendre.', 'Fais monter doucement ta conscience à travers ton corps.', 'Repose-toi ici, doux et parfaitement à l’aise.'],
      it: ['Sdraiati comodamente e chiudi gli occhi.', 'Porta l’attenzione ai piedi e lascia che si rilassino.', 'Sposta lentamente la consapevolezza verso l’alto attraverso il corpo.', 'Riposa qui, morbido e completamente a tuo agio.'],
      pl: ['Połóż się wygodnie i zamknij oczy.', 'Skieruj uwagę na stopy i pozwól im się rozluźnić.', 'Powoli przesuwaj swoją uwagę w górę przez całe ciało.', 'Odpocznij tutaj, miękko i zupełnie swobodnie.'],
      pt: ['Deita-te confortavelmente e fecha os olhos.', 'Leva a tua atenção aos pés e deixa-os relaxar.', 'Move lentamente a tua consciência para cima através do corpo.', 'Descansa aqui, suave e completamente à vontade.'],
      tr: ['Rahatça uzan ve gözlerini kapat.', 'Dikkatini ayaklarına yönelt ve gevşemelerine izin ver.', 'Farkındalığını yavaşça bedeninin yukarısına doğru taşı.', 'Burada dinlen, yumuşak ve tamamen huzurlu.'],
    },
    locOverrides: {
      '1:pl': { needs_attention: 'TRUE', borrowed_sec: 0 },
      '0:it': { needs_attention: 'REVIEW', last_regen_at: '2026-06-16 09:12:00' },
    },
  },
}

// Synthetic large lesson for UI stress-testing (many segments). Built by cycling
// the three hand-written datasets so every segment carries real 7-lang text; a few
// cells get needs_attention so the audio-review matrix shows realistic flags.
function buildLargeDataset(n) {
  const srcSeeds = [...DATASETS.sleep_002.seed, ...DATASETS.morning_light.seed, ...DATASETS.body_scan.seed]
  const srcTr = Object.fromEntries(DEFAULT_LANGS.map((l) => [l,
    [...DATASETS.sleep_002.translations[l], ...DATASETS.morning_light.translations[l], ...DATASETS.body_scan.translations[l]]]))
  const seed = []
  const translations = Object.fromEntries(DEFAULT_LANGS.map((l) => [l, []]))
  let t = 0
  for (let i = 0; i < n; i++) {
    const s = srcSeeds[i % srcSeeds.length]
    const dur = Math.max(2.5, +(s.end - s.start).toFixed(2))
    const start = +t.toFixed(2)
    const end = +(start + dur).toFixed(2)
    seed.push({ en: s.en, start, end, type: s.type, move: s.move })
    for (const l of DEFAULT_LANGS) translations[l].push(srcTr[l][i % srcTr[l].length])
    t = end + 0.4
  }
  const locOverrides = {}
  for (let i = 5; i < n; i += 12) locOverrides[`${i}:tr`] = { needs_attention: 'TRUE' }
  for (let i = 9; i < n; i += 19) locOverrides[`${i}:fr`] = { needs_attention: 'REVIEW' }
  return { lesson: 'large_demo', audioDuration: +t.toFixed(2), voiceSeed: VOICE_SEED, seed, translations, locOverrides }
}
DATASETS.large_demo = buildLargeDataset(105)

const DEFAULT_TEMPLATE = 'sleep_002'

const STT_MS = 4000
const TRANSLATE_MS = 5000
const SYNTH_STEP_MS = 2500 // reveal one more language every ~step
const RENDER_MS = 4000 // stitching per-segment audio → full per-lang file

const { STT, TRANSLATE, SYNTH, RENDER, DONE } = PIPELINE_STAGES
const { RUNNING, REVIEW, APPROVED } = STAGE_STATUS

function pad(n) { return String(n + 1).padStart(3, '0') }

// Deterministic mock STT (Deepgram) confidence per segment — mostly high, a few
// low/medium to exercise the transcript "low confidence → check this" UI.
function confFor(i) {
  const pat = [0.98, 0.94, 0.63, 0.97, 0.82, 0.99, 0.71, 0.96]
  return pat[i % pat.length]
}

// Deterministic mock per-WORD STT confidence: ~1 in 6 words low, so the transcript
// can highlight uncertain words (not the whole phrase). Stable per (word, index).
function wordConfFor(w, i) {
  const h = (i * 31 + String(w).length * 17) % 100
  if (h < 16) return +(0.5 + (h % 5) * 0.04).toFixed(2) // low: 0.50–0.66
  return +(0.88 + (h % 12) / 100).toFixed(2) // high: 0.88–0.99
}

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
    conf: wordConfFor(w, i),
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
    // Audio-timeline clips: each localization (rowKey) can be cut into independent
    // audio pieces the operator moves/trims/fades/deletes. Absent rowKey ⇒ one
    // default clip (the whole slot); empty array ⇒ all pieces deleted.
    clips: {}, // rowKey → Clip[]  (Clip: { id, start, end, srcStart, srcEnd, sourceDur, fadeIn, fadeOut })
    clipSeq: {}, // rowKey → next clip-id counter
    busy: false,
  }
}

// ── Editable AI translation-check prompt (per project). On Etap P this maps to a
// `prompts` tab key; the deterministic checks (length-fit, formality) ignore it.
const DEFAULT_AI_PROMPT = `Ти — рецензент якості локалізації медитаційних/велнес-уроків. Мова перекладу: {{lang}}.
Тобі дають пари: en — англійський оригінал, t — переклад мовою {{lang}}.
Перевір УВЕСЬ урок за критеріями:
1. formality — звертання має бути на «ти» (informal) і послідовним; «ви» — помилка.
2. gender — рід звертання до слухача не має змішуватися в межах уроку.
3. false_friend — хибні друзі та смислові розбіжності з оригіналом.
4. naturalness — неприродні, калькові або кострубаті фрази.

Поверни ЛИШЕ JSON: {"findings":[{"segment_id":"<id>","type":"formality|gender|false_friend|naturalness","severity":"high|medium|low","issue":"<коротко українською>","suggestion":"<виправлений переклад>"}]}
Лише справжні проблеми, без стилістичних дрібниць. Якщо чисто — {"findings":[]}.`

// ── Pipeline prompt templates — the REAL prompts, loaded from the repo's
// `sheets/prompts.tsv` (the `prompts` sheet export). On Etap P these come from the
// live prompts tab; here the sheet is the default, overridden per project. {{...}}
// markers are substituted by the pipeline. (The AI translation-check prompt is
// separate — see DEFAULT_AI_PROMPT / aiPrompt above.)
const PROMPTS_TSV = fileURLToPath(new URL('../../../sheets/prompts.tsv', import.meta.url))

// TSV with quoted multi-line fields (Google Sheets export: fields with tabs/newlines
// are double-quoted, internal quotes doubled).
function parseTSV(s) {
  const rows = []; let row = []; let cur = ''; let q = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (q) { if (c === '"') { if (s[i + 1] === '"') { cur += '"'; i++ } else q = false } else cur += c }
    else if (c === '"') q = true
    else if (c === '\t') { row.push(cur); cur = '' }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = '' }
    else if (c === '\r') { /* skip */ }
    else cur += c
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row) }
  return rows
}
// Group a prompt by its pipeline stage, parsed from the sheet description prefix.
function promptGroup(desc) {
  if (/DEPRECATED/i.test(desc)) return 'Deprecated'
  if (/^\s*W2\b/.test(desc)) return 'Translation (W2)'
  if (/^\s*W3\b/.test(desc)) return 'Synthesis timing (W3)'
  return 'Reference'
}
function loadPromptDefaults() {
  try {
    const rows = parseTSV(fs.readFileSync(PROMPTS_TSV, 'utf8'))
    const out = []
    for (let i = 1; i < rows.length; i++) {
      const [key, description = '', value = ''] = rows[i]
      if (!key) continue
      out.push({ key, group: promptGroup(description), description, value })
    }
    if (out.length) return out
  } catch { /* fall back below */ }
  // Fallback if the sheet export isn't present (keeps mock usable).
  return [
    { key: 'tone_of_voice', group: 'Reference', description: 'Brand tone-of-voice doc, referenced as {{tov}}.', value: 'Warm, calm, intimate. Speak softly to one listener ("you").' },
    { key: 'translate_system', group: 'Translation (W2)', description: 'Main translation system prompt.', value: 'You translate meditation/wellness scripts into {{lang}}. Preserve {{tov}}.' },
  ]
}
const PROMPT_DEFAULTS = loadPromptDefaults()
const PROMPT_DEFAULT_MAP = Object.fromEntries(PROMPT_DEFAULTS.map((p) => [p.key, p]))

// Stage/run keys that "start from archive" must never copy across.
const APPLY_DENY = new Set(['pipeline_stage', 'stage_status', 'stage_run_token', 'localization_run_token', 'localization_abort_token', 'active_langs'])

// ── project registry ─────────────────────────────────────────────────────────

function freshProjectState({ templateId, lessonId, langs } = {}) {
  return {
    S: idle(),
    configOverrides: {},
    voiceOverrides: {}, // lang → { field: value }
    promptOverrides: {}, // prompt key → edited value (over PROMPT_DEFAULTS)
    aiPrompt: DEFAULT_AI_PROMPT,
    templateId: DATASETS[templateId] ? templateId : DEFAULT_TEMPLATE,
    lessonId: lessonId || LESSON,
    seedLangs: Array.isArray(langs) && langs.length ? langs.filter(Boolean) : [...DEFAULT_LANGS],
  }
}

const projects = new Map() // projectId → ProjectState
let activeProjectId = null

/** The active project's state. Defensive bootstrap so the store is never empty
 *  (the real bootstrap is index.js bootstrapProjects; this is a safety net). */
function active() {
  if (!activeProjectId || !projects.has(activeProjectId)) {
    if (!projects.has('proj_1')) createProject('proj_1', { templateId: DEFAULT_TEMPLATE, lessonId: LESSON })
    activeProjectId = 'proj_1'
  }
  return projects.get(activeProjectId)
}

function ds(ps) { return DATASETS[ps.templateId] || DATASETS[DEFAULT_TEMPLATE] }

export function createProject(id, { templateId, lessonId, langs } = {}) {
  const ps = freshProjectState({ templateId, lessonId, langs })
  projects.set(id, ps)
  return { id, templateId: ps.templateId, lessonId: ps.lessonId }
}

export function setActiveProject(id) {
  if (!projects.has(id)) return { ok: false, error: `проєкт ${id} не існує в mock-сторі` }
  activeProjectId = id
  return { ok: true, id }
}

export function getActiveProject() { return activeProjectId }
export function hasProject(id) { return projects.has(id) }
export const templates = () => Object.keys(DATASETS)

/** Cheap LIVE run-state for ANY project (not just the active one) — derived
 *  straight from its in-memory stage fields. Lets the dashboard show an accurate
 *  cross-project board incl. projects advancing in the background. Returns a
 *  RUN_STATES-compatible string. */
export function liveState(id) {
  const ps = projects.get(id)
  if (!ps) return null
  const S = ps.S
  if (!S.runToken && !S.segments.length) return 'IDLE'
  if (S.pipeline_stage === DONE) return 'COMPLETE'
  if (S.stage_status === REVIEW) {
    if (S.pipeline_stage === STT) return 'TRANSCRIPT_REVIEW'
    if (S.pipeline_stage === TRANSLATE) return 'TRANSLATION_REVIEW'
    if (S.pipeline_stage === SYNTH) return 'AUDIO_REVIEW'
    if (S.pipeline_stage === RENDER) return 'RENDER_REVIEW'
  }
  if (S.stage_status === RUNNING) {
    if (S.pipeline_stage === STT) return 'STT'
    if (S.pipeline_stage === TRANSLATE) return 'TRANSLATING'
    if (S.pipeline_stage === SYNTH) return 'SYNTHESIZING'
    if (S.pipeline_stage === RENDER) return 'RENDERING'
  }
  return 'IDLE'
}

/** Cheap, static dataset facts for seeding a project's list-preview summary at
 *  bootstrap (before any snapshot poll). `attentionTrue` = count of pre-baked
 *  needs_attention=TRUE cells across the lesson. */
export function datasetMeta(templateId) {
  const d = DATASETS[templateId] || DATASETS[DEFAULT_TEMPLATE]
  const attentionTrue = Object.values(d.locOverrides).filter((o) => o.needs_attention === 'TRUE').length
  return { segCount: d.seed.length, langCount: DEFAULT_LANGS.length, attentionTrue }
}

/** Seed a project directly into a finished/review stage WITHOUT running the
 *  wall clock — used by bootstrap to make the project list realistic (one in
 *  audio review, one done). Uses a fixed token so computeRunState trusts it. */
export function seedAtStage(id, stage) {
  const ps = projects.get(id)
  if (!ps) return { ok: false, error: `проєкт ${id} не існує` }
  const token = '2026-06-18T10:00:00.000Z' // deterministic seed token (stage trust)
  const S = ps.S
  S.runToken = token
  S.stageRunToken = token
  S.lessonId = ps.lessonId
  S.activeLangs = [...ps.seedLangs]
  S.segments = freshSegments(ps)
  S.revealedTranslations = true
  S.revealedLangs = S.activeLangs.length
  S.busy = false
  if (stage === 'done') {
    S.pipeline_stage = DONE
    S.stage_status = REVIEW
    S.revealedFull = true
    S.renderDest = renderDestPresets(ps.lessonId)[0]
  } else { // 'audio_review'
    S.pipeline_stage = SYNTH
    S.stage_status = REVIEW
    S.revealedFull = false
  }
  return { ok: true }
}

/** Re-arm a DONE project to the audio-review gate so the per-segment review UI is
 *  available again (note: the regen cart already works in COMPLETE — this restores
 *  the GATE review screens, it is not a cart prerequisite). Tokens are kept so the
 *  state machine still treats it as the same staged run. */
export function rearmAudioReview() {
  const ps = active()
  const S = ps.S
  if (S.pipeline_stage !== DONE) return { ok: false, error: 'проєкт не завершено — перезбройка не потрібна' }
  S.pipeline_stage = SYNTH
  S.stage_status = REVIEW
  S.revealedLangs = S.activeLangs.length
  S.revealedFull = true // keep the assembled full files visible
  S.busy = false // gate states are not "busy" (must stay switchable)
  return { ok: true }
}

function freshSegments(ps) {
  const d = ds(ps)
  const lid = ps.S.lessonId || ps.lessonId || LESSON
  return d.seed.map((s, i) => ({
    segment_id: `${lid}_seg_${pad(i)}`,
    en_text: s.en,
    en_start_sec: s.start,
    en_end_sec: s.end,
    segment_type: s.type,
    movement_keywords: s.move,
    stt_confidence: confFor(i), // mock Deepgram confidence (transcript review)
    words: makeWords(s.en, s.start, s.end),
    tr: Object.fromEntries(DEFAULT_LANGS.map((l) => [l, d.translations[l]?.[i] ?? ''])),
    origIndex: i, // for locOverrides lookup; lost on merge/split (→ clean cells)
  }))
}

function renumber(ps) {
  const lid = ps.S.lessonId || ps.lessonId || LESSON
  ps.S.segments.forEach((seg, i) => { seg.segment_id = `${lid}_seg_${pad(i)}` })
}

// ── public: lifecycle / transitions ────────────────────────────────────────

/** Start a staged run on the ACTIVE project from the UI drop-in. Refused if a run
 *  is already active on this project. */
export function startStagedRun(now, lessonId, langs) {
  const ps = active()
  if (ps.S.busy) return { ok: false, error: 'Зайнято — staged-ран уже активний. Заверши поточний урок.' }
  const token = new Date(now).toISOString()
  const picked = Array.isArray(langs) && langs.length
    ? DEFAULT_LANGS.filter((l) => langs.includes(l)) // keep canonical order, drop unknowns
    : [...DEFAULT_LANGS]
  ps.S = idle()
  const S = ps.S
  S.busy = true
  S.runToken = token
  S.stageRunToken = token
  S.lessonId = lessonId || ps.lessonId || LESSON
  ps.lessonId = S.lessonId
  S.activeLangs = picked.length ? picked : [...DEFAULT_LANGS]
  S.pipeline_stage = STT
  S.stage_status = RUNNING
  S.runningSince = now
  S.segments = freshSegments(ps) // STT "streams" segments immediately; gate is stage_status
  return { ok: true, lessonId: S.lessonId, langs: S.activeLangs, runToken: token }
}

/** Advance RUNNING phases on the wall clock. Called every poll with `now`.
 *  Advances EVERY in-flight project, not just the active one — so creating a new
 *  project never stalls a run that was already going (it keeps progressing in the
 *  background and parks at its own review gate). This mirrors live, where each
 *  project is an independent n8n run; no queue is needed. Projects only advance
 *  through RUNNING stages, so a background run stops by itself at its next gate. */
export function tick(now) {
  for (const ps of projects.values()) {
    const S = ps.S
    if (!S.busy || S.stage_status !== RUNNING) continue
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
}

/** Approve a review gate → start the next stage (or finish). Idempotent: a
 *  second click while not in REVIEW is a no-op conflict. */
export function approve(stage, now) {
  const S = active().S
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
  const S = active().S
  const lid = S.lessonId || LESSON
  const langs = S.activeLangs || []
  const files = langs.flatMap((l) => [`${lid}_full_${l}.wav`, `${lid}_full_${l}.vtt`])
  const presets = renderDestPresets(lid)
  return { lessonId: lid, langs, files, destination: S.renderDest || presets[0], presets, built: !!S.revealedFull }
}

/** Start the separate "assemble full file" step after the render gate: record the
 *  chosen destination, then the per-lang full files stitch on the wall clock (tick). */
export function startRender(now, destination) {
  const S = active().S
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
  const S = active().S
  if (S.busy) return { ok: false, error: 'Зайнято — staged-ран активний, новий файл відхилено (run-lock).', busy: true }
  return { ok: true, busy: false }
}

/** Apply a past run's settings snapshot to the active project's config/voices/prompt
 *  ("start from archive"). Stage/run keys are never applied. Returns the snapshot's
 *  activeLangs so the pre-flight can pre-select them. */
export function applySettings(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return { ok: false, error: 'порожній знімок' }
  const ps = active()
  for (const [k, v] of Object.entries(snapshot.config || {})) {
    if (APPLY_DENY.has(k)) continue
    ps.configOverrides[k] = String(v)
  }
  for (const v of snapshot.voices || []) {
    if (!v || !v.lang) continue
    const { lang, ...fields } = v
    ps.voiceOverrides[lang] = { ...(ps.voiceOverrides[lang] || {}), ...fields }
  }
  if (typeof snapshot.aiPrompt === 'string' && snapshot.aiPrompt.trim()) ps.aiPrompt = String(snapshot.aiPrompt).slice(0, 20000)
  return { ok: true, activeLangs: Array.isArray(snapshot.activeLangs) ? snapshot.activeLangs : [] }
}

// ── public: operator writes ─────────────────────────────────────────────────

// Voice tab edits (single card save + "apply voice set/template"). Mirrors the
// override that `applySettings` uses, so `tabs()` surfaces the change.
export function writeVoiceCells(lang, updates) {
  if (!lang) throw new Error('не вказано мову')
  const ps = active()
  const fields = {}
  for (const [k, v] of Object.entries(updates || {})) if (v != null) fields[k] = String(v)
  if (!Object.keys(fields).length) throw new Error('немає валідних полів для запису')
  ps.voiceOverrides[lang] = { ...(ps.voiceOverrides[lang] || {}), ...fields }
  return { lang, written: Object.keys(fields).length }
}

// Config tab edits (cps_estimate_*, etc.). expected/conflict is a live-only guard.
export function writeConfigCell(key, value) {
  if (!key) throw new Error('не вказано ключ')
  active().configOverrides[key] = String(value)
  return { key, value: String(value) }
}

// Retime one segment's EN slot (drag the timeline edges under the video). Clamps
// to neighbours so segments stay monotonic & non-overlapping; en_duration_sec is
// derived from start/end in tabs(), so we only store start/end. Transcript stage
// only (timing feeds length budgets + the synth slot).
export function retimeSegment(segmentId, enStart, enEnd) {
  const ps = active()
  const S = ps.S
  const i = S.segments.findIndex((s) => s.segment_id === segmentId)
  if (i < 0) throw new Error(`сегмент ${segmentId} не знайдено`)
  const prevEnd = i > 0 ? Number(S.segments[i - 1].en_end_sec) : 0
  const nextStart = i < S.segments.length - 1 ? Number(S.segments[i + 1].en_start_sec) : ds(ps).audioDuration
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
  const S = active().S
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
  const S = active().S
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
  const ps = active()
  const S = ps.S
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
  renumber(ps)
  return { ok: true, segments: S.segments.length }
}

export function splitSegment(segmentId, wordIndex) {
  const ps = active()
  const S = ps.S
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
  renumber(ps)
  return { ok: true, segments: S.segments.length }
}

export function writeLocalizationCells(targets) {
  const S = active().S
  let written = 0
  for (const t of targets) {
    if (!S.locEdits[t.rowKey]) S.locEdits[t.rowKey] = {}
    S.locEdits[t.rowKey][t.col] = t.value
    written++
  }
  return { written, missing: [] }
}

// Per-LANGUAGE dub retime (audio gate): nudge one localization's slot independently
// of the shared EN segment slot. Stored as slot_start_sec/slot_end_sec overrides on
// that row (tabs() projects them over the segment defaults). The EN slot is never
// touched. Clamped to the lesson span + a minimum length; the client already clamps
// to same-language neighbours during the drag.
export function retimeLocalization(rowKey, enStart, enEnd) {
  const ps = active()
  const dur = ds(ps).audioDuration
  const s = Math.max(0, Number(enStart))
  const e = Math.min(dur, Number(enEnd))
  if (!(e - s >= 0.2)) {
    return { ok: false, conflict: true, error: 'сегмент закороткий або поза межами (мін. 0.2с)' }
  }
  if (!ps.S.locEdits[rowKey]) ps.S.locEdits[rowKey] = {}
  ps.S.locEdits[rowKey].slot_start_sec = +s.toFixed(3)
  ps.S.locEdits[rowKey].slot_end_sec = +e.toFixed(3)
  return { ok: true, rowKey, enStart: +s.toFixed(3), enEnd: +e.toFixed(3) }
}

// Per-LANGUAGE dub fade envelope (audio gate): a linear fade-in/out applied to the
// start/end of one localization's clip. Stored as fade_in_sec/fade_out_sec overrides
// on that row (the render stage bakes the envelope into the per-lang file). Fades
// can't overlap, so their sum is capped to the (per-language) slot length.
export function setLocalizationFades(rowKey, fadeIn, fadeOut) {
  const ps = active()
  const i = rowKey.lastIndexOf('_')
  const segId = i > 0 ? rowKey.slice(0, i) : rowKey
  const seg = ps.S.segments.find((s) => s.segment_id === segId)
  const edit = ps.S.locEdits[rowKey] || {}
  const toNum = (v, d) => (v === '' || v == null || isNaN(Number(v)) ? d : Number(v))
  const slotStart = toNum(edit.slot_start_sec, seg ? Number(seg.en_start_sec) : 0)
  const slotEnd = toNum(edit.slot_end_sec, seg ? Number(seg.en_end_sec) : 0)
  const slot = Math.max(0.2, slotEnd - slotStart)
  let fi = Math.max(0, Math.min(slot, toNum(fadeIn, 0)))
  let fo = Math.max(0, Math.min(slot, toNum(fadeOut, 0)))
  if (fi + fo > slot) fo = Math.max(0, slot - fi) // keep fade-in, trim fade-out to fit
  if (!ps.S.locEdits[rowKey]) ps.S.locEdits[rowKey] = {}
  ps.S.locEdits[rowKey].fade_in_sec = +fi.toFixed(3)
  ps.S.locEdits[rowKey].fade_out_sec = +fo.toFixed(3)
  return { ok: true, rowKey, fadeIn: +fi.toFixed(3), fadeOut: +fo.toFixed(3) }
}

// ── audio-timeline clips (per-language, independent pieces) ──────────────────
// A localization's dub clip can be cut into independent pieces, each moved/trimmed/
// faded/deleted on the audio timeline. State lives in S.clips[rowKey]; absent ⇒ one
// default clip spanning the slot. `srcStart/srcEnd` track which slice of the source
// audio a piece plays (seconds, 1:1 — no time-stretch), so playback + waveform stay
// accurate after cut/move/trim. Mock-only (Etap P: render-node bakes the edit list).
const cNum = (v, d) => (v === '' || v == null || isNaN(Number(v)) ? d : Number(v))
function clipRowKeyOf(clipId) { const i = String(clipId).indexOf('~c'); return i > 0 ? String(clipId).slice(0, i) : String(clipId) }
function segOfRowKey(ps, rowKey) {
  const i = rowKey.lastIndexOf('_')
  const segId = i > 0 ? rowKey.slice(0, i) : rowKey
  return ps.S.segments.find((s) => s.segment_id === segId)
}
function defaultClipFor(ps, rowKey) {
  const seg = segOfRowKey(ps, rowKey)
  const edit = ps.S.locEdits[rowKey] || {}
  const start = cNum(edit.slot_start_sec, seg ? Number(seg.en_start_sec) : 0)
  const end = cNum(edit.slot_end_sec, seg ? Number(seg.en_end_sec) : 0)
  const len = Math.max(0.001, end - start)
  return {
    id: `${rowKey}~c0`,
    start: +start.toFixed(3), end: +end.toFixed(3),
    srcStart: 0, srcEnd: +len.toFixed(3), sourceDur: +len.toFixed(3),
    fadeIn: cNum(edit.fade_in_sec, 0), fadeOut: cNum(edit.fade_out_sec, 0),
  }
}
/** Pure read: stored clips, else a single default clip from the slot. */
function clipsView(ps, rowKey) {
  const stored = ps.S.clips[rowKey]
  return stored ? stored : [defaultClipFor(ps, rowKey)]
}
function ensureClips(ps, rowKey) {
  if (!ps.S.clips[rowKey]) { ps.S.clips[rowKey] = [defaultClipFor(ps, rowKey)]; ps.S.clipSeq[rowKey] = 1 }
  if (ps.S.clipSeq[rowKey] == null) ps.S.clipSeq[rowKey] = ps.S.clips[rowKey].length
  return ps.S.clips[rowKey]
}
function mintClipId(ps, rowKey) { const n = ps.S.clipSeq[rowKey] ?? 1; ps.S.clipSeq[rowKey] = n + 1; return `${rowKey}~c${n}` }

/** Cut one audio clip at a timeline time → two independent pieces (this lang only). */
export function cutClip(clipId, atSec) {
  const ps = active()
  const rowKey = clipRowKeyOf(clipId)
  const clips = ensureClips(ps, rowKey)
  const idx = clips.findIndex((c) => c.id === clipId)
  if (idx < 0) return { ok: false, error: `кліп ${clipId} не знайдено` }
  const c = clips[idx]
  const t = Number(atSec)
  const MIN = 0.1
  if (!(t > c.start + MIN && t < c.end - MIN)) {
    return { ok: false, conflict: true, error: 'точка розрізу поза кліпом або шматок закороткий' }
  }
  const srcMid = +(c.srcStart + (t - c.start)).toFixed(3)
  const left = { ...c, end: +t.toFixed(3), srcEnd: srcMid, fadeOut: 0 }
  const right = { id: mintClipId(ps, rowKey), start: +t.toFixed(3), end: c.end, srcStart: srcMid, srcEnd: c.srcEnd, sourceDur: c.sourceDur, fadeIn: 0, fadeOut: c.fadeOut }
  clips.splice(idx, 1, left, right)
  return { ok: true, clipId, clips }
}

/** Move/trim one clip on the timeline. Pure move (both edges shift equally) keeps
 *  the source window; trimming an edge shifts that edge's source bound 1:1. */
export function retimeClip(clipId, start, end) {
  const ps = active()
  const dur = ds(ps).audioDuration
  const rowKey = clipRowKeyOf(clipId)
  const clips = ensureClips(ps, rowKey)
  const c = clips.find((x) => x.id === clipId)
  if (!c) return { ok: false, error: `кліп ${clipId} не знайдено` }
  const s = Math.max(0, Math.min(dur, Number(start)))
  const e = Math.max(0, Math.min(dur, Number(end)))
  if (!(e - s >= 0.2)) return { ok: false, conflict: true, error: 'кліп закороткий або поза межами (мін. 0.2с)' }
  const dStart = s - c.start
  const dEnd = e - c.end
  if (Math.abs(dStart - dEnd) > 1e-3) { // trim (not a pure move) → move the source bounds
    c.srcStart = Math.max(0, Math.min(c.sourceDur, +(c.srcStart + dStart).toFixed(3)))
    c.srcEnd = Math.max(0, Math.min(c.sourceDur, +(c.srcEnd + dEnd).toFixed(3)))
  }
  c.start = +s.toFixed(3); c.end = +e.toFixed(3)
  return { ok: true, clipId, enStart: c.start, enEnd: c.end }
}

/** Fade in/out envelope on one clip (clamped so the two fades fit the clip). */
export function setClipFades(clipId, fadeIn, fadeOut) {
  const ps = active()
  const rowKey = clipRowKeyOf(clipId)
  const clips = ensureClips(ps, rowKey)
  const c = clips.find((x) => x.id === clipId)
  if (!c) return { ok: false, error: `кліп ${clipId} не знайдено` }
  const len = Math.max(0.2, c.end - c.start)
  const fi = Math.max(0, Math.min(len, Number(fadeIn) || 0))
  let fo = Math.max(0, Math.min(len, Number(fadeOut) || 0))
  if (fi + fo > len) fo = Math.max(0, len - fi)
  c.fadeIn = +fi.toFixed(3); c.fadeOut = +fo.toFixed(3)
  return { ok: true, clipId, fadeIn: c.fadeIn, fadeOut: c.fadeOut }
}

/** Delete one clip (its audio piece). Leaves an empty array if it was the last. */
export function deleteClip(clipId) {
  const ps = active()
  const rowKey = clipRowKeyOf(clipId)
  const clips = ensureClips(ps, rowKey)
  const idx = clips.findIndex((x) => x.id === clipId)
  if (idx < 0) return { ok: false, error: `кліп ${clipId} не знайдено` }
  clips.splice(idx, 1)
  return { ok: true, clipId, clips }
}

// ── public: snapshot projections (shaped like Sheets batchGet / Drive list) ──

export function tabs() {
  const ps = active()
  const S = ps.S
  const d = ds(ps)
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
  Object.assign(baseConfig, ps.configOverrides) // "start from archive" tuning
  const config = [['key', 'value'], ...Object.entries(baseConfig)]

  const segHeader = [
    'segment_id', 'en_text', 'en_start_sec', 'en_end_sec', 'en_duration_sec', 'audio_duration_sec',
    'segment_type', 'movement_keywords', 'stt_confidence', 'stt_word_conf',
    ...DEFAULT_LANGS.map((l) => `${l}_text`),
    ...DEFAULT_LANGS.map((l) => `${l}_adaptation_attempts`),
    'adaptation_attempts', 'status',
  ]
  const segRows = S.segments.map((seg) => [
    seg.segment_id, seg.en_text, seg.en_start_sec, seg.en_end_sec,
    +(seg.en_end_sec - seg.en_start_sec).toFixed(3), d.audioDuration,
    seg.segment_type, seg.movement_keywords, seg.stt_confidence ?? '',
    JSON.stringify((seg.words || []).map((w) => w.conf ?? 1)),
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
    'fade_in_sec', 'fade_out_sec', 'clips',
  ]
  const revealed = S.activeLangs.slice(0, S.revealedLangs)
  const locRows = []
  S.segments.forEach((seg) => {
    const dur = +(seg.en_end_sec - seg.en_start_sec).toFixed(3)
    revealed.forEach((l) => {
      const rowKey = `${seg.segment_id}_${l}`
      const o = (seg.origIndex != null && d.locOverrides[`${seg.origIndex}:${l}`]) || {}
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
        fade_in_sec: 0, fade_out_sec: 0, // per-language dub fade envelope (operator edit overrides)
      }
      Object.assign(base, edit) // operator verdicts/edits win
      // Audio-timeline clip list (independent pieces). Always projected (default =
      // one clip spanning the slot) so derive can render the lane from clips alone.
      base.clips = JSON.stringify(clipsView(ps, rowKey))
      locRows.push(locHeader.map((h) => base[h] ?? ''))
    })
  })

  const voiceHeader = ['lang', 'voice_id', 'voice_name', 'model', 'stability', 'similarity_boost', 'style', 'speed', 'notes']
  const voiceRows = DEFAULT_LANGS.map((l) => {
    const v = { ...d.voiceSeed[l], ...(ps.voiceOverrides[l] || {}) }
    return voiceHeader.map((h) => (h === 'lang' ? l : v[h] ?? ''))
  })

  const promptHeader = ['key', 'description', 'value']
  const promptRows = PROMPT_DEFAULTS.map((p) => [p.key, p.description, ps.promptOverrides[p.key] ?? p.value])

  return {
    config,
    segments: [segHeader, ...segRows],
    localizations: [locHeader, ...locRows],
    voices: [voiceHeader, ...voiceRows],
    prompts: [promptHeader, ...promptRows],
  }
}

export function drive() {
  const ps = active()
  const S = ps.S
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
    ? [{ id: 'mock_input_src', name: `${lid}.wav`, size: '9800000', md5Checksum: 'mockmd5src', modifiedTime: S.runToken, mimeType: 'audio/wav' }]
    : []
  return { input, full, vtt }
}

/** Word-level timing fixture for the transcript split UI (Etap P: a Drive JSON). */
export function words(segmentId) {
  const seg = active().S.segments.find((s) => s.segment_id === segmentId)
  return seg ? seg.words : null
}

/** EN segment region (for the transcript-stage audio player resolver). */
export function segmentRegion(segmentId) {
  const seg = active().S.segments.find((s) => s.segment_id === segmentId)
  if (!seg) return null
  return { start: seg.en_start_sec, end: seg.en_end_sec }
}

export function currentStatus() {
  const S = active().S
  return { pipeline_stage: S.pipeline_stage, stage_status: S.stage_status, busy: S.busy, runToken: S.runToken }
}

// ── editable AI translation-check prompt (per active project) ───────────────
export const getAiPrompt = () => active().aiPrompt
export const getDefaultAiPrompt = () => DEFAULT_AI_PROMPT
export function setAiPrompt(v) { active().aiPrompt = String(v ?? '').slice(0, 20000); return { ok: true } }

// ── editable pipeline prompt templates (per active project; defaults + overrides) ──
export function listPrompts() {
  const ps = active()
  return PROMPT_DEFAULTS.map((p) => {
    const value = ps.promptOverrides[p.key] ?? p.value
    return { key: p.key, group: p.group, description: p.description, length: value.length, edited: ps.promptOverrides[p.key] != null }
  })
}
export function getPrompt(key) {
  const p = PROMPT_DEFAULT_MAP[key]
  if (!p) return null
  const ps = active()
  return { key, group: p.group, description: p.description, value: ps.promptOverrides[key] ?? p.value, default: p.value, edited: ps.promptOverrides[key] != null }
}
export function setPrompt(key, value) {
  const p = PROMPT_DEFAULT_MAP[key]
  if (!p) return { ok: false, error: `невідомий промпт "${key}"` }
  const ps = active()
  const v = String(value ?? '').slice(0, 20000)
  if (v === p.value) delete ps.promptOverrides[key] // back to default → drop the override
  else ps.promptOverrides[key] = v
  return { ok: true }
}

function mockTranslate(en, lang) {
  return `«${en}» (${lang})`
}
