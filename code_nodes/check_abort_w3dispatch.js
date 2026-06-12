// Check Abort — cooperative kill switch for the W3 per-language continuation chain.
// Sits between Read Config and the "Aborted?" IF in W3 Dispatch. The dispatcher is re-entered
// once per language (this is where the multi-hour run actually spends its time), so this is
// the checkpoint that matters most.
//
// Stop semantics: W_Master writes localization_run_token at run start; the Slack stop button
// (via W_Abort) writes localization_abort_token = that same run_token. When the two match,
// the operator asked to stop THIS run. We emit a single sentinel item with an `aborted` flag so
// the downstream IF routes: true → post "✅ Локалізацію зупинено" (the confirmation the operator
// awaits) and halt; false → Resolve Lang → Fire W3 (chain continues).
//
// Because Execute W3 enters here at lang_index 0, a stop clicked during W1/W2 is also honored.
// The confirmation fires exactly once — on the hop where the halt is detected — and by then
// nothing of this run is running (the dispatcher runs after W2; the prior language already
// reached Save Full to Drive), so it genuinely means "safe to start a new run".
const cfg = {};
$('Read Config').all().forEach(i => { if (i.json && i.json.key) cfg[i.json.key] = i.json.value; });

const runToken = (cfg.localization_run_token || '').toString().trim();
const abortToken = (cfg.localization_abort_token || '').toString().trim();
const aborted = !!(runToken && abortToken && abortToken === runToken);

const p = $('Get Params').first().json || {};
if (aborted) {
  console.log(`W3 Dispatch: stop confirmed for run ${runToken} — halting chain at lang_index=${p.lang_index} (lesson ${p.lesson_id})`);
}

return [{ json: { aborted, run_token: runToken, lesson_id: p.lesson_id, lang_index: p.lang_index } }];
