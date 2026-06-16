import { DEFAULT_LANGS } from '../constants.js'

// Deterministic fixtures shaped exactly like Sheets batchGet output (row 0 =
// header) + Drive listings, so the snapshot parser runs the same code path in
// mock and live mode. Represents a COMPLETE run of lesson "sleep_002".

const LESSON = 'sleep_002'
const RUN_TOKEN = '2026-06-14T11:02:10.000Z'
const DONE_AT = '2026-06-14T11:41:55.000Z'

const SEGMENTS = [
  { en: 'Welcome back. Find a comfortable position and let your body settle.', start: 0.0, end: 6.4, type: 'narrative', move: '' },
  { en: 'Take a slow breath in through your nose.', start: 6.8, end: 11.2, type: 'movement', move: 'inhale' },
  { en: 'And gently release it, letting your shoulders soften.', start: 11.6, end: 17.5, type: 'movement', move: 'exhale' },
  { en: 'Notice the quiet space that opens up with each breath.', start: 18.0, end: 24.2, type: 'narrative', move: '' },
  { en: 'There is nothing you need to do right now, nowhere to be.', start: 24.6, end: 31.0, type: 'narrative', move: '' },
  { en: 'Let this calm carry you gently into rest.', start: 31.4, end: 37.1, type: 'narrative', move: '' },
]

const TRANSLATIONS = {
  de: ['Willkommen zurück. Finde eine bequeme Position und lass deinen Körper zur Ruhe kommen.', 'Atme langsam durch die Nase ein.', 'Und lass ihn sanft los, während deine Schultern weich werden.', 'Bemerke den stillen Raum, der sich mit jedem Atemzug öffnet.', 'Es gibt nichts zu tun, nirgendwo zu sein.', 'Lass diese Ruhe dich sanft in den Schlaf tragen.'],
  es: ['Bienvenida de nuevo. Encuentra una posición cómoda y deja que tu cuerpo se asiente.', 'Inhala lentamente por la nariz.', 'Y suéltalo con suavidad, dejando que tus hombros se relajen.', 'Nota el espacio tranquilo que se abre con cada respiración.', 'No hay nada que hacer ahora, ningún lugar donde estar.', 'Deja que esta calma te lleve suavemente al descanso.'],
  fr: ['Bienvenue. Trouve une position confortable et laisse ton corps se poser.', 'Inspire lentement par le nez.', 'Et relâche doucement, en laissant tes épaules se détendre.', 'Remarque l’espace calme qui s’ouvre à chaque souffle.', 'Tu n’as rien à faire maintenant, nulle part où être.', 'Laisse ce calme te porter doucement vers le repos.'],
  it: ['Bentornata. Trova una posizione comoda e lascia che il corpo si assesti.', 'Inspira lentamente dal naso.', 'E rilascialo dolcemente, lasciando ammorbidire le spalle.', 'Nota lo spazio silenzioso che si apre a ogni respiro.', 'Non c’è nulla da fare ora, nessun posto dove essere.', 'Lascia che questa calma ti porti dolcemente al riposo.'],
  pl: ['Witaj ponownie. Znajdź wygodną pozycję i pozwól ciału się ułożyć.', 'Wdychaj powoli przez nos.', 'I delikatnie wypuść, pozwalając ramionom zmięknąć.', 'Zauważ cichą przestrzeń, która otwiera się z każdym oddechem.', 'Nie musisz teraz nic robić, nie ma dokąd iść.', 'Pozwól, by ten spokój łagodnie poniósł cię do snu.'],
  pt: ['Bem-vinda de volta. Encontra uma posição confortável e deixa o teu corpo assentar.', 'Inspira lentamente pelo nariz.', 'E solta-o suavemente, deixando os ombros relaxarem.', 'Repara no espaço calmo que se abre a cada respiração.', 'Não há nada a fazer agora, nenhum lugar onde estar.', 'Deixa esta calma levar-te suavemente ao descanso.'],
  tr: ['Tekrar hoş geldin. Rahat bir pozisyon bul ve bedeninin yerleşmesine izin ver.', 'Burnundan yavaşça nefes al.', 'Ve omuzlarını yumuşatarak nazikçe bırak.', 'Her nefeste açılan sessiz alanı fark et.', 'Şu anda yapman gereken hiçbir şey yok, gidecek hiçbir yer yok.', 'Bu huzurun seni nazikçe dinlenmeye taşımasına izin ver.'],
}

