// Human-facing metadata for config keys (labels/tooltips/groups/bounds), sourced
// from docs/config_keys.md. The SERVER independently enforces which keys are
// writable — this is presentation only.

export type FieldType = 'csv' | 'number' | 'ratio' | 'text' | 'secret' | 'readonly'

export interface ConfigField {
  group: string
  label: string
  tooltip?: string
  type: FieldType
  min?: number
  max?: number
  step?: number
  editable?: boolean
  testable?: boolean // API-key smoke test
}

export const GROUP_ORDER = [
  'Languages',
  'Adaptation and translation',
  'Segmentation (W1)',
  'Synthesis timing (W3)',
  'CPS - characters/sec',
  'Drive folders',
  'Slack / integrations',
  'Secrets (read-only)',
  'System (do not edit)',
  'Other',
  'Dead keys',
]

const num = (label: string, min: number, max: number, step: number, tooltip: string, group: string): ConfigField =>
  ({ group, label, tooltip, type: 'number', min, max, step, editable: true })

export const CATALOG: Record<string, ConfigField> = {
  active_langs: { group: 'Languages', label: 'Active languages', type: 'csv', editable: true, tooltip: 'Comma-separated language codes the pipeline processes end-to-end (de,es,fr,it,pl,pt,tr). Empty = all 7. E.g. "de" to run a single language.' },

  max_adaptation_attempts: num('Max shortening attempts (W2)', 1, 5, 1, 'Upper bound of the CPS shortening loop per language in W2.', 'Adaptation and translation'),
  expansion_threshold: { group: 'Adaptation and translation', label: 'Expansion threshold (Phase 2)', type: 'ratio', min: 0, max: 1, step: 0.05, editable: true, tooltip: 'Expansion triggers when real_duration < en_duration x threshold. Higher = tries to fill the pause more often.' },
  w2_adapt_concurrency: num('Parallel shortenings (W2)', 1, 16, 1, 'Global limit on concurrent Claude shortening calls.', 'Adaptation and translation'),
  w2_llm_chunk: num('Parallel LLM batches (W2)', 1, 12, 1, 'How many LLM batches are processed in parallel in Verify/Editor.', 'Adaptation and translation'),

  max_segment_duration_sec: num('Max segment duration, s', 6, 20, 0.5, 'Hard limit on EN segment duration; longer sentences are cut at natural pauses. Lower (8-10) helps verbose languages.', 'Segmentation (W1)'),
  min_intra_sentence_pause_sec: num('Min pause for a split, s', 0, 1, 0.05, 'Minimum inter-word gap considered a valid split point.', 'Segmentation (W1)'),
  min_segment_piece_duration_sec: num('Min piece after split, s', 0.5, 5, 0.1, 'Each split part must be no shorter than this; prevents micro-segments.', 'Segmentation (W1)'),

  min_inter_segment_gap_sec: num('Min pause between segments, s', 0, 2, 0.05, 'Minimum silence between localized segments (symmetric: steal-from-prev / borrow-from-next).', 'Synthesis timing (W3)'),
  max_borrow_per_segment_sec: num('Max borrow into pause, s', 0, 4, 0.1, 'How many seconds a segment can extend into the next pause (breath-borrow).', 'Synthesis timing (W3)'),
  movement_borrow_max_sec: num('Borrow for movement, s', 0, 4, 0.1, 'Separate borrow limit for movement segments (Inhale/Hold/Exhale). 0 = strict binding to en_duration.', 'Synthesis timing (W3)'),
  silence_lead_ratio: { group: 'Synthesis timing (W3)', label: 'Silence share before TTS', type: 'ratio', min: 0, max: 1, step: 0.05, editable: true, tooltip: 'What share of padding silence goes BEFORE the audio (lead). Applies only when the natural lead gap = 0.' },
  silence_lead_max_sec: num('Max lead silence, s', 0, 0.5, 0.01, 'Hard ceiling on breath-lead before TTS when the natural EN gap = 0. 0 = strict EN alignment.', 'Synthesis timing (W3)'),
  max_speed_up_delta: num('Max speed-up (+to speed)', 0, 0.4, 0.01, 'Max speed-up above the voice base speed. For 1.0 - ceiling 1.20; for 0.86 (FR) - 1.06.', 'Synthesis timing (W3)'),
  max_slow_down_delta: num('Max slow-down (-from speed)', 0, 0.4, 0.01, 'Max slow-down below the base speed to fill silence (Phase 2).', 'Synthesis timing (W3)'),
  slowdown_min_gap_sec: num('Threshold for slow-down, s', 0, 2, 0.1, 'Slow-down-to-fill applies only when the remaining silence is larger than this.', 'Synthesis timing (W3)'),

  ...Object.fromEntries(['de', 'es', 'fr', 'it', 'pl', 'pt', 'tr'].map((l) => [
    `cps_estimate_${l}`,
    num(`CPS ${l.toUpperCase()}`, 5, 25, 0.5, `Characters/sec estimate for ${l.toUpperCase()}. Used to predict whether the translation fits the slot. Calibrated by scripts/analyze_cps.js.`, 'CPS - characters/sec'),
  ])),

  drive_input_folder_id: { group: 'Drive folders', label: '01_input (input)', type: 'text', editable: true, tooltip: 'Folder watched by W_Master. Warning: changing it affects the pipeline.' },
  drive_output_folder_id: { group: 'Drive folders', label: '02_output (segments)', type: 'text', editable: true, tooltip: 'Per-segment WAV folder. Warning: affects the pipeline.' },
  drive_output_full_folder_id: { group: 'Drive folders', label: '03_full (full)', type: 'text', editable: true, tooltip: 'Full WAV folder. Warning: affects the pipeline.' },
  drive_output_vtt_folder_id: { group: 'Drive folders', label: '04_vtt (subtitles)', type: 'text', editable: true, tooltip: 'VTT folder. Warning: affects the pipeline.' },
  drive_archive_folder_id: { group: 'Drive folders', label: '05_archive (archive)', type: 'text', editable: true, tooltip: 'Archive root. Warning: affects the pipeline.' },
  sheets_document_id: { group: 'Drive folders', label: 'Sheet ID (snapshot)', type: 'text', editable: true, tooltip: 'ID of the live sheet for the snapshot copy in the archive. Usually leave untouched.' },

  slack_channel: { group: 'Slack / integrations', label: 'Slack channel (ID)', type: 'text', editable: true, tooltip: 'ID of the channel messages are posted to (e.g. C01234ABCDE).' },
  w_regen_workflow_url: { group: 'Slack / integrations', label: 'W_Regen webhook URL', type: 'text', editable: true, tooltip: 'Public W_Regen webhook. Warning: capability URL - anyone with it can launch a paid regen.' },

  anthropic_api_key: { group: 'Secrets (read-only)', label: 'Anthropic API key', type: 'secret', testable: true },
  gemini_api_key: { group: 'Secrets (read-only)', label: 'Gemini API key', type: 'secret', testable: true },
  openai_api_key: { group: 'Secrets (read-only)', label: 'OpenAI API key', type: 'secret', testable: true },
  elevenlabs_api_key: { group: 'Secrets (read-only)', label: 'ElevenLabs API key', type: 'secret', testable: true },
  deepgram_api_key: { group: 'Secrets (read-only)', label: 'Deepgram API key', type: 'secret', testable: true },
  slack_signing_secret: { group: 'Secrets (read-only)', label: 'Slack signing secret', type: 'secret' },

  localization_run_token: { group: 'System (do not edit)', label: 'run_token (current run)', type: 'readonly', tooltip: 'Managed by the pipeline. Do not edit.' },
  localization_abort_token: { group: 'System (do not edit)', label: 'abort_token (stop)', type: 'readonly', tooltip: 'Managed by the pipeline / Stop button. Do not edit.' },
  manual_w1_file_id: { group: 'System (do not edit)', label: 'manual_w1_file_id', type: 'readonly', tooltip: 'For manually launching W1 in n8n.' },
  manual_w1_lesson_id: { group: 'System (do not edit)', label: 'manual_w1_lesson_id', type: 'readonly', tooltip: 'For manually launching W1 in n8n.' },
}

// Removed/superseded keys — show under a collapsible group, read-only.
export const DEAD_KEYS = new Set(['min_speed', 'max_speed', 'short_seg_threshold_sec'])
