// Shared Anthropic (Claude) client for UI-server LLM lanes. Mirrors the pipeline's
// raw-fetch pattern (code_nodes/phase2_batch_llm_tts.js callAnthropic / parseLLMJson)
// — NOT the SDK. The API key is read server-side from the config tab and never
// reaches the browser. Opus 4.8 rejects temperature/top_p/top_k — we omit them.

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * POST one messages request. `system` is the system text (cached as an ephemeral
 * prefix so a stable system prompt is reused across calls in a session); `user`
 * is the user-turn string. Returns the first text block, or throws after 4
 * attempts with exponential backoff (same cadence as qaGemini.callGemini).
 */
export async function callClaude({ apiKey, model, system, user, maxTokens = 8000 }) {
  const body = {
    model,
    max_tokens: maxTokens,
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: user }],
  }
  let lastErr
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const t = await res.text().catch(() => '')
        const e = new Error(`Anthropic ${res.status}: ${t.slice(0, 200)}`)
        e.status = res.status
        throw e
      }
      const data = await res.json()
      return data.content?.[0]?.text?.trim() || ''
    } catch (e) {
      lastErr = e
      const retryable = !e.status || e.status === 429 || e.status >= 500
      if (!retryable || attempt === 3) throw e
      await sleep(2000 * 2 ** attempt)
    }
  }
  throw lastErr
}

// Extract the first JSON object from an LLM response (strips ``` fences). Returns
// {} on failure — same contract as the pipeline's parseLLMJson.
export function parseLLMJson(raw) {
  try {
    const cleaned = String(raw || '').replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const match = cleaned.match(/\{[\s\S]*\}/)
    if (match) return JSON.parse(match[0])
  } catch { /* swallow → {} */ }
  return {}
}
