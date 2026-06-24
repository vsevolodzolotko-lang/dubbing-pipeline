// Shared vocabulary for the pipeline's Google Sheet. Column letters are NEVER
// hardcoded — these are header *names*, resolved to indexes from the live header
// row on every poll (the schema has drifted before: README mentioned a
// `phase2_diag` column that docs/sheets_schema.md says doesn't exist).

export const DEFAULT_LANGS = ['de', 'es', 'fr', 'it', 'pl', 'pt', 'tr']

export const TABS = {
  config: 'config',
  segments: 'segments',
  localizations: 'localizations',
  voices: 'voices',
  prompts: 'prompts',
}

// Config keys the UI cares about. Secrets are NOT here — they are masked.
export const CONFIG_KEYS = {
  runToken: 'localization_run_token',
  abortToken: 'localization_abort_token',
  activeLangs: 'active_langs',
  wRegenUrl: 'w_regen_workflow_url',
  inputFolder: 'drive_input_folder_id',
  outputFolder: 'drive_output_folder_id',
  fullFolder: 'drive_output_full_folder_id',
  vttFolder: 'drive_output_vtt_folder_id',
  archiveFolder: 'drive_archive_folder_id',
  // Staged pipeline (gated review). Written ONLY by the staged flow; the legacy
  // auto-flow (Drive 01_input drop) never sets these, so computeRunState falls
  // back to pure derivation and shows auto-runs exactly as before.
  pipelineStage: 'pipeline_stage', // STT | TRANSLATE | SYNTH | DONE
  stageStatus: 'stage_status', // RUNNING | REVIEW | APPROVED
  stageRunToken: 'stage_run_token', // mirror of run_token when stage fields were last written
  stagedInputFolder: 'drive_staged_input_folder_id', // ⏸ Etap P — separate from 01_input
  w2Url: 'w2_translate_workflow_url', // ⏸ Etap P
  w3Url: 'w3_dispatch_workflow_url', // ⏸ Etap P
}

// Stage / status vocabularies for the staged pipeline.
export const PIPELINE_STAGES = { STT: 'STT', TRANSLATE: 'TRANSLATE', SYNTH: 'SYNTH', RENDER: 'RENDER', DONE: 'DONE' }
export const STAGE_STATUS = { RUNNING: 'RUNNING', REVIEW: 'REVIEW', APPROVED: 'APPROVED' }

// Config keys that may be revealed to the browser. Anything else — and anything
// matching the secret pattern below — is masked by default.
export const CONFIG_ALLOWLIST = new Set([
  'active_langs',
  'min_inter_segment_gap_sec',
  'max_borrow_per_segment_sec',
  'movement_borrow_max_sec',
  'silence_lead_ratio',
  'silence_lead_max_sec',
  'expansion_threshold',
  'max_speed_up_delta',
  'max_slow_down_delta',
  'regen_concurrency',
  'w2_adapt_concurrency',
  'w2_llm_chunk',
  'cps_estimate_de',
  'cps_estimate_es',
  'cps_estimate_fr',
  'cps_estimate_it',
  'cps_estimate_pl',
  'cps_estimate_pt',
  'cps_estimate_tr',
  'drive_input_folder_id',
  'drive_output_folder_id',
  'drive_output_full_folder_id',
  'drive_output_vtt_folder_id',
  'drive_archive_folder_id',
  'slack_channel',
  'sheets_document_id',
  // staged-pipeline state — readable by the UI (not secrets), but NOT editable
  // via the generic PUT /api/config/:key (mutated only by dedicated endpoints).
  'pipeline_stage',
  'stage_status',
  'stage_run_token',
  'drive_staged_input_folder_id',
  'w2_translate_workflow_url',
  'w3_dispatch_workflow_url',
])

export const SECRET_PATTERN = /key|secret|token|password|api[_-]?key/i

