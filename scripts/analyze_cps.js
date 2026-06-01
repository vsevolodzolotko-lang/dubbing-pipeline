// CPS calibration tool v2.
//
// Reads one or more `localizations` CSVs exported from the Google Sheet and
// prints observed chars-per-second (CPS) per language, with optional
// per-(lang, segment_type) breakdown when a `segments` CSV is provided.
//
// CPS values live in the `config` sheet as `cps_estimate_{lang}` rows. They
// are read by W2 Adapt Translations and W3 Check Timing + Pad to predict
// whether a translation will fit a slot. After a voice change, voice-param
// tweak, or content-type shift (meditative ↔ educational), re-run this script
// to see whether observed CPS still matches what's configured.
//
// Usage:
//   node scripts/analyze_cps.js <localizations.csv> [more.csv ...]
//        [--segments=<segments.csv>]   # enables per-segment_type breakdown
//        [--voices=<voices.csv>]       # default: sheets/voices.csv
//        [--config=<config.csv>]       # auto-detected next to first CSV
//
// Filtering: for each lang, the script auto-detects the default voice speed
// as min(final_speed) observed in the data (since voice defaults vary —
// PT often runs at 0.9, TR at 0.8). Only rows at that default speed are
// used for CPS measurement (retries at 1.10/1.15 are excluded — those are
// compression, not natural pace).
//
// Output:
//   - Per-lang summary table with observed_cps, current, recommend, delta.
//   - Per-(lang, segment_type) breakdown if segments.csv was provided.
//   - voice_id snapshot from voices.csv to help spot voice changes between
//     runs.
//   - Copy-pasteable update commands for the config sheet.

const fs   = require('fs');
const path = require('path');

// --- arg parsing ---
const args = process.argv.slice(2);
const csvPaths = [];
const opts = {};
for (const a of args) {
  if (a.startsWith('--segments=')) opts.segments = a.slice('--segments='.length);
  else if (a.startsWith('--voices=')) opts.voices = a.slice('--voices='.length);
  else if (a.startsWith('--config=')) opts.config = a.slice('--config='.length);
  else if (a.startsWith('--')) { console.error('unknown flag:', a); process.exit(1); }
  else csvPaths.push(a);
}

const SCRIPT_DIR = path.dirname(__filename);
const REPO       = path.dirname(SCRIPT_DIR);

// Zero-arg fallback: if no positional CSVs were passed, auto-discover any
// `localizations*.csv` files sitting next to this script. Lets the user drop
// the script (or a .command wrapper) into a folder alongside their exported
// CSVs and run it with no arguments. Also auto-picks up config.csv,
// segments.csv, voices.csv from the same directory if present.
if (csvPaths.length === 0) {
  try {
    const candidates = fs.readdirSync(SCRIPT_DIR)
      .filter(f => /^localizations.*\.csv$/i.test(f))
      .map(f => path.join(SCRIPT_DIR, f));
    if (candidates.length > 0) {
      for (const p of candidates) csvPaths.push(p);
      console.error(`auto-discovered ${candidates.length} localizations CSV(s) next to the script:`);
      for (const p of candidates) console.error(`  - ${path.basename(p)}`);
      const sameDir = (name) => {
        const p = path.join(SCRIPT_DIR, name);
        return fs.existsSync(p) ? p : null;
      };
      if (!opts.segments) { const p = sameDir('segments.csv'); if (p) opts.segments = p; }
      if (!opts.voices)   { const p = sameDir('voices.csv');   if (p) opts.voices = p; }
      if (!opts.config)   { const p = sameDir('config.csv');   if (p) opts.config = p; }
    }
  } catch (_) { /* fall through to usage */ }
}

if (csvPaths.length === 0) {
  console.error('usage: node scripts/analyze_cps.js <localizations.csv> [more.csv ...]');
  console.error('       [--segments=<segments.csv>] [--voices=<voices.csv>] [--config=<config.csv>]');
  console.error('');
  console.error('zero-arg shortcut: place this script in a folder with localizations*.csv');
  console.error('(plus optionally config.csv / segments.csv / voices.csv) and run it without args.');
  process.exit(1);
}

const voicesPath = opts.voices  || path.join(REPO, 'sheets/voices.csv');
const configPath = opts.config  || path.join(path.dirname(csvPaths[0]), 'config.csv');

// --- minimal CSV parser ---
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c !== '\r') field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function loadCsv(p, required) {
  if (!fs.existsSync(p)) {
    if (required) { console.error('missing required file:', p); process.exit(1); }
    return null;
  }
  return parseCsv(fs.readFileSync(p, 'utf8')).filter(r => r.length > 1);
}

