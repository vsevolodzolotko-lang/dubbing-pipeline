// Reads a localizations CSV (exported from the Google Sheet) and prints the
// observed CPS (chars-per-second) per language, based on rows where
// final_speed == 1 (so speed-adjusted segments don't skew the measurement).
//
// Usage:
//   node scripts/analyze_cps.js path/to/localizations.csv
//
// Output:
//   - Per-segment CPS rows (so you can spot outliers)
//   - Summary table with weighted mean CPS per lang, current config value,
//     and recommended config value to copy into the `config` sheet.
//
// Why this script: CPS values live in the `config` sheet as
// `cps_estimate_{lang}` rows. They are read by W2 Adapt Translations and W3
// Check Timing + Pad. After each W3 run, you can use this script to confirm
// that the configured CPS still matches what the current voices actually
// produce — and update the sheet if a voice change shifted the numbers.

const fs   = require('fs');
const path = require('path');

const csvPath = process.argv[2];
if (!csvPath) {
  console.error('usage: node scripts/analyze_cps.js <localizations.csv>');
  process.exit(1);
}

// Minimal CSV parser — handles quoted fields with commas and escaped quotes.
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { field += c; }
    } else {
      if (c === '"') { inQuotes = true; }
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') { /* skip */ }
      else { field += c; }
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const raw  = fs.readFileSync(csvPath, 'utf8');
const rows = parseCsv(raw).filter(r => r.length > 1);
if (rows.length < 2) { console.error('CSV looks empty'); process.exit(1); }

const header = rows[0];
const idx = name => header.indexOf(name);

const C = {
  segment_id:        idx('segment_id'),
  lang:              idx('lang'),
  text_translated:   idx('text_translated'),
  real_duration_sec: idx('real_duration_sec'),
  final_speed:       idx('final_speed'),
};
for (const [k, v] of Object.entries(C)) {
  if (v < 0) { console.error(`missing column: ${k}`); process.exit(1); }
}

// Read current cps_estimate_* values from config sheet (optional sibling file)
const configPath = path.join(path.dirname(csvPath), 'config.csv');
const currentCps = {};
if (fs.existsSync(configPath)) {
  const configRows = parseCsv(fs.readFileSync(configPath, 'utf8')).filter(r => r.length >= 2);
  for (const row of configRows) {
    const m = (row[0] || '').match(/^cps_estimate_([a-z]{2})$/i);
    if (m) currentCps[m[1].toLowerCase()] = parseFloat(row[1]) || null;
  }
}

const byLang = {};
for (let i = 1; i < rows.length; i++) {
  const r = rows[i];
  const lang  = (r[C.lang] || '').trim();
  const text  = r[C.text_translated] || '';
  const dur   = parseFloat(r[C.real_duration_sec]) || 0;
  const speed = parseFloat(r[C.final_speed]) || 0;
  if (!lang || !text.trim() || dur <= 0 || speed !== 1) continue;
  if (!byLang[lang]) byLang[lang] = { samples: [], totalChars: 0, totalSec: 0 };
  const charsLen = text.trim().length;
  const cps = charsLen / dur;
  byLang[lang].samples.push({ segment_id: r[C.segment_id], chars: charsLen, dur, cps });
  byLang[lang].totalChars += charsLen;
  byLang[lang].totalSec   += dur;
}

console.log('\n== Per-segment CPS (final_speed=1.0 only) ==');
for (const lang of Object.keys(byLang).sort()) {
  console.log(`\n[${lang}]`);
  for (const s of byLang[lang].samples) {
    console.log(`  ${s.segment_id.padEnd(22)} ${String(s.chars).padStart(4)} chars / ${s.dur.toFixed(3).padStart(6)}s = ${s.cps.toFixed(2)} cps`);
  }
}

console.log('\n== Summary: weighted mean CPS per lang ==');
console.log('lang  samples  totalChars  totalSec  observed_cps   current  recommend  delta');
console.log('----  -------  ----------  --------  ------------   -------  ---------  -----');
for (const lang of Object.keys(byLang).sort()) {
  const b = byLang[lang];
  const observed = b.totalChars / b.totalSec;
  const current  = currentCps[lang];
  // Recommend rounding to nearest 0.5 to keep config tidy
  const recommend = Math.round(observed * 2) / 2;
  const delta = current != null ? (observed - current).toFixed(2) : '-';
  console.log(
    `${lang.padEnd(4)}  ${String(b.samples.length).padStart(7)}  ${String(b.totalChars).padStart(10)}  ${b.totalSec.toFixed(2).padStart(8)}  ${observed.toFixed(2).padStart(12)}  ${current != null ? current.toFixed(2).padStart(7) : '   -   '}  ${recommend.toFixed(2).padStart(9)}  ${String(delta).padStart(5)}`
  );
}

console.log('\nLegend:');
console.log('  observed_cps = totalChars / totalSec (weighted mean across all rows for the lang)');
console.log('  current      = cps_estimate_{lang} from config.csv if present alongside the localizations CSV');
console.log('  recommend    = observed_cps rounded to nearest 0.5 (good config value)');
console.log('  delta        = observed - current (sign and magnitude of drift from configured value)');
console.log('\nIf |delta| > 1.0 cps, consider updating the config sheet.');
