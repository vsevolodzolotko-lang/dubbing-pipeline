// W_Abort — Prepare Abort Row. Turns the verified stop request into the single config row the
// following Sheets appendOrUpdate writes: localization_abort_token = run_token. A checkpoint
// halts the run only when localization_abort_token === localization_run_token.
const v = $('Verify & Parse Action').first().json || {};
const runToken = (v.run_token || '').toString();
return [{ json: { key: 'localization_abort_token', value: runToken } }];