// Per-cell diagnostic overrides keyed `segIdx:lang`. Most cells are clean.
const OVERRIDES = {
  '1:tr': { needs_attention: 'TRUE', shorten_retries_in_synthesize: 3, final_speed: 1.15, real_duration_sec: 4.5, phase2_outcome: 'accepted', note: 'movement + hard-truncate' },
  '2:fr': { needs_attention: 'TRUE', borrowed_sec: 0, phase2_outcome: 'accepted', note: 'movement-locked overshoot' },
  // non-movement hard-truncate → multi-cause panel: length + speed + density
  '3:it': { needs_attention: 'TRUE', shorten_retries_in_synthesize: 3, final_speed: 1.2, real_duration_sec: 5.8, phase2_outcome: 'accepted', note: 'text too long, speed ceiling, dense' },
  // technical failure → single tech cause (not a text problem)
  '0:tr': { needs_attention: 'TRUE', real_duration_sec: 0, shorten_retries_in_synthesize: 0, final_speed: 1.0, phase2_outcome: 'accepted', note: 'tts returned empty' },
  '4:es': { needs_attention: 'REVIEW', last_regen_at: '2026-06-14 14:32:10', regen_comment: 'переписала фразу коротше', phase2_outcome: 'accepted' },
  '5:de': { needs_attention: 'FALSE', phase2_outcome: 'no_change', expansion_attempts: 1 },
  '0:pl': { needs_attention: 'FALSE', borrowed_sec: 1.3 },
}

// Per-(segIdx:lang) W2 adaptation_attempts override (drives the "density" cause).
const ADAPT_OVERRIDES = {
  '3:it': 3,
}

function pad(n) {
  return String(n + 1).padStart(3, '0')
}

