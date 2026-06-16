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
}

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
])

export const SECRET_PATTERN = /key|secret|token|password|api[_-]?key/i

// Config keys the UI may WRITE (update-only). Never secrets, never run/abort
// tokens. Mirrors the integration contract's "yellow zone".
export const EDITABLE_CONFIG_KEYS = new Set([
  'active_langs',
  'max_adaptation_attempts', 'expansion_threshold', 'w2_adapt_concurrency', 'w2_llm_chunk',
  'max_segment_duration_sec', 'min_intra_sentence_pause_sec', 'min_segment_piece_duration_sec',
  'min_inter_segment_gap_sec', 'max_borrow_per_segment_sec', 'movement_borrow_max_sec',
  'silence_lead_ratio', 'silence_lead_max_sec', 'max_speed_up_delta', 'max_slow_down_delta', 'slowdown_min_gap_sec',
  'cps_estimate_de', 'cps_estimate_es', 'cps_estimate_fr', 'cps_estimate_it', 'cps_estimate_pl', 'cps_estimate_pt', 'cps_estimate_tr',
  'drive_input_folder_id', 'drive_output_folder_id', 'drive_output_full_folder_id', 'drive_output_vtt_folder_id', 'drive_archive_folder_id',
  'sheets_document_id', 'slack_channel', 'w_regen_workflow_url',
])

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
  TRANSLATING: 'TRANSLATING',
  SYNTHESIZING: 'SYNTHESIZING',
  COMPLETE: 'COMPLETE',
  STOPPING: 'STOPPING',
  STOPPED: 'STOPPED',
  REGENERATING: 'REGENERATING',
  STALLED: 'STALLED',
}

// States during which the UI is read-only (mirrors "don't touch Sheets mid-run").
export const READONLY_STATES = new Set([
  RUN_STATES.STARTING,
  RUN_STATES.ARCHIVING,
  RUN_STATES.STT,
  RUN_STATES.TRANSLATING,
  RUN_STATES.SYNTHESIZING,
  RUN_STATES.STOPPING,
  RUN_STATES.REGENERATING,
])

export const STALL_THRESHOLD_MS = 12 * 60 * 1000
