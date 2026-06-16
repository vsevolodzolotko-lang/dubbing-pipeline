// Single-flight guard (W_Master, runs right after Once Per Run, BEFORE the archive/clear chain).
// Prevents a duplicate Drive trigger (n8n googleDriveTrigger can fire several times for ONE
// upload) from starting a SECOND run that would Clear Sheet Tabs mid-write of the first run —
// the root cause of the 2026-06-16 som_th_3 stomp (pl/pt fragmented, it/tr lost).
//
// A run is ACTIVE (so THIS execution must bail) when the config run_token:
//   - is set, AND
//   - was NOT aborted    (abort_token     !== run_token), AND
//   - has NOT completed  (completed_token !== run_token), AND
//   - is still fresh     (age < stale window — a crashed run never marks completion, so the
//                         freshness escape prevents it from wedging the pipeline forever).
// W3 writes localization_run_completed_token = run_token on the final language (is_last_lang),
// so a normally-finished run releases the lock immediately — no time window needed in the happy path.
const cfg = {};
$('Read Config (Guard)').all().forEach(i => { if (i.json && i.json.key) cfg[i.json.key] = i.json.value; });

const runToken       = (cfg.localization_run_token || '').toString().trim();
const abortToken     = (cfg.localization_abort_token || '').toString().trim();
const completedToken = (cfg.localization_run_completed_token || '').toString().trim();
const STALE_MIN      = parseFloat(cfg.localization_stale_run_minutes) || 60;

let ageMin = Infinity;
const started = Date.parse(runToken);            // run_token is an ISO timestamp (archive_run_at)
if (!isNaN(started)) ageMin = (Date.now() - started) / 60000;

const runActive = !!(
  runToken &&
  abortToken     !== runToken &&
  completedToken !== runToken &&
  ageMin < STALE_MIN
);

const once = $('Once Per Run').first().json || {};
if (runActive) {
  console.warn(`W_Master single-flight: run ${runToken} still active (age ${ageMin.toFixed(1)}m < ${STALE_MIN}m, not aborted, not completed) — IGNORING duplicate trigger for: ${(once.new_file_names||[]).join(', ') || '(unknown)'}`);
} else {
  console.log(`W_Master single-flight: clear to start (prev run_token=${runToken||'(none)'}, completed=${completedToken||'(none)'}, age=${ageMin===Infinity?'n/a':ageMin.toFixed(1)+'m'}).`);
}
// Pass Once Per Run's payload through unchanged so the downstream nodes on the "not active"
// branch (Read Config Archive / Start) receive the same item shape they did before the guard.
return [{ json: { ...once, run_active: runActive, guard_age_min: ageMin, guard_run_token: runToken } }];
