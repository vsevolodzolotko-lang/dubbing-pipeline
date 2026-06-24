// Human-friendly labels for the pipeline prompts. The sheet `description` is
// technical (stage codes, revision notes); this maps each key to a plain title +
// one-line purpose + a short stage tag, so the Prompts tab reads at a glance.
export interface PromptMeta { title: string; blurb: string; stage: string }

export const PROMPT_META: Record<string, PromptMeta> = {
  // AI-analysis review prompt (separate endpoint)
  translation_check: { title: 'Translation reviewer', blurb: 'Drives the deep LLM review on the AI analysis tab.', stage: 'AI analysis' },

  // Reference
  tone_of_voice: { title: 'Tone of voice', blurb: 'Brand voice guide the translator and editors follow. Injected as {{tov}}.', stage: 'Reference' },

  // Translation pipeline (W2): classify → translate → verify → edit → shorten
  tone_analysis_system: { title: 'Segment classifier', blurb: 'Tags each English segment as narrative / instruction / movement.', stage: 'W2 · Prepare' },
  translate_system: { title: 'Translator', blurb: 'First-pass translation of every segment into all languages.', stage: 'W2 · Translate' },
  qa_verify_system: { title: 'Semantic reviewer', blurb: 'Catches meaning errors: false friends, formality, register, consistency.', stage: 'W2 · Verify' },
  editor_system: { title: 'Native-rhythm editor', blurb: 'Polishes phrasing so it reads naturally to a native speaker.', stage: 'W2 · Edit' },
  adapt_shorten_system: { title: 'Shortener rules', blurb: 'Guardrails for shortening a line that overflows its time slot.', stage: 'W2 · Adapt' },
  adapt_attempt_template: { title: 'Shorten request', blurb: 'The instruction sent on each shortening attempt (light → max).', stage: 'W2 · Adapt' },
  adapt_attempt_light: { title: 'Shorten request — light', blurb: 'Legacy attempt-1 prompt; replaced by the unified shorten request.', stage: 'W2 · Adapt' },
  adapt_attempt_medium: { title: 'Shorten request — medium', blurb: 'Legacy attempt-2 prompt; replaced by the unified shorten request.', stage: 'W2 · Adapt' },
  adapt_attempt_max: { title: 'Shorten request — max', blurb: 'Legacy attempt-3 prompt; replaced by the unified shorten request.', stage: 'W2 · Adapt' },

  // Synthesis timing (W3): last-mile fit fixes
  w3_shorten_system: { title: 'Trim to fit', blurb: 'Shortens a segment whose synthesized audio came out slightly too long.', stage: 'W3 · Timing' },
  w3_expand_system: { title: 'Expand to fit', blurb: 'Lengthens a segment whose synthesized audio came out too short.', stage: 'W3 · Timing' },
}

export const GROUP_BLURB: Record<string, string> = {
  'Quality (AI analysis)': 'The prompt behind the deep LLM review on the AI analysis tab.',
  Reference: 'Shared guidance the other prompts pull in.',
  'Translation (W2)': 'The translate → verify → edit → shorten pipeline.',
  'Synthesis timing (W3)': 'Last-mile fixes when synthesized audio does not fit its slot.',
  Deprecated: 'Kept for rollback; the current pipeline does not use these.',
}
