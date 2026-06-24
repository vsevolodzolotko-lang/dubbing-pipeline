import { config } from '../config.js'

const BASE = 'https://sheets.googleapis.com/v4/spreadsheets'

/**
 * Thin Sheets v4 client over raw fetch. Reads serve the snapshot poller;
 * writes go through the serialized write queue (added in the actions phase).
 * Exponential backoff on 429/5xx.
 */
export function makeSheetsClient(auth) {
  async function call(path, { method = 'GET', body, query } = {}) {
    const url = new URL(`${BASE}/${config.sheetId}${path}`)
    if (query) for (const [k, v] of Object.entries(query)) {
      if (Array.isArray(v)) v.forEach((x) => url.searchParams.append(k, x))
      else if (v != null) url.searchParams.set(k, String(v))
    }
    return withBackoff(async () => {
      const token = await auth.getAccessToken()
      const res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw httpError(res.status, `Sheets ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`)
      }
      return res.json()
    })
  }

  return {
    /** ranges: e.g. ['config!A:B','segments!A:AZ']. One request regardless of count. */
    async batchGet(ranges) {
      const data = await call('/values:batchGet', {
        query: { ranges, majorDimension: 'ROWS', valueRenderOption: 'UNFORMATTED_VALUE' },
      })
      return data.valueRanges || []
    },
    async getValues(range) {
      const data = await call(`/values/${encodeURIComponent(range)}`, {
        query: { majorDimension: 'ROWS', valueRenderOption: 'UNFORMATTED_VALUE' },
      })
      return data.values || []
    },
    async batchUpdate(valueRanges) {
      return call('/values:batchUpdate', {
        method: 'POST',
        body: { valueInputOption: 'RAW', data: valueRanges },
      })
    },
    async updateValues(range, values) {
      return call(`/values/${encodeURIComponent(range)}`, {
        method: 'PUT',
        query: { valueInputOption: 'RAW' },
        body: { range, majorDimension: 'ROWS', values },
      })
    },
  }
}

function httpError(status, message) {
  const e = new Error(message)
  e.status = status
  return e
}

async function withBackoff(fn, { tries = 4, baseMs = 400 } = {}) {
  let lastErr
  for (let i = 0; i < tries; i++) {
    try {
      return await fn()
    } catch (e) {
      lastErr = e
      const retryable = e.status === 429 || (e.status >= 500 && e.status < 600) || e.code === 'ETIMEDOUT'
      if (!retryable || i === tries - 1) throw e
      await sleep(baseMs * 2 ** i + Math.floor(Math.random() * 200))
    }
  }
  throw lastErr
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