// Config keys the UI may WRITE (update-only). Never secrets, never run/abort
// tokens. Mirrors the integration contract's "yellow zone".
export const EDITABLE_CONFIG_KEYS = new Set([
  'active_langs',
  'max_adaptation_attempts', 'expansion_threshold', 'w2_adapt_concurrency', 'w2_llm_chunk',
  'max_segment_duration_sec', 'min_intra_sentence_pause_sec', 'min_segment_piece_duration_sec', 'min_hard_pause_piece_sec',
  'min_inter_segment_gap_sec', 'max_borrow_per_segment_sec', 'movement_borrow_max_sec',
  'silence_lead_ratio', 'silence_lead_max_sec', 'max_speed_up_delta', 'max_slow_down_delta', 'slowdown_min_gap_sec',
  'cps_estimate_de', 'cps_estimate_es', 'cps_estimate_fr', 'cps_estimate_it', 'cps_estimate_pl', 'cps_estimate_pt', 'cps_estimate_tr',
  'drive_input_folder_id', 'drive_output_folder_id', 'drive_output_full_folder_id', 'drive_output_vtt_folder_id', 'drive_archive_folder_id',
  'sheets_document_id', 'slack_channel', 'w_regen_workflow_url',
  // ⏸ Etap P — operator pastes the n8n production webhook URLs + staged folder id
  'w2_translate_workflow_url', 'w3_dispatch_workflow_url', 'drive_staged_input_folder_id',
])

// Numeric bounds for editable config keys — the server's own copy of the ranges
// declared in ui/client/src/configCatalog.ts (a client .ts file the server can't
// import). Used to clamp/reject LLM-proposed values in the Tuning advisor so a
// bad suggestion can never be one-click-applied out of range. Keep in sync with
// the catalog. Keys absent here (text/csv keys) are not numerically validated.
export const EDITABLE_CONFIG_BOUNDS = {
  max_adaptation_attempts: { min: 1, max: 5, step: 1 },
  expansion_threshold: { min: 0, max: 1, step: 0.05 },
  w2_adapt_concurrency: { min: 1, max: 16, step: 1 },
  w2_llm_chunk: { min: 1, max: 12, step: 1 },
  max_segment_duration_sec: { min: 6, max: 20, step: 0.5 },
  min_intra_sentence_pause_sec: { min: 0, max: 1, step: 0.05 },
  min_segment_piece_duration_sec: { min: 0.5, max: 5, step: 0.1 },
  min_inter_segment_gap_sec: { min: 0, max: 2, step: 0.05 },
  max_borrow_per_segment_sec: { min: 0, max: 4, step: 0.1 },
  movement_borrow_max_sec: { min: 0, max: 4, step: 0.1 },
  silence_lead_ratio: { min: 0, max: 1, step: 0.05 },
  silence_lead_max_sec: { min: 0, max: 0.5, step: 0.01 },
  max_speed_up_delta: { min: 0, max: 0.4, step: 0.01 },
  max_slow_down_delta: { min: 0, max: 0.4, step: 0.01 },
  slowdown_min_gap_sec: { min: 0, max: 2, step: 0.1 },
  cps_estimate_de: { min: 5, max: 25, step: 0.5 },
  cps_estimate_es: { min: 5, max: 25, step: 0.5 },
  cps_estimate_fr: { min: 5, max: 25, step: 0.5 },
  cps_estimate_it: { min: 5, max: 25, step: 0.5 },
  cps_estimate_pl: { min: 5, max: 25, step: 0.5 },
  cps_estimate_pt: { min: 5, max: 25, step: 0.5 },
  cps_estimate_tr: { min: 5, max: 25, step: 0.5 },
}

export function maskConfigValue(key, value) {
  if (CONFIG_ALLOWLIST.has(key)) return { value, masked: false }
  if (SECRET_PATTERN.test(key)) return { value: value ? '••••••••' : '', masked: true }
  // Unknown, non-secret-looking keys: surface raw so nothing is silently lost.
  return { value, masked: false }
}

// localizations columns the UI is permitted to write (operator_manual.md §5).
export const WRITABLE_LOCALIZATION_COLS = new Set([
  'text_translated',
  'needs_retts',
  'needs_attention',
  'regen_comment',
])

// segments columns the UI may write, split by GATE so it's impossible to edit
// translations during transcript review and vice-versa. Merge/split is handled
// by dedicated endpoints (not cell writes). en_duration_sec is always derived
// server-side from start/end — never independently writable.
export const TRANSCRIPT_WRITABLE_COLS = new Set(['en_text'])
export const TRANSLATION_WRITABLE_COLS = new Set(DEFAULT_LANGS.map((l) => `${l}_text`))

