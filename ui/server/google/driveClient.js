const FILES = 'https://www.googleapis.com/drive/v3/files'

/**
 * Thin Drive v3 client over raw fetch. listFolder/getMeta feed the snapshot
 * poller and audio resolution; streamMedia returns the upstream Response so the
 * audio route can pass Range bytes straight through. supportsAllDrives=true
 * everywhere so the eventual move to a Shared Drive is config-only.
 */
export function makeDriveClient(auth) {
  async function authHeaders(extra = {}) {
    const token = await auth.getAccessToken()
    return { Authorization: `Bearer ${token}`, ...extra }
  }

  return {
    async listFolder(folderId, { fields = 'files(id,name,size,md5Checksum,modifiedTime,mimeType)' } = {}) {
      const url = new URL(FILES)
      url.searchParams.set('q', `'${folderId}' in parents and trashed=false`)
      url.searchParams.set('fields', `nextPageToken,${fields}`)
      url.searchParams.set('pageSize', '1000')
      url.searchParams.set('supportsAllDrives', 'true')
      url.searchParams.set('includeItemsFromAllDrives', 'true')
      const out = []
      let pageToken
      do {
        if (pageToken) url.searchParams.set('pageToken', pageToken)
        const res = await fetch(url, { headers: await authHeaders() })
        if (!res.ok) throw await driveError(res, `listFolder ${folderId}`)
        const data = await res.json()
        out.push(...(data.files || []))
        pageToken = data.nextPageToken
      } while (pageToken)
      return out
    },

    async getMeta(fileId, fields = 'id,name,size,md5Checksum,modifiedTime,mimeType') {
      const url = new URL(`${FILES}/${fileId}`)
      url.searchParams.set('fields', fields)
      url.searchParams.set('supportsAllDrives', 'true')
      const res = await fetch(url, { headers: await authHeaders() })
      if (!res.ok) throw await driveError(res, `getMeta ${fileId}`)
      return res.json()
    },

    /** Returns the upstream fetch Response (status 200/206, Range honored) for pass-through. */
    async streamMedia(fileId, rangeHeader) {
      const url = new URL(`${FILES}/${fileId}`)
      url.searchParams.set('alt', 'media')
      url.searchParams.set('supportsAllDrives', 'true')
      const headers = await authHeaders(rangeHeader ? { Range: rangeHeader } : {})
      const res = await fetch(url, { headers })
      if (!res.ok && res.status !== 206) throw await driveError(res, `streamMedia ${fileId}`)
      return res
    },
  }
}

async function driveError(res, ctx) {
  const text = await res.text().catch(() => '')
  const e = new Error(`Drive ${ctx} → ${res.status}: ${text.slice(0, 300)}`)
  e.status = res.status
  return e
}
