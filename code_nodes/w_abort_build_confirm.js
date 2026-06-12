// W_Abort — Build Confirm Slack. Posts a plain-text confirmation back to the channel so the team
// sees the stop was registered and understands when it takes effect. Emits { channel, text } for
// the native Slack node (same idiom as W_Master / W_Regen completion messages).
const cfg = {};
$('Read Config').all().forEach(i => { if (i.json && i.json.key) cfg[i.json.key] = i.json.value; });
const channel = cfg.slack_channel;
if (!channel) { console.log('W_Abort: slack_channel missing — skipping confirmation'); return []; }

const v = $('Verify & Parse Action').first().json || {};
const lines = [
  ':octagonal_sign: *Localization stopped*',
  '',
  `*Initiated by:* ${v.slack_user || 'unknown'}`,
  'The current language will finish. No new languages will start. Active processes run to completion.',
  '',
  ':hourglass_flowing_sand: Awaiting confirmation in the next message.',
];
return [{ json: { channel, text: lines.join('\n') } }];