// --- read all localization CSVs ---
const samples = [];
for (const p of csvPaths) {
  const rows = loadCsv(p, true);
  if (rows.length < 2) { console.error('CSV looks empty:', p); continue; }
  const h = rows[0];
  const I = n => h.indexOf(n);
  const C = {
    segment_id:        I('segment_id'),
    lang:              I('lang'),
    text_translated:   I('text_translated'),
    real_duration_sec: I('real_duration_sec'),
    final_speed:       I('final_speed'),
  };
  for (const [k, v] of Object.entries(C)) {
    if (v < 0) { console.error(`${p}: missing column ${k}`); process.exit(1); }
  }
  const sourceLabel = path.basename(p);
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const lang  = (r[C.lang] || '').trim();
    const text  = (r[C.text_translated] || '').trim();
    const dur   = parseFloat(r[C.real_duration_sec]) || 0;
    const speed = parseFloat(r[C.final_speed]) || 0;
    if (!lang || !text || dur <= 0 || speed <= 0) continue;
    samples.push({
      source: sourceLabel,
      segment_id: r[C.segment_id],
      lang, text, chars: text.length, dur, speed,
    });
  }
  console.error(`loaded ${rows.length - 1} rows from ${sourceLabel}`);
}
console.error(`total raw samples: ${samples.length}\n`);

// --- optional: load segments.csv for per-segment_type join ---
const segmentTypeMap = {};
if (opts.segments) {
  const rows = loadCsv(opts.segments, true);
  const h = rows[0];
  const sidCol = h.indexOf('segment_id');
  const stCol  = h.indexOf('segment_type');
  if (sidCol < 0 || stCol < 0) {
    console.error('segments.csv missing segment_id or segment_type column');
    process.exit(1);
  }
  for (let i = 1; i < rows.length; i++) {
    const sid = (rows[i][sidCol] || '').trim();
    const st  = (rows[i][stCol]  || '').trim();
    if (sid && st) segmentTypeMap[sid] = st;
  }
  console.error(`loaded segment_type for ${Object.keys(segmentTypeMap).length} segments\n`);
}

// --- optional: load voices.csv for voice_id snapshot ---
const voiceIds = {};
if (fs.existsSync(voicesPath)) {
  const rows = loadCsv(voicesPath, false);
  if (rows) {
    const h = rows[0];
    const langCol = h.indexOf('lang');
    const vidCol  = h.indexOf('voice_id');
    if (langCol >= 0 && vidCol >= 0) {
      for (let i = 1; i < rows.length; i++) {
        const lang = (rows[i][langCol] || '').trim();
        const vid  = (rows[i][vidCol]  || '').trim();
        if (lang && vid) voiceIds[lang] = vid;
      }
    }
  }
}

// --- optional: load config.csv for current cps_estimate_* ---
const currentCps = {};
if (fs.existsSync(configPath)) {
  const rows = loadCsv(configPath, false);
  if (rows) {
    for (const row of rows) {
      const m = (row[0] || '').match(/^cps_estimate_([a-z]{2})$/i);
      if (m) currentCps[m[1].toLowerCase()] = parseFloat(row[1]) || null;
    }
  }
}
// Fallback: hardcoded defaults from docs/config_keys.md
const HARDCODED_DEFAULTS = { de: 12, es: 15, fr: 15, it: 14, pl: 14, pt: 16, tr: 14 };
for (const [l, v] of Object.entries(HARDCODED_DEFAULTS)) {
  if (currentCps[l] == null) currentCps[l] = v;
}

// --- detect default voice speed per lang ---
// Voice's natural playback speed = min(final_speed) observed in data.
// (Retries always go UP from default — 1.10, 1.15 — so min is the floor.)
const defaultSpeed = {};
for (const s of samples) {
  if (defaultSpeed[s.lang] == null || s.speed < defaultSpeed[s.lang]) {
    defaultSpeed[s.lang] = s.speed;
  }
}

// --- aggregate observed CPS per lang at default speed ---
const byLang = {};
for (const s of samples) {
  if (s.speed !== defaultSpeed[s.lang]) continue;
  if (!byLang[s.lang]) byLang[s.lang] = { samples: [], chars: 0, sec: 0 };
  byLang[s.lang].samples.push(s);
  byLang[s.lang].chars += s.chars;
  byLang[s.lang].sec   += s.dur;
}

// --- per-(lang, segment_type) if segments.csv provided ---
const byLangType = {};
if (Object.keys(segmentTypeMap).length > 0) {
  for (const s of samples) {
    if (s.speed !== defaultSpeed[s.lang]) continue;
    const st = segmentTypeMap[s.segment_id];
    if (!st) continue;
    const key = `${s.lang}|${st}`;
    if (!byLangType[key]) byLangType[key] = { lang: s.lang, type: st, samples: [], chars: 0, sec: 0 };
    byLangType[key].samples.push(s);
    byLangType[key].chars += s.chars;
    byLangType[key].sec   += s.dur;
  }
}