// voices columns the UI may write (never `lang`).
export const VOICE_WRITABLE_COLS = new Set([
  'voice_id', 'voice_name', 'model', 'stability', 'similarity_boost', 'style', 'speed', 'notes',
])

// Run-state machine states.
export const RUN_STATES = {
  SETUP_REQUIRED: 'SETUP_REQUIRED',
  UNKNOWN: 'UNKNOWN',
  IDLE: 'IDLE',
  STARTING: 'STARTING',
  ARCHIVING: 'ARCHIVING',
  STT: 'STT',
  TRANSCRIPT_REVIEW: 'TRANSCRIPT_REVIEW', // staged gate 1 — awaiting operator approval
  TRANSLATING: 'TRANSLATING',
  TRANSLATION_REVIEW: 'TRANSLATION_REVIEW', // staged gate 2
  SYNTHESIZING: 'SYNTHESIZING',
  AUDIO_REVIEW: 'AUDIO_REVIEW', // staged gate 3 (per-segment audio review)
  RENDER_REVIEW: 'RENDER_REVIEW', // staged gate 4 — assemble full file: pick destination, then build
  RENDERING: 'RENDERING', // building the full per-lang file from segments (post-review)
  COMPLETE: 'COMPLETE',
  STOPPING: 'STOPPING',
  STOPPED: 'STOPPED',
  REGENERATING: 'REGENERATING',
  STALLED: 'STALLED',
}

// States during which the UI is read-only (mirrors "don't touch Sheets mid-run").
// Review states are intentionally NOT here — the pipeline is paused at a gate,
// so editing the relevant Sheet columns is safe (and the whole point).
export const READONLY_STATES = new Set([
  RUN_STATES.STARTING,
  RUN_STATES.ARCHIVING,
  RUN_STATES.STT,
  RUN_STATES.TRANSLATING,
  RUN_STATES.SYNTHESIZING,
  RUN_STATES.RENDERING,
  RUN_STATES.STOPPING,
  RUN_STATES.REGENERATING,
])

// States from which a new staged run / project switch may begin (nothing in
// flight). Shared by the staged-start route and the projects routes so the two
// can't drift.
export const START_STATES = new Set([
  RUN_STATES.IDLE, RUN_STATES.COMPLETE, RUN_STATES.STOPPED,
])

// Per-gate write scopes (used by the stage-aware guard + client capability checks).
export const LOCALIZATION_WRITE_STATES = new Set([
  RUN_STATES.IDLE, RUN_STATES.COMPLETE, RUN_STATES.STOPPED, RUN_STATES.AUDIO_REVIEW,
])
export const TRANSCRIPT_WRITE_STATES = new Set([RUN_STATES.TRANSCRIPT_REVIEW])
// Translation gate + audio review (fixing a flagged translation there feeds regen).
export const TRANSLATION_WRITE_STATES = new Set([RUN_STATES.TRANSLATION_REVIEW, RUN_STATES.AUDIO_REVIEW])
// Segment EN-slot retime (drag timeline edges) — allowed on both the transcript
// gate and the audio gate (where you check the dub against the video per language).
export const RETIME_WRITE_STATES = new Set([RUN_STATES.TRANSCRIPT_REVIEW, RUN_STATES.AUDIO_REVIEW])
// Structural segment split (cut) — the transcript gate, plus cutting on the audio
// timeline (the split halves are flagged for re-synthesis downstream).
export const SPLIT_WRITE_STATES = new Set([RUN_STATES.TRANSCRIPT_REVIEW, RUN_STATES.AUDIO_REVIEW])
// The assemble-file gate accepts the "build" action (with a destination).
export const RENDER_STATES = new Set([RUN_STATES.RENDER_REVIEW])

// Running states that should NOT be eligible for the staged review gates — used
// to gate the STALLED overlay so review states (intentionally idle) never stall.
export const RUNNING_STATES = new Set([
  RUN_STATES.STARTING, RUN_STATES.ARCHIVING, RUN_STATES.STT,
  RUN_STATES.TRANSLATING, RUN_STATES.SYNTHESIZING, RUN_STATES.RENDERING, RUN_STATES.REGENERATING,
])

export const STALL_THRESHOLD_MS = 12 * 60 * 1000