export function mockTabs() {
  // config
  const config = [
    ['key', 'value'],
    ['localization_run_token', RUN_TOKEN],
    ['localization_abort_token', ''],
    ['active_langs', DEFAULT_LANGS.join(',')],
    ['w_regen_workflow_url', 'https://n8n.example/webhook/w-regen'],
    ['drive_input_folder_id', 'mock_input_folder'],
    ['drive_output_folder_id', 'mock_output_folder'],
    ['drive_output_full_folder_id', 'mock_full_folder'],
    ['drive_output_vtt_folder_id', 'mock_vtt_folder'],
    ['drive_archive_folder_id', 'mock_archive_folder'],
    ['slack_channel', '#dubbing'],
    ['min_inter_segment_gap_sec', 0.4],
    ['max_borrow_per_segment_sec', 2.0],
    ['expansion_threshold', 0.85],
    ['max_speed_up_delta', 0.2],
    ['max_slow_down_delta', 0.15],
    ['cps_estimate_fr', 13.5],
    ['elevenlabs_api_key', 'sk_live_THIS_SHOULD_BE_MASKED'],
    ['anthropic_api_key', 'sk-ant-THIS_SHOULD_BE_MASKED'],
  ]

  // segments
  const segHeader = [
    'segment_id', 'en_text', 'en_start_sec', 'en_end_sec', 'en_duration_sec', 'audio_duration_sec',
    'segment_type', 'movement_keywords',
    ...DEFAULT_LANGS.map((l) => `${l}_text`),
    ...DEFAULT_LANGS.map((l) => `${l}_adaptation_attempts`),
    'adaptation_attempts', 'status',
  ]
  const segRows = SEGMENTS.map((s, i) => [
    `${LESSON}_seg_${pad(i)}`, s.en, s.start, s.end, +(s.end - s.start).toFixed(2), 37.1,
    s.type, s.move,
    ...DEFAULT_LANGS.map((l) => TRANSLATIONS[l][i]),
    ...DEFAULT_LANGS.map((l) => ADAPT_OVERRIDES[`${i}:${l}`] ?? (i === 1 ? 1 : 0)),
    Math.max(i === 1 ? 1 : 0, ...DEFAULT_LANGS.map((l) => ADAPT_OVERRIDES[`${i}:${l}`] ?? 0)), 'pending',
  ])

  // localizations
  const locHeader = [
    'row_key', 'segment_id', 'lang', 'text_translated', 'en_start_sec', 'en_duration_sec',
    'real_duration_sec', 'lead_silence_sec', 'slot_start_sec', 'slot_end_sec', 'tts_budget_sec',
    'tail_silence_sec', 'final_duration_sec', 'borrowed_sec', 'expansion_attempts',
    'shorten_retries_in_synthesize', 'final_speed', 'needs_attention', 'audio_drive_file_id',
    'phase2_outcome', 'needs_retts', 'last_regen_at', 'regen_comment',
  ]
  const locRows = []
  SEGMENTS.forEach((s, i) => {
    const dur = +(s.end - s.start).toFixed(2)
    DEFAULT_LANGS.forEach((l) => {
      const o = OVERRIDES[`${i}:${l}`] || {}
      locRows.push([
        `seg_${pad(i)}_${l}`, `${LESSON}_seg_${pad(i)}`, l, TRANSLATIONS[l][i], s.start, dur,
        o.real_duration_sec ?? +(dur - 0.2).toFixed(2), 0.1, s.start, s.end, +(dur - 0.1).toFixed(2),
        0.1, +(dur).toFixed(2), o.borrowed_sec ?? 0, o.expansion_attempts ?? 0,
        o.shorten_retries_in_synthesize ?? 0, o.final_speed ?? 1.0, o.needs_attention ?? 'FALSE',
        `mock_file_${i}_${l}`, o.phase2_outcome ?? 'accepted', 'FALSE', o.last_regen_at ?? '', o.regen_comment ?? '',
      ])
    })
  })

  // voices
  const voiceHeader = ['lang', 'voice_id', 'voice_name', 'model', 'stability', 'similarity_boost', 'style', 'speed', 'notes']
  const voiceRows = DEFAULT_LANGS.map((l) => [
    l, `voice_${l}_id`, `${l.toUpperCase()} narrator`, 'eleven_multilingual_v2', 0.5, 0.75, 0,
    l === 'fr' ? 0.86 : 1.0, '',
  ])

  // prompts (truncated values — real ones are up to 50K chars)
  const promptHeader = ['key', 'description', 'value']
  const promptRows = [
    ['tone_of_voice', 'Global tone of voice doc', 'Warm, calm, intimate. Speak softly to one listener...'],
    ['translate_system', 'Translation system prompt', 'You translate wellness scripts. Preserve {{tone_of_voice}}. Keep informal address...'],
    ['adapt_attempt_unified', 'Unified shortener', 'Shorten the translation to fit {{budget}} chars while keeping meaning...'],
  ]

  return {
    config,
    segments: [segHeader, ...segRows],
    localizations: [locHeader, ...locRows],
    voices: [voiceHeader, ...voiceRows],
    prompts: [promptHeader, ...promptRows],
  }
}

export function mockDrive() {
  const full = DEFAULT_LANGS.map((l) => ({
    id: `mock_full_${l}`, name: `${LESSON}_full_${l}.wav`, size: '58000044',
    md5Checksum: `mockmd5full${l}`, modifiedTime: DONE_AT, mimeType: 'audio/wav',
  }))
  const vtt = DEFAULT_LANGS.map((l) => ({
    id: `mock_vtt_${l}`, name: `${LESSON}_full_${l}.vtt`, size: '2200',
    md5Checksum: `mockmd5vtt${l}`, modifiedTime: DONE_AT, mimeType: 'text/vtt',
  }))
  const input = [{ id: 'mock_input_src', name: `${LESSON}.wav`, size: '9800000', md5Checksum: 'mockmd5src', modifiedTime: RUN_TOKEN, mimeType: 'audio/wav' }]
  return { input, full, vtt }
}
