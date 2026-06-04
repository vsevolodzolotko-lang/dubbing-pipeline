const lesson_id = $('Get Params').first().json.lesson_id;
const configMap = {};
$('Read Config').all().forEach(i => { if (i.json.key) configMap[i.json.key] = i.json.value; });
const activeLangs        = (configMap.active_langs || 'de,es,fr,it,pl,pt,tr').split(',').map(s => s.trim());
const MIN_GAP            = parseFloat(configMap.min_inter_segment_gap_sec)  || 0.4;
const MAX_BORROW         = parseFloat(configMap.max_borrow_per_segment_sec) || 2.0;
const EXPANSION_THRESHOLD= parseFloat(configMap.expansion_threshold)        || 0.85;
const SILENCE_LEAD_RATIO = parseFloat(configMap.silence_lead_ratio)         || 0.2;
const SILENCE_LEAD_MAX_SEC = parseFloat(configMap.silence_lead_max_sec)    || 0.05;

const voiceMap = {};
$('Read Voices').all().forEach(i => { if (i.json.lang) voiceMap[i.json.lang] = i.json; });

const sortedSegs = $input.all()
  .filter(i => i.json.segment_id)
  .filter(i => !lesson_id || i.json.segment_id.startsWith(lesson_id + '_'))
  .sort((a, b) => (parseFloat(a.json.en_start_sec) || 0) - (parseFloat(b.json.en_start_sec) || 0));
if (sortedSegs.length === 0) throw new Error('No segments to synthesize' + (lesson_id ? ' for lesson_id=' + lesson_id : ''));

const slotInfo = {};
for (let i = 0; i < sortedSegs.length; i++) {
  const seg     = sortedSegs[i].json;
  const prevEnd = i > 0 ? (parseFloat(sortedSegs[i-1].json.en_end_sec) || 0) : 0;
  const start   = parseFloat(seg.en_start_sec)    || 0;
  const end     = parseFloat(seg.en_end_sec)      || 0;
  // Authoritative slot duration: end - start. Stored en_duration_sec can be
  // corrupted in segments tab (root cause TBD); prefer computed value.
  const storedDur = parseFloat(seg.en_duration_sec) || 0;
  const computedDur = Math.max(0, end - start);
  const dur = computedDur > 0 ? computedDur : storedDur;
  if (computedDur > 0 && storedDur > 0 && Math.abs(computedDur - storedDur) > 0.5) {
    console.warn(`W3 Expand TTS Jobs: segment ${seg.segment_id} stored en_duration_sec=${storedDur.toFixed(3)} disagrees with (end-start)=${computedDur.toFixed(3)}. Using computed.`);
  }

  const isLast    = (i === sortedSegs.length - 1);
  const audioDur  = parseFloat(seg.audio_duration_sec) || 0;
  const tailToEOF = isLast && audioDur > end ? (audioDur - end) : 0;
  if (isLast && audioDur === 0) {
    console.warn(`W3 Expand TTS Jobs: ${seg.segment_id} missing audio_duration_sec — trailing silence-to-EOF will be lost (re-run W1 to populate).`);
  }

  // Last seg: 'next start' = end-of-file → exposes trailing silence to slot/borrow logic.
  // Removed `isLast ? 0` cap on maxBorrowable so the last seg can breath-borrow into
  // the trailing silence like any other (movement-locked still blocked downstream in
  // check_timing_and_pad). Trailing silence after borrow is appended inside the last
  // seg's WAV by check_timing_and_pad, keeping sum(per-seg) == EN total.
  const nextStart = isLast ? (end + tailToEOF) : (parseFloat(sortedSegs[i+1].json.en_start_sec) || 0);
  const gapAfter  = Math.max(0, nextStart - end);

  // Unified signed adjustment: negative = steal needed; positive = borrow available
  const signedAdj      = gapAfter - MIN_GAP;
  const trailingSteal  = signedAdj < 0 ? -signedAdj : 0;
  const maxBorrowable  = Math.max(0, Math.min(signedAdj, MAX_BORROW));

  // Audio budget WITHOUT borrow (steal already accounted)
  const ttsBudget      = Math.max(dur * 0.5, dur - trailingSteal);
  // Effective slot WITH borrow allowance
  const effectiveSlot  = ttsBudget + maxBorrowable;

  slotInfo[seg.segment_id] = {
    slot_start_sec:           prevEnd,
    slot_end_sec:             end,
    lead_silence_natural_sec: Math.max(0, start - prevEnd),
    tts_budget_sec:           parseFloat(ttsBudget.toFixed(3)),
    effective_slot_sec:       parseFloat(effectiveSlot.toFixed(3)),
    max_borrowable_sec:       parseFloat(maxBorrowable.toFixed(3)),
    trailing_steal_sec:       parseFloat(trailingSteal.toFixed(3)),
    gap_after_sec:            parseFloat(gapAfter.toFixed(3)),
    tail_audio_silence_sec:   parseFloat(tailToEOF.toFixed(3)),
  };
}

const results = [];
for (const item of sortedSegs) {
  const seg = item.json;
  // Re-derive dur authoritatively for result row (same logic as slotInfo loop).
  const _segEnd   = parseFloat(seg.en_end_sec)   || 0;
  const _segStart = parseFloat(seg.en_start_sec) || 0;
  const _segDur   = Math.max(0, _segEnd - _segStart) || (parseFloat(seg.en_duration_sec) || 0);
  for (const lang of activeLangs) {
    const text = seg[`${lang}_text`];
    if (!text || !text.trim()) continue;
    const voice = voiceMap[lang] || {};
    if (!voice.voice_id) continue;
    const info = slotInfo[seg.segment_id] || {};
    results.push({ json: {
      segment_id:               seg.segment_id,
      lesson_id:                seg.lesson_id || 'unknown',
      lang,
      text,
      en_text:                  seg.en_text || '',
      en_duration_sec:          _segDur,
      en_start_sec:             parseFloat(seg.en_start_sec) || 0,
      en_end_sec:               parseFloat(seg.en_end_sec) || 0,
      slot_start_sec:           info.slot_start_sec           || 0,
      slot_end_sec:             info.slot_end_sec             || 0,
      lead_silence_natural_sec: info.lead_silence_natural_sec || 0,
      tts_budget_sec:           info.tts_budget_sec           || (parseFloat(seg.en_duration_sec) || 0),
      effective_slot_sec:       info.effective_slot_sec       || (parseFloat(seg.en_duration_sec) || 0),
      max_borrowable_sec:       info.max_borrowable_sec       || 0,
      trailing_steal_sec:       info.trailing_steal_sec       || 0,
      gap_after_sec:            info.gap_after_sec            || 0,
      tail_audio_silence_sec:   info.tail_audio_silence_sec   || 0,
      silence_lead_ratio:       SILENCE_LEAD_RATIO,
      silence_lead_max_sec:     SILENCE_LEAD_MAX_SEC,
      expansion_threshold:      EXPANSION_THRESHOLD,
      voice_id:                 voice.voice_id,
      stability:                parseFloat(voice.stability)         || 0.5,
      similarity_boost:         parseFloat(voice.similarity_boost)  || 0.75,
      style:                    parseFloat(voice.style)             || 0,
      speed:                    parseFloat(voice.speed)             || 1.0,
      model:                    voice.model || 'eleven_multilingual_v2',
      movement_keywords:        (seg.movement_keywords || '').toString().trim(),
      segment_type:             (seg.segment_type || '').toString().trim(),
    }});
  }
}
return results;