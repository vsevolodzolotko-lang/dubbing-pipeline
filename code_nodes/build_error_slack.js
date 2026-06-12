// W_Error — Build Error Slack. Fires from a global Error Trigger whenever a production workflow
// (W_Master / W3_Synthesize_v2 / W3_Dispatch / W_Abort) dies with an uncaught error. This is the
// ONLY negative/failure signal in the pipeline — without it, a crashed run is silent and the
// operator never learns whether it's safe to start a new one.
//
// Reads:
//   $('Read Config').all()        — slack_channel, localization_run_token (hint: which run)
//   $('Error Trigger').first().json — { workflow:{name}, execution:{lastNodeExecuted, error, url} }
// Emits { channel, text } for the native Slack node. Returns [] if slack_channel is unset.
const cfg = {};
$('Read Config').all().forEach(i => { if (i.json && i.json.key) cfg[i.json.key] = i.json.value; });

const channel = cfg.slack_channel;
if (!channel) { console.log('W_Error: slack_channel missing — cannot notify'); return []; }

const err = $('Error Trigger').first().json || {};
const wf = err.workflow || {};
const ex = err.execution || {};

const wfName = wf.name || '(unknown)';
const step = ex.lastNodeExecuted || '(unknown)';
let msg = (ex.error && (ex.error.message || ex.error.description)) || 'no message';
msg = msg.toString();
if (msg.length > 500) msg = msg.slice(0, 500) + '…';
const url = ex.url || '';
const runToken = cfg.localization_run_token || '(unknown)';

const lines = [
  ':x: *Localization aborted on error*',
  '',
  `*Workflow:* ${wfName}`,
  `*Step:* ${step}`,
  `*Error:* ${msg}`,
  `*Run:* ${runToken}`,
];
if (url) lines.push(`*Execution:* ${url}`);
lines.push('');
lines.push('Check the cause in n8n before re-running. A new run will archive the current (possibly incomplete) state and start fresh — but first make sure the error is not infrastructural (API, limits, connection).');

return [{ json: { channel, text: lines.join('\n') } }];
