const data = $input.first().json;
const lesson_id = $('Get Params').first().json.lesson_id;
const configMap = {};
$('Read Config').all().forEach(i => { if (i.json.key) configMap[i.json.key] = i.json.value; });

// Merge thresholds (existing behaviour) — group consecutive short sentences into one segment
const MAX_CHARS            = 150;
const MAX_GAP_FOR_GROUPING = 1.0;

// Intra-sentence split (NEW 2026-05-31): break a single long sentence into pieces at
// natural word-pauses, so very long EN sentences don't create slots that target langs
// (esp. FR/IT/PT with verbose translations + slow voice profiles) can't fit. Without
// this, a 28s single sentence becomes one segment — FR translation can be 30%+ longer
// and would hard-truncate even at max speed-up.
//
// Algorithm (greedy largest-gap-first split, iterative until all pieces fit):
//   1. If sentence.duration <= MAX_SEG_DURATION → keep as single piece.
//   2. Find all gaps between consecutive words in the sentence.
//   3. Filter: gap >= MIN_INTRA_PAUSE AND both resulting halves >= MIN_PIECE_DURATION.
//   4. Pick the largest valid gap → split sentence at that point.
//   5. Recurse on each half. Stop when all pieces <= MAX_SEG_DURATION or no more
//      valid splits remain (fallback: keep as oversized piece).
const MAX_SEG_DURATION   = parseFloat(configMap.max_segment_duration_sec)        || 12;
const MIN_INTRA_PAUSE    = parseFloat(configMap.min_intra_sentence_pause_sec)    || 0.25;
const MIN_PIECE_DURATION = parseFloat(configMap.min_segment_piece_duration_sec)  || 1.5;

const alt           = data.results?.channels?.[0]?.alternatives?.[0];
const paragraphs    = alt?.paragraphs?.paragraphs || [];
const allWords      = alt?.words || [];
const audioDuration = parseFloat(data.metadata?.duration) || null;

function wordsInRange(start, end) {
  return allWords.filter(w => w.start >= start - 0.01 && w.end <= end + 0.01);
}
function reconstructText(words) {
  return words.map(w => w.punctuated_word || w.word).join(' ').trim();
}

function splitLongSentence(sent) {
  let pieces = [{ text: sent.text, start: sent.start, end: sent.end }];
  let changed = true;
  let safety = 10;  // prevent runaway loops
  while (changed && safety-- > 0) {
    changed = false;
    const next = [];
    for (const p of pieces) {
      const pdur = p.end - p.start;
      if (pdur <= MAX_SEG_DURATION) { next.push(p); continue; }
      const pWords = wordsInRange(p.start, p.end);
      if (pWords.length < 2) { next.push(p); continue; }

      let bestGap = 0, bestIdx = -1;
      for (let i = 1; i < pWords.length; i++) {
        const gap = pWords[i].start - pWords[i-1].end;
        if (gap < MIN_INTRA_PAUSE) continue;
        const leftDur  = pWords[i-1].end - p.start;
        const rightDur = p.end - pWords[i].start;
        if (leftDur < MIN_PIECE_DURATION || rightDur < MIN_PIECE_DURATION) continue;
        if (gap > bestGap) { bestGap = gap; bestIdx = i; }
      }
      if (bestIdx < 0) { next.push(p); continue; }

      const leftWords  = pWords.slice(0, bestIdx);
      const rightWords = pWords.slice(bestIdx);
      next.push({ text: reconstructText(leftWords),  start: p.start,                end: pWords[bestIdx-1].end });
      next.push({ text: reconstructText(rightWords), start: pWords[bestIdx].start,  end: p.end                  });
      changed = true;
    }
    pieces = next;
  }
  return pieces;
}

const segments = [];
let current    = null;
function flush() { if (current) { segments.push(current); current = null; } }

let splitCount = 0;
for (const para of paragraphs) {
  flush();
  for (const s of (para.sentences || [])) {
    const pieces = splitLongSentence(s);
    if (pieces.length > 1) splitCount += pieces.length - 1;
    for (const piece of pieces) {
      if (current === null) {
        current = { text: piece.text, start: piece.start, end: piece.end };
        continue;
      }
      const combined = current.text + ' ' + piece.text;
      const gap      = piece.start - current.end;
      const combinedDur = piece.end - current.start;
      if (combined.length <= MAX_CHARS && gap <= MAX_GAP_FOR_GROUPING && combinedDur <= MAX_SEG_DURATION) {
        current.text = combined;
        current.end  = piece.end;
      } else {
        flush();
        current = { text: piece.text, start: piece.start, end: piece.end };
      }
    }
  }
}
flush();

// Fallback if paragraphs missing
if (!segments.length) {
  const utts = data.results?.utterances || [];
  if (!utts.length) throw new Error('No sentences/utterances returned from Deepgram');
  for (const u of utts) segments.push({ text: u.transcript, start: u.start, end: u.end });
}

// Last segment ends at the last spoken word (no extension to file end).
// audio_duration_sec is emitted on every row so W3 can compute trailing
// silence-to-EOF and append it to the last segment's WAV; total dubbed
// duration still equals EN total. Changed 2026-06-04: previously last.end
// was bumped to audioDuration, inflating en_duration_sec for the last seg
// — TTS budget then covered trailing silence, so verbose translations
// (FR/IT/PT) extended past the natural speech end.

console.log(`Segmentation: ${segments.length} segments (${splitCount} intra-sentence splits applied at MAX=${MAX_SEG_DURATION}s)`);

return segments.map((seg, i) => ({
  json: {
    segment_id: lesson_id + '_seg_' + String(i + 1).padStart(3, '0'),
    lesson_id,
    en_text: seg.text,
    en_start_sec: parseFloat(seg.start.toFixed(3)),
    en_end_sec: parseFloat(seg.end.toFixed(3)),
    en_duration_sec: parseFloat((seg.end - seg.start).toFixed(3)),
    audio_duration_sec: audioDuration ? parseFloat(audioDuration.toFixed(3)) : 0,
    de_text: '',
    es_text: '',
    fr_text: '',
    pl_text: '',
    pt_text: '',
    it_text: '',
    tr_text: '',
    status: 'pending',
    notes: '',
  }
}));
