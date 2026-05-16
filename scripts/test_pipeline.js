require('dotenv').config();
const fs = require('fs');
const path = require('path');

const ANTHROPIC_KEY  = process.env.ANTHROPIC_API_KEY;
const ELEVENLABS_KEY = process.env.ELEVENLABS_API_KEY;

if (!ANTHROPIC_KEY || !ELEVENLABS_KEY) {
  console.error('Missing API keys'); process.exit(1);
}

const INPUT_WAV = 'tests/sleep_test_60s.wav';
const TOV_PATH  = 'docs/tone_of_voice.md';
const LESSON_ID = 'sleep_001';

const ok   = (msg) => console.log(`  ✓ ${msg}`);
const step = (n, label) => console.log(`\n[${n}] ${label}`);
const hr   = () => console.log('  ' + '─'.repeat(60));

async function fetchJSON(url, options) {
  const res  = await fetch(url, options);
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok) {
    const msg = typeof body === 'object'
      ? (body.detail?.message || body.error?.message || res.statusText)
      : text;
    const err = new Error(`HTTP ${res.status}: ${msg}`);
    err.body = JSON.stringify(body);
    throw err;
  }
  return body;
}

// ── W1 LOGIC: SEGMENTATION ───────────────────────────────────────────────────

function segmentWords(words, lessonId) {
  const MAX_DURATION = 25;
  const segments = [];
  let current = [];

  function flush() {
    if (!current.length) return;
    const text = current.map(w => w.text.trim()).join(' ').replace(/\s+/g, ' ').trim();
    segments.push({ text, start: current[0].start, end: current[current.length - 1].end });
    current = [];
  }

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const next = words[i + 1];
    current.push(word);
    const dur = word.end - current[0].start;
    const endsWithPunct = /[.!?]['"]?$/.test(word.text.trim());
    if (endsWithPunct || !next || dur >= MAX_DURATION) flush();
  }

  // Merge segments shorter than 3s with previous
  const merged = [];
  for (const seg of segments) {
    const dur = seg.end - seg.start;
    if (dur < 3 && merged.length > 0) {
      const prev = merged[merged.length - 1];
      prev.text += ' ' + seg.text;
      prev.end = seg.end;
    } else {
      merged.push({ ...seg });
    }
  }

  return merged.map((seg, i) => ({
    segment_id:   `${lessonId}_seg_${String(i + 1).padStart(3, '0')}`,
    lesson_id:    lessonId,
    en_text:      seg.text,
    en_start:     parseFloat(seg.start.toFixed(3)),
    en_end:       parseFloat(seg.end.toFixed(3)),
    en_duration:  parseFloat((seg.end - seg.start).toFixed(3)),
  }));
}

// ── W2 LOGIC: TONE ANALYSIS ──────────────────────────────────────────────────

function buildToneAnalysisRequest(segments) {
  const payload = segments.map(s => ({ segment_id: s.segment_id, en_text: s.en_text }));
  return {
    model: 'claude-sonnet-4-5',
    max_tokens: 2000,
    system: 'Classify each wellness/meditation segment. Return ONLY a JSON object where each key is segment_id and value has: segment_type (narrative|instruction|movement), movement_keywords (comma-sep if movement, else empty string), key_concepts (2-4 comma-sep themes). No markdown, no preamble.',
    messages: [{ role: 'user', content: 'Segments:\n\n' + JSON.stringify(payload, null, 2) }],
  };
}

function parseToneMap(claudeResponse) {
  let raw = claudeResponse.content?.[0]?.text?.trim() || '{}';
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON found in tone analysis response');
  return JSON.parse(match[0]);
}

// ── W2 LOGIC: TRANSLATION ────────────────────────────────────────────────────

