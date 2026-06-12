// W_Abort — Prep Signature. Assembles everything the Crypto (HMAC) node and the verifier need
// to authenticate a Slack interactivity POST before we act on it.
//
// Slack signs each request: signature = 'v0=' + HMAC_SHA256(signing_secret, `v0:{ts}:{raw_body}`).
// We must hash the EXACT raw body bytes, so the Slack Actions Webhook node has "Raw Body" enabled
// (the body arrives as binary). Headers carry the signature and timestamp; the signing secret
// comes from the config sheet (slack_signing_secret).
//
// Reads:
//   $('Read Config').all()            — slack_signing_secret
//   $('Slack Actions Webhook').first()— headers + raw binary body
// Emits one item: { base, secret, given_sig, ts, payload } → HMAC node → Verify & Parse Action.
const cfg = {};
$('Read Config').all().forEach(i => { if (i.json && i.json.key) cfg[i.json.key] = i.json.value; });
const secret = (cfg.slack_signing_secret || '').toString();

const wh = $('Slack Actions Webhook').first() || {};
const headers = (wh.json && wh.json.headers) || {};
const given_sig = (headers['x-slack-signature'] || headers['X-Slack-Signature'] || '').toString();
const ts = (headers['x-slack-request-timestamp'] || headers['X-Slack-Request-Timestamp'] || '').toString();

// Raw body: prefer the exact bytes from the webhook's binary (Raw Body = ON). Fall back to a
// string body or a reconstructed form-encoding — the fallbacks won't match Slack's signature,
// so verification will (correctly) reject if Raw Body wasn't enabled.
let raw = '';
const b = wh.binary;
if (b && b.data && b.data.data) {
  raw = Buffer.from(b.data.data, 'base64').toString('utf8');
} else if (typeof (wh.json && wh.json.body) === 'string') {
  raw = wh.json.body;
} else if (wh.json && wh.json.body && wh.json.body.payload) {
  raw = 'payload=' + encodeURIComponent(wh.json.body.payload);
}

// Extract the `payload` field from the form-encoded raw body. We parse it by hand
// (regex + decodeURIComponent) rather than URLSearchParams — the latter is unreliable in
// the n8n Code-node sandbox and silently yielded '' even though the raw body is intact
// (the HMAC over `base` still matches, proving raw is correct). '+' → space per form rules.
let payload = '';
const m = raw.match(/(?:^|&)payload=([^&]*)/);
if (m) {
  try { payload = decodeURIComponent(m[1].replace(/\+/g, ' ')); }
  catch (e) { payload = m[1]; }
}

return [{ json: { base: `v0:${ts}:${raw}`, secret, given_sig, ts, payload } }];
