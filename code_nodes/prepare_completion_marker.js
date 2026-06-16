// Release the single-flight lock when the WHOLE run finishes. Runs on the FINAL language only
// (is_last_lang===true, or null for a legacy single-run that did every lang at once) — the same
// gate as the completion Slack. Writes localization_run_completed_token = current run_token so the
// next W_Master start sees the lock released (W_Master "Check Single-Flight" guard).
// is_last_lang===false → a mid-chain hop → emit nothing (lock stays held until the last language).
if ($('Get Params').first().json.is_last_lang === false) return [];
const cfg = {};
$('Read Config').all().forEach(i => { if (i.json && i.json.key) cfg[i.json.key] = i.json.value; });
const runToken = (cfg.localization_run_token || '').toString().trim();
if (!runToken) return [];   // manual/legacy run with no token — nothing to release
return [{ json: { key: 'localization_run_completed_token', value: runToken } }];
