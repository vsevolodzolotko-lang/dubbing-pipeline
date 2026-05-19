#!/usr/bin/env node
// Offline simulator for the borrow-compensation fix in W3's Build Full Audio Per Lang.
// Reads a localizations CSV (export the `localizations` sheet from the Google Sheet)
// and reports, per language, where each segment would land on the EN timeline
// BEFORE and AFTER the fix. Use this to verify the patch math without re-running W3.
//
// Usage:
//   node scripts/verify_borrow_compensation.js <path-to-localizations.csv> [lesson_id]
//
// Example:
//   node scripts/verify_borrow_compensation.js ~/Downloads/localizations.csv the_anchor
//
// Output: per-lang table — for every segment, |drift| (start position vs en_start)
// with and without the fix. If the fix works, the "fixed" column should be ≈0
// (within ±1 sample = ±0.05 ms at 22050 Hz; we tolerate 0.005 s for CSV rounding).

const fs   = require('fs');
const path = require('path');

const TOLERANCE_SEC = 0.005;  // tolerate Sheet round-trip rounding (3-decimal)

function parseCsv(text) {
  // Minimal CSV parser that handles quoted fields containing commas/newlines.
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
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.length > 1 || row[0] !== '') rows.push(row);
        row = [];
      } else { field += c; }
    }
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  const header = rows.shift();
  return rows.map(r => Object.fromEntries(header.map((h, i) => [h.trim(), r[i] ?? ''])));
}

function num(v) { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; }

function main() {
  const [, , csvPathArg, lessonIdArg] = process.argv;
  if (!csvPathArg) {
    console.error('Usage: node scripts/verify_borrow_compensation.js <localizations.csv> [lesson_id]');
    process.exit(2);
  }
  const csvPath = path.resolve(csvPathArg);
  if (!fs.existsSync(csvPath)) { console.error(`File not found: ${csvPath}`); process.exit(2); }

  const rows = parseCsv(fs.readFileSync(csvPath, 'utf8'));
  const filtered = lessonIdArg
    ? rows.filter(r => (r.segment_id || '').startsWith(lessonIdArg + '_'))
    : rows;
  if (filtered.length === 0) { console.error('No rows matched.'); process.exit(1); }

  // Group by lang, sorted by segment_id (lexicographic on zero-padded suffix).
  const byLang = {};
  for (const r of filtered) {
    if (!r.lang) continue;
    (byLang[r.lang] ||= []).push(r);
  }
  for (const lang of Object.keys(byLang)) {
    byLang[lang].sort((a, b) => a.segment_id.localeCompare(b.segment_id));
  }

  let anyFail = false;
  for (const lang of Object.keys(byLang).sort()) {
    const segs = byLang[lang];
    let posBefore = 0;        // cursor on the concat timeline, no fix
    let posAfter  = 0;        // cursor on the concat timeline, with fix
    let prevBorrow = 0;       // for the fix path
    let totalBorrow = 0;
    let totalTrim = 0;
    const drifts = [];
    for (const r of segs) {
      const enStart    = num(r.en_start_sec);
      const lead       = num(r.lead_silence_sec);
      const finalDur   = num(r.final_duration_sec);
      const borrowed   = num(r.borrowed_sec);

      // Before fix: segment file plays exactly as concatenated.
      // Segment's TTS payload (after lead silence) starts at posBefore + lead.
      const startBefore = posBefore + lead;
      // After fix: trim prevBorrow from the head of this segment's PCM, so the
      // effective lead becomes (lead - trim). TTS payload starts at posAfter + (lead - trim).
      const trim      = Math.min(prevBorrow, lead);
      const startAfter = posAfter + (lead - trim);
      totalTrim += trim;

      const driftBefore = startBefore - enStart;
      const driftAfter  = startAfter  - enStart;
      drifts.push({ sid: r.segment_id, enStart, lead, borrowed, driftBefore, driftAfter });

      posBefore += finalDur;
      posAfter  += finalDur - trim;
      prevBorrow = borrowed;
      totalBorrow += borrowed;
    }

    const maxBefore = Math.max(...drifts.map(d => Math.abs(d.driftBefore)));
    const maxAfter  = Math.max(...drifts.map(d => Math.abs(d.driftAfter)));
    const pass = maxAfter <= TOLERANCE_SEC;
    if (!pass) anyFail = true;

    console.log(`\n=== ${lang} === (${segs.length} segs)`);
    console.log(`  total borrowed_sec:  ${totalBorrow.toFixed(3)}s`);
    console.log(`  total trimmed lead:  ${totalTrim.toFixed(3)}s  (should equal total borrow when leads are sufficient)`);
    console.log(`  max |drift| BEFORE:  ${maxBefore.toFixed(3)}s`);
    console.log(`  max |drift| AFTER:   ${maxAfter.toFixed(3)}s   ${pass ? '✓ PASS' : '✗ FAIL'}`);
    // Show offending segments (top 5 by |drift|)
    const worstBefore = [...drifts].sort((a, b) => Math.abs(b.driftBefore) - Math.abs(a.driftBefore)).slice(0, 5);
    if (worstBefore[0] && Math.abs(worstBefore[0].driftBefore) > TOLERANCE_SEC) {
      console.log(`  worst pre-fix drifts:`);
      for (const d of worstBefore) {
        if (Math.abs(d.driftBefore) <= TOLERANCE_SEC) break;
        console.log(`    ${d.sid.padEnd(28)} drift=${d.driftBefore.toFixed(3).padStart(7)}s  borrowed=${d.borrowed.toFixed(3)}s`);
      }
    }
    if (!pass) {
      console.log(`  worst post-fix drifts:`);
      const worstAfter = [...drifts].sort((a, b) => Math.abs(b.driftAfter) - Math.abs(a.driftAfter)).slice(0, 5);
      for (const d of worstAfter) {
        if (Math.abs(d.driftAfter) <= TOLERANCE_SEC) break;
        console.log(`    ${d.sid.padEnd(28)} drift=${d.driftAfter.toFixed(3).padStart(7)}s  lead=${d.lead.toFixed(3)}s  borrowed=${d.borrowed.toFixed(3)}s`);
      }
    }
  }

  process.exit(anyFail ? 1 : 0);
}

main();
