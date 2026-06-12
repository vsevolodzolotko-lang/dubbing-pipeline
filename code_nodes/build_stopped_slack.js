// W3 Dispatch — Build Stopped Slack. Posts the confirmation the operator awaits after pressing
// Stop: the cooperative kill-switch has actually halted the continuation chain (vs W_Abort's
// click-time "зупиняю…" message). Fired from the Aborted?=true branch, exactly once.
//
// Reads:
//   $('Read Config').all()     — slack_channel
//   $('Check Abort').first()   — lesson_id (sentinel)
// Emits { channel, text } for the native Slack node. Returns [] if slack_channel is unset.
const cfg = {};
$('Read Config').all().forEach(i => { if (i.json && i.json.key) cfg[i.json.key] = i.json.value; });

const channel = cfg.slack_channel;
if (!channel) { console.log('W3 Dispatch: slack_channel missing — skipping stop confirmation'); return []; }

const s = $('Check Abort').first().json || {};
const lines = [
  ':white_check_mark: *Localization stopped — confirmed*',
  '',
  `*Lesson:* ${s.lesson_id || '—'}`,
  'All processes finished. Safe to start a new run.',
];
return [{ json: { channel, text: lines.join('\n') } }];
