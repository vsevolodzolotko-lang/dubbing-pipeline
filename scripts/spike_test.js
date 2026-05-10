require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ─── HELPERS ───────────────────────────────────────────────────────────────

const ok = (msg) => console.log(`  ✓ ${msg}`);
const step = (n, label) => console.log(`\n[${n}/7] ${label}`);

function bail(stepNum, err) {
  const detail = err.body ? `${err.message}\n  Body: ${err.body}` : err.message || String(err);
  console.error(`  ✗ Step ${stepNum} failed: ${detail}`);
  process.exit(1);
}

function parseCSV(src) {
  const [headerLine, ...rows] = src.trim().split('\n');
  const headers = headerLine.split(',');
  return rows.map(row => {
    const cols = row.split(',');
    return Object.fromEntries(headers.map((h, i) => [h.trim(), (cols[i] || '').trim()]));
  });
}

function ffprobeDuration(filePath) {
  const out = execSync(
    `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${filePath}"`
  ).toString().trim();
  return parseFloat(out);
}

async function fetchJSON(url, options) {
  const res = await fetch(url, options);
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok) {
    const err = new Error(typeof body === 'object' ? (body.detail?.message || body.error?.message || res.statusText) : text);
    err.status = res.status;
    err.body = typeof body === 'string' ? body : JSON.stringify(body);
    throw err;
  }
  return body;
}

// ─── STEP 1: CONFIG ────────────────────────────────────────────────────────

step(1, 'Loading config');

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const ELEVENLABS_KEY = process.env.ELEVENLABS_API_KEY;

const missing = [];
if (!ANTHROPIC_KEY) missing.push('ANTHROPIC_API_KEY');
if (!ELEVENLABS_KEY) missing.push('ELEVENLABS_API_KEY');
if (missing.length) {
  console.error(`  ✗ Missing env vars: ${missing.join(', ')}`);
  process.exit(1);
}
ok('API keys present');

const INPUT_WAV   = 'tests/sleep_test_60s.wav';
const OUT_EN_TXT  = 'tests/transcript_en.txt';
const OUT_DE_TXT  = 'tests/transcript_de.txt';
const OUT_DE_MP3  = 'tests/output_de.mp3';

if (!fs.existsSync(INPUT_WAV)) {
  console.error(`  ✗ Input file not found: ${INPUT_WAV}`);
  process.exit(1);
}
ok(`Input: ${INPUT_WAV}`);

let tov;
try {
  tov = fs.readFileSync('docs/tone_of_voice.md', 'utf8');
  ok(`Tone of voice loaded (${tov.length} chars)`);
} catch (e) {
  bail(1, e);
}

let deVoiceId, deModel, deStability, deSimilarity, deStyle, deSpeed;
try {
  const rows = parseCSV(fs.readFileSync('sheets/voices.csv', 'utf8'));
  const de = rows.find(r => r.lang === 'de');
  if (!de) throw new Error('No DE row in voices.csv');
  if (!de.voice_id) throw new Error('voice_id empty for DE — fill in sheets/voices.csv');
  deVoiceId   = de.voice_id;
  deModel     = de.model || 'eleven_multilingual_v2';
  deStability = parseFloat(de.stability)        || 0.5;
  deSimilarity = parseFloat(de.similarity_boost) || 0.75;
  deStyle     = parseFloat(de.style)            || 0;
  deSpeed     = parseFloat(de.speed)            || 1.0;
  ok(`DE voice: ${deVoiceId}  model: ${deModel}  stability: ${deStability}  speed: ${deSpeed}`);
} catch (e) {
  bail(1, e);
}

// ─── STEPS 2–7 ─────────────────────────────────────────────────────────────

