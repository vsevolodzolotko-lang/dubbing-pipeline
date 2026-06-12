// Build the "localization started" Slack message (W_Master, fires right after Once Per Run,
// before the archive chain). Emits ONE item { channel, text, blocks } consumed by an HTTP
// Request node that POSTs to Slack chat.postMessage (blocks need the raw API — the native
// Slack node can't author a Block Kit `confirm` dialog by hand).
//
// The message carries an interactive danger button "🛑 Зупинити локалізацію" with a native
// Slack confirm dialog. The button's `value` is the run_token (= Once Per Run's archive_run_at);
// clicking it routes to W_Abort, which writes localization_abort_token = run_token. Cooperative
// checkpoints (W3 Dispatch) compare the two tokens and halt the run.
//
// Reads:
//   $('Read Config (Start)').all()  — slack_channel
//   $('Once Per Run').first().json  — archive_run_at (run_token), new_file_names
const cfg = {};
$('Read Config (Start)').all().forEach(i => { if (i.json && i.json.key) cfg[i.json.key] = i.json.value; });

const channel = cfg.slack_channel;
if (!channel) {
  // Don't hard-fail the run just because Slack isn't configured — skip the heads-up message.
  console.log('Build Started Slack: slack_channel missing — skipping start notification');
  return [];
}

const run = $('Once Per Run').first().json || {};
const runToken = (run.archive_run_at || '').toString();
const names = (run.new_file_names || []).filter(Boolean);
const filesLine = names.length ? names.join(', ') : '(unknown)';

const headerText = [
  ':rocket: *Localization started*',
  '',
  `*Source file(s):* ${filesLine}`,
  '',
  ":warning: Don't edit Drive or Sheets until localization finishes.",
].join('\n');

const blocks = [
  { type: 'section', text: { type: 'mrkdwn', text: headerText } },
  {
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: { type: 'plain_text', text: '🛑 Stop localization', emoji: true },
        style: 'danger',
        action_id: 'abort_localization',
        value: runToken,
        confirm: {
          title: { type: 'plain_text', text: 'Stop localization?' },
          text: { type: 'mrkdwn', text: "All processes of the current run will stop at the next checkpoint. The current language will finish generating first. This can't be undone." },
          confirm: { type: 'plain_text', text: 'Stop' },
          deny: { type: 'plain_text', text: 'Cancel' },
          style: 'danger',
        },
      },
    ],
  },
];

// `text` is the notification/fallback string Slack shows in push/preview when blocks can't render.
return [{ json: { channel, text: "Localization started — don't touch Drive", blocks } }];