// --- output ---
console.log('========================================');
console.log('CPS calibration report');
console.log('========================================\n');

console.log('Per-lang summary (each lang at its detected default voice speed):\n');
console.log('lang  voice_id              default_spd  N      chars  sec      obs_cps  current  recommend  delta  confidence');
console.log('----  --------------------  -----------  -----  -----  -------  -------  -------  ---------  -----  ----------');

const recommendations = [];
const LANGS = ['de','es','fr','it','pl','pt','tr'];
for (const lang of LANGS) {
  const b = byLang[lang];
  if (!b || b.samples.length === 0) {
    console.log(`${lang.padEnd(4)}  ${(voiceIds[lang] || '(no voices.csv)').padEnd(20)}                ${'(no data)'.padStart(40)}`);
    continue;
  }
  const observed = b.chars / b.sec;
  const recommend = Math.round(observed * 2) / 2;
  const current = currentCps[lang];
  const delta = observed - current;
  const conf = b.samples.length >= 20 ? 'HIGH'
             : b.samples.length >= 10 ? 'MED'
             : 'LOW';
  console.log(
    `${lang.padEnd(4)}  ${(voiceIds[lang] || '').padEnd(20)}  ${defaultSpeed[lang].toFixed(2).padStart(11)}  ` +
    `${String(b.samples.length).padStart(5)}  ${String(b.chars).padStart(5)}  ${b.sec.toFixed(2).padStart(7)}  ` +
    `${observed.toFixed(2).padStart(7)}  ${current.toFixed(2).padStart(7)}  ${recommend.toFixed(2).padStart(9)}  ` +
    `${delta.toFixed(2).padStart(5)}  ${conf.padStart(10)}`
  );
  if (Math.abs(delta) > 1.0) recommendations.push({ lang, current, recommend, delta, conf });
}

// --- per-(lang, segment_type) breakdown ---
if (Object.keys(byLangType).length > 0) {
  console.log('\n\nPer-(lang, segment_type) breakdown:');
  console.log('(Useful for spotting content-type drift — e.g. instructions speak slower than narrative.)\n');
  console.log('lang  type         N      obs_cps  delta_vs_lang_mean');
  console.log('----  -----------  -----  -------  ------------------');
  const sorted = Object.values(byLangType).sort((a, b) =>
    a.lang.localeCompare(b.lang) || a.type.localeCompare(b.type)
  );
  for (const g of sorted) {
    const obs = g.chars / g.sec;
    const langMean = byLang[g.lang] ? byLang[g.lang].chars / byLang[g.lang].sec : null;
    const drift = langMean != null ? (obs - langMean).toFixed(2) : '-';
    console.log(
      `${g.lang.padEnd(4)}  ${g.type.padEnd(11)}  ${String(g.samples.length).padStart(5)}  ` +
      `${obs.toFixed(2).padStart(7)}  ${String(drift).padStart(18)}`
    );
  }
  console.log('\nIf |delta_vs_lang_mean| > 1.5 for any segment_type, that content class');
  console.log('speaks measurably differently — consider per-content-type CPS in the future.');
}

// --- recommendations ---
console.log('\n\n========================================');
console.log('Recommended config updates (|delta| > 1.0)');
console.log('========================================\n');

if (recommendations.length === 0) {
  console.log('  None — all current CPS values are within ±1.0 cps of observed.\n');
} else {
  console.log('Open the `config` sheet in Google Sheets and update these key/value rows:\n');
  for (const r of recommendations) {
    const direction = r.delta < 0 ? '↓' : '↑';
    console.log(`  cps_estimate_${r.lang}   ${r.current.toFixed(1)} → ${r.recommend.toFixed(1)}   ${direction} delta ${r.delta.toFixed(2)}, ${r.conf} confidence (N=${byLang[r.lang].samples.length})`);
  }
  console.log('\nAfter editing the sheet, re-run this script to confirm new values are stable.');
}

// --- legend / next steps ---
console.log(`
Notes:
  - "default_spd" is auto-detected as min(final_speed) per lang. PT/TR voices typically
    run below 1.0 by default; other langs at 1.0.
  - "current" reads from config.csv if you exported it alongside localizations; otherwise
    uses hardcoded defaults from docs/config_keys.md.
  - "confidence" — LOW (<10 samples) / MED (10-19) / HIGH (≥20). Don't trust LOW deltas.
  - "voice_id" snapshot from sheets/voices.csv. If voice changed between runs, old CPS
    values are stale — re-calibrate against new voice data.

Next steps if you updated config values:
  1. Edit the \`config\` sheet rows shown above.
  2. Run one more lesson through W3 to validate predictions match reality.
  3. Re-run this script with the new lesson's CSV to confirm |delta| < 1.0 across all langs.
`);