function buildTranslateRequest(segment, tov, toneMap) {
  const tone = toneMap[segment.segment_id] || {};
  const parts = [
    'Translate the given English text into 7 languages.',
    'Return ONLY a valid JSON object with keys: de, es, fr, pl, pt, it, tr.',
    'Informal address in all languages (du/tu/ty/sen, never formal).',
    "Preserve '...' and '—' as pause timing cues. No preamble, no markdown.",
  ];
  if (tov)               parts.push('\n=== TONE OF VOICE ===\n' + tov + '\n=== END TONE OF VOICE ===');
  if (tone.segment_type) parts.push('Segment type: ' + tone.segment_type);
  if (tone.key_concepts) parts.push('Key concepts: ' + tone.key_concepts);
  return {
    model:      'claude-sonnet-4-5',
    max_tokens: 2000,
    system:     parts.join('\n'),
    messages:   [{ role: 'user', content: segment.en_text.replace(/"/g, "'") }],
  };
}

function parseTranslations(claudeResponse) {
  let text = claudeResponse.content?.[0]?.text?.trim() || '{}';
  text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return {};
  return JSON.parse(match[0]);
}

// ── MAIN ─────────────────────────────────────────────────────────────────────

(async () => {

// ── STEP 1: STT ──────────────────────────────────────────────────────────────
step(1, 'STT — ElevenLabs Scribe');
let words;
try {
  const wavBuffer = fs.readFileSync(INPUT_WAV);
  const blob = new Blob([wavBuffer], { type: 'audio/wav' });
  const form = new FormData();
  form.append('file', blob, path.basename(INPUT_WAV));
  form.append('model_id', 'scribe_v1');
  form.append('timestamps_granularity', 'word');

  const data = await fetchJSON('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: { 'xi-api-key': ELEVENLABS_KEY },
    body: form,
  });
  words = (data.words || []).filter(w => w.type === 'word');
  ok(`STT done: ${words.length} words`);
} catch (e) {
  console.error('  ✗ STT failed:', e.message); process.exit(1);
}

// ── STEP 2: SEGMENTATION (W1 logic) ──────────────────────────────────────────
step(2, 'Segmentation (W1 — Segment Transcript logic)');
let segments;
try {
  segments = segmentWords(words, LESSON_ID);
  ok(`${segments.length} segments`);
  hr();
  segments.forEach(s => {
    const dur = s.en_duration.toFixed(1);
    const preview = s.en_text.length > 70 ? s.en_text.slice(0, 67) + '...' : s.en_text;
    console.log(`  ${s.segment_id}  [${s.en_start}s – ${s.en_end}s, ${dur}s]  "${preview}"`);
  });
} catch (e) {
  console.error('  ✗ Segmentation failed:', e.message); process.exit(1);
}

// ── STEP 3: TONE ANALYSIS (W2 logic) ─────────────────────────────────────────
step(3, 'Tone Analysis (W2 — Claude)');
let toneMap;
try {
  const req = buildToneAnalysisRequest(segments);
  const data = await fetchJSON('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify(req),
  });
  toneMap = parseToneMap(data);
  ok(`Tone map received for ${Object.keys(toneMap).length} segments`);
  hr();
  for (const [sid, meta] of Object.entries(toneMap)) {
    console.log(`  ${sid}  type=${meta.segment_type}  concepts="${meta.key_concepts}"`);
  }
} catch (e) {
  console.error('  ✗ Tone analysis failed:', e.message);
  toneMap = {};
}

// ── STEP 4: TRANSLATE ALL SEGMENTS (W2 logic) ────────────────────────────────
step(4, 'Translation — all segments × 7 langs (W2 — Claude)');
const tov = fs.existsSync(TOV_PATH) ? fs.readFileSync(TOV_PATH, 'utf8') : '';
const results = [];
let ok_count = 0, fail_count = 0;

for (const seg of segments) {
  try {
    const req  = buildTranslateRequest(seg, tov, toneMap);
    const data = await fetchJSON('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(req),
    });
    const t = parseTranslations(data);
    results.push({ segment_id: seg.segment_id, en_duration: seg.en_duration, translations: t });
    const langs = Object.keys(t).join(', ');
    console.log(`  ✓ ${seg.segment_id}  langs: ${langs}`);
    ok_count++;
    // small pause to avoid rate limit
    await new Promise(r => setTimeout(r, 800));
  } catch (e) {
    console.error(`  ✗ ${seg.segment_id}  failed: ${e.message}`);
    fail_count++;
  }
}

// ── SUMMARY ──────────────────────────────────────────────────────────────────
console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PIPELINE TEST RESULTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STT:          ${words.length} words
Segments:     ${segments.length} (W1 logic)
Tone map:     ${Object.keys(toneMap).length} segments classified
Translations: ${ok_count} ok / ${fail_count} failed
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

if (results.length > 0) {
  console.log('\nSample — first segment DE translation:');
  const first = results[0];
  console.log(`  ${first.segment_id} (${first.en_duration}s budget)`);
  console.log(`  DE: "${first.translations.de || '(empty)'}"`);
}

})();
