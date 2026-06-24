// Example "voice sets by course" seeded into the local preset library in mock, so
// the Voices → "Voice sets by course" window isn't empty. Each set is named after
// the course the voices were used on, and carries the 7 pipeline languages with a
// per-course voicing profile (energetic → calm). Voice ids/names mirror the mock
// VOICE_SEED; only the tuning differs per course.
const LANGS = [
  ['de', 'pNInz6obpgDQGcFmaJgB', 'Hanna'],
  ['es', 'EXAVITQu4vr4xnSDxMaL', 'Lucía'],
  ['fr', 'XB0fDUnXU5powFXDhCwa', 'Charlotte'],
  ['it', 'XrExE9yKIg1WjnnlVkGX', 'Matilda'],
  ['pl', 'AZnzlk1XvdvUeBnXmlld', 'Zofia'],
  ['pt', 'TxGEqnHWrfWFTfGW9XjX', 'Beatriz'],
  ['tr', 'jsCqWAovK2LkecY7zXl4', 'Elif'],
]
const MODEL = 'eleven_multilingual_v2'

// One voicing profile per course (stability / style / speed). Stored as strings —
// presets.addSet stringifies anyway, and this keeps the JSON tidy.
function courseVoices({ stability, style, speed }) {
  return LANGS.map(([lang, voice_id, voice_name]) => ({
    lang, voice_id, voice_name, model: MODEL,
    stability: String(stability), similarity_boost: '0.75', style: String(style), speed: String(speed),
  }))
}

export const SEED_COURSE_SETS = [
  { name: 'High Vibration', voices: courseVoices({ stability: 0.4, style: 0.35, speed: 1.06 }) },
  { name: 'Kundalini', voices: courseVoices({ stability: 0.5, style: 0.1, speed: 1.0 }) },
  { name: 'Somatic Yoga', voices: courseVoices({ stability: 0.65, style: 0, speed: 0.9 }) },
]