(async () => {

// ─── STEP 2: STT ───────────────────────────────────────────────────────────

step(2, 'STT — ElevenLabs Scribe');

let enText;
try {
  const wavBuffer = fs.readFileSync(INPUT_WAV);
  const blob = new Blob([wavBuffer], { type: 'audio/wav' });
  const form = new FormData();
  form.append('file', blob, path.basename(INPUT_WAV));
  form.append('model_id', 'scribe_v1');

  const data = await fetchJSON('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: { 'xi-api-key': ELEVENLABS_KEY },
    body: form,
  });

  enText = data.text;
  fs.writeFileSync(OUT_EN_TXT, enText, 'utf8');
  const enWords = enText.trim().split(/\s+/).length;
  ok(`Transcribed: ${enText.length} chars, ${enWords} words → ${OUT_EN_TXT}`);
} catch (e) {
  bail(2, e);
}

// ─── STEP 3: EN DURATION ───────────────────────────────────────────────────

step(3, 'EN audio duration (ffprobe)');

let enDuration;
try {
  enDuration = ffprobeDuration(INPUT_WAV);
  ok(`EN duration: ${enDuration.toFixed(2)}s`);
} catch (e) {
  bail(3, e);
}

// ─── STEP 4: TRANSLATE ─────────────────────────────────────────────────────

step(4, 'Translate EN→DE (Claude Sonnet)');

let deText;
try {
  const systemPrompt =
    'You are translating English meditation/wellness content to German for a wellness app. ' +
    'Follow this brand tone of voice precisely:\n\n' + tov + '\n\n' +
    'Guidelines:\n' +
    "- Translate to natural, fluent German\n" +
    "- Preserve meditative, calm tone — warmth over literal accuracy\n" +
    "- Preserve any '...' (ellipsis) or '—' (em-dash) — these are pause timing cues for audio synthesis\n" +
    "- If the source has no explicit pause markers but a sentence break feels long/contemplative, you MAY add '...' to preserve breathing rhythm\n" +
    '- Use natural German length, do NOT artificially shorten or lengthen\n' +
    "- Write numbers as words (e.g., 'drei' not '3')\n" +
    '- Output ONLY the German translation, no preamble, no commentary';

  const data = await fetchJSON('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: enText }],
    }),
  });

  deText = data.content[0].text;
  fs.writeFileSync(OUT_DE_TXT, deText, 'utf8');
  const ratio = ((deText.length / enText.length) * 100).toFixed(1);
  ok(`Translated: ${deText.length} chars (${ratio}% of EN) → ${OUT_DE_TXT}`);
} catch (e) {
  bail(4, e);
}

// ─── STEP 5: TTS ───────────────────────────────────────────────────────────

step(5, 'TTS — ElevenLabs');

try {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${deVoiceId}?output_format=mp3_44100_192`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': ELEVENLABS_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        text: deText,
        model_id: deModel,
        voice_settings: {
          stability: deStability,
          similarity_boost: deSimilarity,
          style: deStyle,
          speed: deSpeed,
        },
      }),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    const err = new Error(`HTTP ${res.status}: ${res.statusText}`);
    err.body = body;
    throw err;
  }

  const buffer = await res.arrayBuffer();
  fs.writeFileSync(OUT_DE_MP3, Buffer.from(buffer));
  const kb = (buffer.byteLength / 1024).toFixed(1);
  ok(`Audio saved: ${kb} KB → ${OUT_DE_MP3}`);
} catch (e) {
  bail(5, e);
}

// ─── STEP 6: DE DURATION ───────────────────────────────────────────────────

step(6, 'DE audio duration (ffprobe)');

let deDuration;
try {
  deDuration = ffprobeDuration(OUT_DE_MP3);
  ok(`DE duration: ${deDuration.toFixed(2)}s`);
} catch (e) {
  bail(6, e);
}

// ─── STEP 7: SUMMARY ───────────────────────────────────────────────────────

step(7, 'Summary');

const enWords = enText.trim().split(/\s+/).length;
const lengthDiff = (((deDuration - enDuration) / enDuration) * 100).toFixed(1);
const charRatio = (deText.length / enText.length).toFixed(2);

console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SPIKE TEST RESULTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EN audio:    ${enDuration.toFixed(1)}s, ${enText.length} chars, ${enWords} words
DE audio:    ${deDuration.toFixed(1)}s, ${deText.length} chars
Length diff: ${lengthDiff}% (DE vs EN)
Char ratio:  ${charRatio}x
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Files saved:
• ${OUT_EN_TXT}
• ${OUT_DE_TXT}
• ${OUT_DE_MP3}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

})();
