// Prepare the two config rows that scope the cooperative kill-switch to THIS run (W_Master,
// runs right after Once Per Run). Emits two items that the following Sheets appendOrUpdate
// node writes to the config tab (matching on `key`):
//   localization_run_token   = archive_run_at  → identifies the current run
//   localization_abort_token = ''              → clears any stale stop from a previous run
//
// A checkpoint aborts only when localization_abort_token === localization_run_token (both
// non-empty). Resetting abort_token here guarantees a fresh run is never blocked by an old stop.
const run = $('Once Per Run').first().json || {};
const runToken = (run.archive_run_at || '').toString();
if (!runToken) {
  console.warn('Prepare Run Token: Once Per Run produced no archive_run_at — run_token will be empty');
}
return [
  { json: { key: 'localization_run_token', value: runToken } },
  { json: { key: 'localization_abort_token', value: '' } },
];
