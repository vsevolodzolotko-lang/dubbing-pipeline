require('dotenv').config();

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const ELEVENLABS_KEY = process.env.ELEVENLABS_API_KEY;

const missing = [];
if (!ANTHROPIC_KEY) missing.push('ANTHROPIC_API_KEY');
if (!ELEVENLABS_KEY) missing.push('ELEVENLABS_API_KEY');
if (missing.length) {
  console.error(`Missing env vars: ${missing.join(', ')}`);
  process.exit(1);
}

function handleError(label, err) {
  if (err.status === 401) {
    console.error(`[${label}] FAIL — 401 Unauthorized: API key is invalid`);
  } else if (err.cause?.code === 'ECONNREFUSED') {
    console.error(`[${label}] FAIL — ECONNREFUSED: network unreachable`);
  } else {
    console.error(`[${label}] FAIL —`, err.message || err);
  }
}

async function testClaude() {
  console.log('\n--- Claude API ---');
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 20,
        messages: [{ role: 'user', content: 'Reply with one word: hello' }],
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      const err = new Error(data.error?.message || res.statusText);
      err.status = res.status;
      throw err;
    }

    const text = data.content?.[0]?.text;
    console.log('OK — response:', text);
  } catch (err) {
    handleError('Claude', err);
  }
}

async function testElevenLabs() {
  console.log('\n--- ElevenLabs API ---');
  try {
    const res = await fetch('https://api.elevenlabs.io/v1/voices', {
      headers: { 'xi-api-key': ELEVENLABS_KEY },
    });

    const data = await res.json();

    if (!res.ok) {
      const err = new Error(data.detail?.message || res.statusText);
      err.status = res.status;
      throw err;
    }

    const voices = (data.voices || []).slice(0, 3);
    console.log('OK — first 3 voices:');
    voices.forEach(v => console.log(`  ${v.name} — ${v.voice_id}`));
  } catch (err) {
    handleError('ElevenLabs', err);
  }
}

(async () => {
  await testClaude();
  await testElevenLabs();
  console.log('');
})();
