// W_Abort — Verify & Parse Action. Authenticates the Slack request, then extracts the stop intent.
// This is the security gate for an otherwise public POST webhook: if anything fails to verify we
// return [] (no abort is written, no Slack posted). Only a genuine, fresh, correctly-signed
// "abort_localization" button click gets through.
//
// Reads:
//   $('Prep Signature').first().json — base, secret, given_sig, ts, payload
//   $json.computed_sig               — hex HMAC produced by the Crypto (HMAC) node
// Emits one item { run_token, slack_user, response_url } on success; [] on any rejection.
const prep = $('Prep Signature').first().json || {};
const computed = ($json.computed_sig || '').toString();
const given = (prep.given_sig || '').toString();
const tsNum = Number(prep.ts);
const now = Math.floor(Date.now() / 1000);

if (!prep.secret) { console.warn('W_Abort: slack_signing_secret missing from config — rejecting'); return []; }
if (!given || !computed) { console.warn('W_Abort: missing signature/hash — rejecting'); return []; }
if (!tsNum || Math.abs(now - tsNum) > 300) { console.warn('W_Abort: stale or invalid timestamp — rejecting (replay guard)'); return []; }

const expected = 'v0=' + computed;
if (expected.length !== given.length || expected !== given) {
  console.warn('W_Abort: Slack signature mismatch — rejecting');
  return [];
}

let payload;
try { payload = JSON.parse(prep.payload); } catch (e) { console.warn('W_Abort: could not parse interaction payload — rejecting'); return []; }

const action = (payload.actions && payload.actions[0]) || {};
if (action.action_id !== 'abort_localization') { console.log('W_Abort: ignoring non-abort action_id', action.action_id); return []; }

const runToken = (action.value || '').toString();
if (!runToken) { console.warn('W_Abort: stop button carried no run_token — rejecting'); return []; }

const user = (payload.user && (payload.user.username || payload.user.name || payload.user.id)) || 'unknown';
const responseUrl = (payload.response_url || '').toString();

console.log(`W_Abort: verified stop request for run ${runToken} by ${user}`);
return [{ json: { run_token: runToken, slack_user: user, response_url: responseUrl } }];
