// Trim Lead For Sequence — runs AFTER Phase 2 + Download Segment WAV, BEFORE
// Build Full Audio Per Lang.
//
// Refactor 2026-05-31: previously, per-segment WAVs preserved their natural
// lead silence (= EN gap from previous segment's end to this segment's start).
// For most segments this works perfectly when concat'd end-to-end. For the 4
// short-segment borrow cases per lesson (en_dur < 2s with TTS overflow), the
// segment file extends past its slot_end by up to ~0.6s into the next EN
// silence. End-to-end placement of those individual WAVs (e.g. in Reaper)
// therefore drifts cumulatively — the editor sees ~1.5s overrun by the end
// of the lesson. Build Full Audio Per Lang compensated for this at concat
// time, but the individual files in Drive themselves were over-long.
//
// This node trims each segment's lead silence by the previous segment's
// borrowed_sec, in-place on the downloaded binary. Result: individual WAVs
// in Drive are now co-aligned with the full concat (sum end-to-end = full
// duration). Build Full Audio Per Lang's inline trim logic is removed
// (segments come in already trimmed). End-to-end placement in DAWs works
// correctly without manual adjustment.
//
// Items where trim happened carry `trimmed_for_seq: true` in their json,
// along with the new lead_silence_sec + final_duration_sec values. A
// downstream "Has Trim?" IF routes those to a Drive PATCH so the new audio
// overwrites the Drive copies; non-trimmed items flow through unchanged.

const SAMPLE_RATE = 44100;
const BPS         = 2;

const lesson_id = $('Get Params').first().json.lesson_id;

// Read borrow + lead values from the localizations sheet (authoritative source).
// Same pattern as Build Full Audio Per Lang.
const locMap = {};
$('Read Localizations Fresh 2').all().forEach(i => {
  const j = i.json || {};
  if (!j.segment_id || !j.lang) return;
  locMap[`${j.segment_id}_${j.lang}`] = {
    borrowed_sec:        parseFloat(j.borrowed_sec) || 0,
    lead_silence_sec:    parseFloat(j.lead_silence_sec) || 0,
    final_duration_sec:  parseFloat(j.final_duration_sec) || 0,
  };
});

const items = $input.all();
if (!items.length) throw new Error('Trim Lead For Sequence: no items — Download Segment WAV must run first');

// indexMap lets us pass the ORIGINAL item index to getBinaryDataBuffer after
// we sort by lang × segment_id below. Same idiom as Build Full Audio.
const indexMap = new Map(items.map((it, idx) => [it, idx]));

// Group by lang, sort by segment_id within each lang. Ordered iteration is
// essential — borrow compensation is a "previous-segment" chain.
const byLang = {};
for (const it of items) {
  const lang = it.json?.lang;
  const sid  = it.json?.segment_id;
  if (!lang || !sid) continue;
  if (lesson_id && !sid.startsWith(lesson_id + '_')) continue;
  if (!byLang[lang]) byLang[lang] = [];
  byLang[lang].push(it);
}
for (const lang of Object.keys(byLang)) {
  byLang[lang].sort((a, b) => String(a.json.segment_id).localeCompare(String(b.json.segment_id)));
}

function buildWav(pcm) {
  const n = pcm.length;
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);          h.writeUInt32LE(36 + n, 4);
  h.write('WAVE', 8);          h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);     h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);      h.writeUInt32LE(SAMPLE_RATE, 24);
  h.writeUInt32LE(SAMPLE_RATE * BPS, 28);
  h.writeUInt16LE(BPS, 32);    h.writeUInt16LE(16, 34);
  h.write('data', 36);         h.writeUInt32LE(n, 40);
  return Buffer.concat([h, pcm]);
}

const output = [];
let totalTrimmed = 0;
let trimmedSegsCount = 0;
let skippedTooSmall = 0;
let skippedBinaryRead = 0;

for (const lang of Object.keys(byLang)) {
  let prevBorrow = 0;
  for (const e of byLang[lang]) {
    const sid  = e.json.segment_id;
    const loc  = locMap[`${sid}_${lang}`] || {};
    const segBorrow = loc.borrowed_sec || 0;

    let newJson   = { ...e.json, trimmed_for_seq: false };
    let newBinary = e.binary;

    if (prevBorrow > 0 && e.binary?.data) {
      const leadSec   = loc.lead_silence_sec || 0;
      const trimSec   = Math.min(prevBorrow, leadSec);
      const trimBytes = Math.round(trimSec * SAMPLE_RATE) * BPS;

      if (trimBytes > 0) {
        const idx = indexMap.get(e);
        let wavBuf;
        try {
          wavBuf = await this.helpers.getBinaryDataBuffer(idx, 'data');
        } catch (err) {
          console.warn(`Trim Lead For Sequence: ${sid}_${lang} skipped — getBinaryDataBuffer failed: ${err.message}`);
          skippedBinaryRead++;
          output.push({ json: newJson, binary: newBinary });
          prevBorrow = segBorrow;
          continue;
        }
        if (!wavBuf || wavBuf.length <= 44 + trimBytes) {
          console.warn(`Trim Lead For Sequence: ${sid}_${lang} skipped — WAV is ${wavBuf?.length ?? 0} bytes (too small to trim ${trimBytes})`);
          skippedTooSmall++;
          output.push({ json: newJson, binary: newBinary });
          prevBorrow = segBorrow;
          continue;
        }

        // Strip 44-byte WAV header, slice off trimBytes from start, rebuild header
        const pcm    = wavBuf.subarray(44 + trimBytes);
        const newWav = buildWav(pcm);
        const newDurSec  = pcm.length / (SAMPLE_RATE * BPS);
        const newLeadSec = leadSec - trimSec;

        newJson.lead_silence_sec   = parseFloat(newLeadSec.toFixed(3));
        newJson.final_duration_sec = parseFloat(newDurSec.toFixed(3));
        newJson.trimmed_for_seq    = true;
        newJson.trimmed_amount_sec = parseFloat(trimSec.toFixed(3));
        newBinary = {
          data: {
            data:     newWav.toString('base64'),
            mimeType: 'audio/wav',
            fileName: `${sid}_${lang}.wav`,
          },
        };
        totalTrimmed += trimSec;
        trimmedSegsCount++;
      }
    }

    output.push({ json: newJson, binary: newBinary });
    prevBorrow = segBorrow;
  }
}

const note = (skippedBinaryRead || skippedTooSmall)
  ? ` (skipped ${skippedBinaryRead} for binary-read, ${skippedTooSmall} for too-small)`
  : '';
console.log(`Trim Lead For Sequence: trimmed ${trimmedSegsCount} segments totaling ${totalTrimmed.toFixed(3)}s${note}`);

return output;
